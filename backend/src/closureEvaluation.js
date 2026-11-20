const fail = () => { throw Object.assign(new Error('CLOSURE_INVALID_INPUT'), { status: 400 }) }
// Functional design only. These flags are not configurable through an HTTP payload.
export const closurePolicy = Object.freeze({ version: 1, institutionalApproval: 'PENDING',
  ordinaryDecision: 'DIRECT_BY_COMPETENT_DIRECTION', priorRequestRequired: false,
  integralEnabled: false, reopeningEnabled: false, writesEnabled: false })
const text = v => typeof v === 'string' && v.trim().length > 0
const time = v => typeof v === 'string' && Number.isFinite(Date.parse(v))
const attested = v => v?.verified === true && v.source === 'alfresco' && text(v.reference)
// Attestations are supplied ONLY by a trusted server-side reader after real verification.
// Structural validation here cannot authenticate claims or replace live institutional checks.
const bound = (v, envelope, dependency) => v?.schemaVersion === 1 && v.documentId === envelope.documentId &&
  v.envelopeRevision === envelope.revision && v.dependency === dependency
export function validateClosureScope(scope) {
  if (!scope || !['dependency', 'document'].includes(scope.type) ||
      (scope.type === 'dependency' ? Object.keys(scope).sort().join(',') !== 'dependency,type' || !['dsa', 'dti'].includes(scope.dependency)
        : Object.keys(scope).join(',') !== 'type')) fail()
  return { ...scope }
}

// Input envelope must already have passed parseAssignments. This module grants no authority.
export function evaluateClosure({ envelope, scope, evidence = {}, evaluatedAt }) {
  scope = validateClosureScope(scope)
  if (!envelope || !Array.isArray(envelope.dispatches) || !Number.isSafeInteger(envelope.revision) ||
      typeof envelope.documentId !== 'string' || typeof evaluatedAt !== 'string' || !Number.isFinite(Date.parse(evaluatedAt))) fail()
  const reasons = new Set(), missing = new Set(), verified = [], fulfilled = []
  const evidenceIssues = evidence.evidenceIssues || []
  for (const issue of evidenceIssues) { reasons.add(issue.code); missing.add('institutionalEvidence') }
  const policies = new Set(['INSTITUTIONAL_APPROVAL_PENDING', 'CLOSURE_COMPETENCE_PENDING', 'ARCHIVE_POLICY_PENDING', 'EXCEPTIONAL_REOPENING_POLICY_PENDING'])
  if (scope.type === 'document') reasons.add('INTEGRAL_CLOSURE_DISABLED')
  const all = envelope.dispatches.flatMap(d => d.recipients)
  if (all.some(a => !['dsa', 'dti'].includes(a.dependency))) reasons.add('ASSIGNMENT_DEPENDENCY_UNKNOWN')
  const assignments = all.filter(a => scope.type === 'document' || a.dependency === scope.dependency)
  const summary = { total: assignments.length, exigible: 0, attended: 0, pending: 0, cancelled: 0, validCancelled: 0, unverifiedCancelled: 0 }
  for (const a of assignments) {
    if (a.status === 'ANULADO') {
      summary.cancelled++
      const c = evidence.cancellations?.[a.id], auth = c?.authorization
      if (!c) {
        summary.unverifiedCancelled++; summary.exigible++; missing.add('cancellationEvidence'); reasons.add('CANCELLATION_EVIDENCE_MISSING')
      } else if (auth && (auth.functionalRole !== 'direccion' || auth.dependency !== a.dependency)) {
        summary.unverifiedCancelled++; summary.exigible++; reasons.add('CANCELLATION_AUTHORITY_REJECTED')
      } else if (!bound(c, envelope, a.dependency) || c.assignmentId !== a.id || !attested(c) || !text(c.reason) ||
          !time(c.at) || Date.parse(c.at) > Date.parse(evaluatedAt) || !attested(auth) || !text(auth.actorUserId) ||
          !time(auth.checkedAt) || Date.parse(auth.checkedAt) > Date.parse(evaluatedAt)) {
        summary.unverifiedCancelled++; summary.exigible++; missing.add('cancellationEvidence'); reasons.add('CANCELLATION_EVIDENCE_INCOMPLETE')
      } else { summary.validCancelled++; verified.push('cancellationAuthorization') }
    }
    else if (['ASIGNADO', 'DESPACHADO', 'ATENDIDO'].includes(a.status)) {
      summary.exigible++
      if (a.status === 'ATENDIDO') summary.attended++
      else { summary.pending++; reasons.add('OBLIGATIONS_PENDING') }
    } else reasons.add('ASSIGNMENT_STATUS_UNKNOWN')
    if (a.originAssignmentId && !all.some(p => p.id === a.originAssignmentId && p.dependency === a.dependency)) reasons.add('ORIGIN_ASSIGNMENT_INCONSISTENT')
  }
  const k = evidence.knowledge
  const knowledgeSummary = { required: null, confirmed: 0, pending: null, exclusivelyKnowledge: false }
  let knowledgeClassified = false
  if (k) {
    if (!bound(k, envelope, scope.dependency) || !attested(k.classification) || typeof k.classification.exclusive !== 'boolean' ||
        !attested(k.recipients) || !Array.isArray(k.recipients.userIds) || !k.recipients.userIds.length ||
        k.recipients.userIds.some(id => !text(id)) || new Set(k.recipients.userIds).size !== k.recipients.userIds.length || !Array.isArray(k.confirmations)) {
      reasons.add('KNOWLEDGE_EVIDENCE_INCOMPLETE'); missing.add('knowledgeEvidence')
    } else {
      knowledgeClassified = true
      knowledgeSummary.exclusivelyKnowledge = k.classification.exclusive
      knowledgeSummary.required = k.recipients.userIds.length
      const confirmed = new Set()
      for (const c of k.confirmations) {
        if (!attested(c) || c.documentId !== envelope.documentId || c.dependency !== k.dependency ||
            !k.recipients.userIds.includes(c.userId) || !time(c.at) || Date.parse(c.at) > Date.parse(evaluatedAt)) {
          reasons.add('KNOWLEDGE_CONFIRMATION_INCONSISTENT'); continue
        }
        confirmed.add(c.userId)
      }
      knowledgeSummary.confirmed = confirmed.size
      knowledgeSummary.pending = knowledgeSummary.required - confirmed.size
      if (knowledgeSummary.pending) reasons.add('KNOWLEDGE_CONFIRMATIONS_PENDING')
      else fulfilled.push('ALL_KNOWLEDGE_CONFIRMATIONS_VERIFIED')
      if (k.classification.exclusive && summary.total) reasons.add('KNOWLEDGE_CLASSIFICATION_CONFLICT')
      verified.push('knowledgeClassification', 'knowledgeRecipients')
    }
  }
  // A folder membership is only a hint; it cannot establish exclusive classification.
  if (evidence.knowledgeOnly === true && !knowledgeClassified) {
    reasons.add('KNOWLEDGE_CLASSIFICATION_UNVERIFIED'); missing.add('knowledgeClassification'); policies.add('KNOWLEDGE_ONLY_POLICY_PENDING')
  }
  if (!summary.total && !(knowledgeClassified && knowledgeSummary.exclusivelyKnowledge)) {
    reasons.add('NO_CLASSIFIED_OBLIGATIONS'); policies.add('NO_ASSIGNMENTS_POLICY_PENDING')
  }
  for (const key of ['originalRead', 'institutionalScope', 'projections']) {
    if (evidence[key] === true) verified.push(key)
    else { missing.add(key); reasons.add(key === 'projections' && evidence[key] === false ? 'PROJECTION_MISMATCH' : 'EVIDENCE_INCOMPLETE') }
  }
  const processes = (envelope.reviewProcesses || []).filter(p => scope.type === 'document' || p.dependency === scope.dependency)
  for (const p of processes) {
    if (evidence.proposals?.[p.id] !== true) { missing.add('proposalEvidence'); reasons.add('PROPOSAL_EVIDENCE_INCOMPLETE') }
    // Valid attendance is sufficient for ordinary closure; no universal PDF requirement.
    // Proposal integrity still matters, but its state never completes an assignment.
  }
  const responses = [...(envelope.responses || []).filter(r => scope.type === 'document' || r.emitterDependency === scope.dependency),
    ...assignments.flatMap(a => a.responses || [])]
  if (responses.length) {
    if (evidence.responsesVerified === true) verified.push('responseReferences')
    else { missing.add('responseReferences'); reasons.add('RESPONSE_EVIDENCE_INCOMPLETE') }
  }
  if ((envelope.reviewOperations || []).some(o => (scope.type === 'document' || o.dependency === scope.dependency) && o.phase !== 'COMMITTED')) reasons.add('RECONCILIATION_REQUIRED')
  if (summary.exigible > 0 && !summary.pending && !summary.unverifiedCancelled) fulfilled.push('ALL_EXIGIBLE_ASSIGNMENTS_ATTENDED')
  if (summary.total > 0 && summary.validCancelled === summary.total) fulfilled.push('ALL_ASSIGNMENTS_VALIDLY_CANCELLED')
  const blocked = evidenceIssues.some(issue => issue.blocked === true) || ['OBLIGATIONS_PENDING', 'CANCELLATION_AUTHORITY_REJECTED', 'PROJECTION_MISMATCH', 'ORIGIN_ASSIGNMENT_INCONSISTENT',
    'RECONCILIATION_REQUIRED', 'KNOWLEDGE_CONFIRMATIONS_PENDING', 'KNOWLEDGE_CONFIRMATION_INCONSISTENT', 'KNOWLEDGE_CLASSIFICATION_CONFLICT', 'INTEGRAL_CLOSURE_DISABLED'].some(c => reasons.has(c))
  return { schemaVersion: 1, documentId: envelope.documentId, scope, envelopeRevision: envelope.revision, summary, knowledgeSummary,
    policy: closurePolicy,
    preliminaryCompliance: blocked ? 'BLOCKED' : reasons.size ? 'INDETERMINATE' : 'MET',
    fulfilledRequirements: fulfilled, blockingReasons: [...reasons], evidence: { verified, missing: [...missing] },
    pendingPolicies: [...policies], evaluatedAt, formalClosureAllowed: false, canRequestFormalClosure: false,
    writesEnabled: false }
}
