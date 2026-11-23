import { parseAssignments } from './alfrescoDispatchRepository.js'
import { assignmentIsActive } from './attentionPolicy.js'
import { evaluateClosure } from './closureEvaluation.js'
import { evidenceHash } from './closureEvidenceContract.js'

const text = v => typeof v === 'string' && v.trim().length > 0
const attested = v => v?.verified === true && v.source === 'alfresco' && text(v.reference)
const revision = v => Number.isSafeInteger(v) && v >= 0
const uniqueStrings = v => Array.isArray(v) && v.every(text) && new Set(v).size === v.length

/**
 * Pure diagnostic, NOT an authorization service or HTTP input validator.
 * All attestations must come from a future trusted, actor-authorized Alfresco reader.
 * Structural checks cannot authenticate those claims. No network, clock, persistence or locks.
 *
 * Input: scope {unitId, headUserId, dependency}; evaluatedAt (server time);
 * hierarchy/finalHierarchy: attested complete snapshots, same scope, revision, specialistUserIds;
 * coverage: attested complete DIRECT_CHILDREN_AND_RELATIONS inventory, same scope,
 * hierarchyRevision, documentIds, scopesComplete. A search result is never clearance.
 * documents: {documentId, rawAssignments, currentAssignments, expectedRevision,
 *   originalRead: attestation, institutionalScope: attestation,
 *   closureEvidence: trusted readClosureEvidence result}.
 * currentAssignments is a final GET snapshot, not just the revision counter.
 * Specialist obligations remain separate; supervision alone never transfers responsibility.
 */
export function hasPendingResponsibilities(input = {}) {
  const { scope = {}, hierarchy, finalHierarchy, coverage, evaluatedAt } = input
  const pending = [], missing = [], used = [], documents = [], specialists = []
  const add = (list, code, context = {}) => list.push({ code, ...context })
  const scopeValid = text(scope.unitId) && text(scope.headUserId) && ['dsa', 'dti'].includes(scope.dependency)
  if (!scopeValid) add(missing, 'RESPONSIBILITY_SCOPE_INVALID')
  if (!text(evaluatedAt) || !Number.isFinite(Date.parse(evaluatedAt))) add(missing, 'EVALUATION_TIME_INVALID')
  const sameScope = v => scopeValid && v?.unitId === scope.unitId && v.headUserId === scope.headUserId && v.dependency === scope.dependency
  const validHierarchy = v => attested(v) && sameScope(v) && v.complete === true && revision(v.revision) &&
    uniqueStrings(v.specialistUserIds) && !v.specialistUserIds.includes(scope.headUserId)
  if (!validHierarchy(hierarchy)) add(missing, 'INSTITUTIONAL_RELATIONSHIPS_UNVERIFIED')
  else used.push({ kind: 'hierarchy', reference: hierarchy.reference, revision: hierarchy.revision })
  if (!validHierarchy(finalHierarchy) || !validHierarchy(hierarchy) ||
      finalHierarchy.revision !== hierarchy.revision || evidenceHash(finalHierarchy.specialistUserIds.slice().sort()) !== evidenceHash(hierarchy.specialistUserIds.slice().sort())) {
    add(missing, 'HIERARCHY_CHANGED_OR_UNCONFIRMED')
  } else used.push({ kind: 'finalHierarchy', reference: finalHierarchy.reference, revision: finalHierarchy.revision })

  const coverageValid = attested(coverage) && sameScope(coverage) && coverage.complete === true && coverage.scopesComplete === true &&
    coverage.method === 'DIRECT_CHILDREN_AND_RELATIONS' && validHierarchy(hierarchy) &&
    coverage.hierarchyRevision === hierarchy.revision && uniqueStrings(coverage.documentIds)
  if (!coverageValid) add(missing, 'DOCUMENT_COVERAGE_INCOMPLETE')
  else used.push({ kind: 'coverage', reference: coverage.reference })
  const seen = new Set()
  if (!Array.isArray(input.documents)) add(missing, 'DOCUMENT_INVENTORY_INVALID')
  for (const d of Array.isArray(input.documents) ? input.documents : []) {
    if (!text(d?.documentId) || seen.has(d.documentId)) { add(missing, 'DOCUMENT_ID_INVALID_OR_DUPLICATE'); continue }
    seen.add(d.documentId)
    const ctx = { documentId: d.documentId }
    // Both attestations must be bound to this UUID. Source folder/dependency may differ:
    // a secondary association can establish legitimate responsibility on the same original.
    if (![d.originalRead, d.institutionalScope].every(v => attested(v) && v.documentId === d.documentId) ||
        !sameScope(d.institutionalScope)) {
      add(missing, 'DOCUMENT_ACCESS_OR_SCOPE_UNVERIFIED', ctx); continue
    }
    let envelope
    try { envelope = parseAssignments(d.rawAssignments, d.documentId) }
    catch { add(missing, 'DOCUMENT_ENVELOPE_INVALID', ctx); continue }
    const digest = evidenceHash(d.rawAssignments ?? null)
    documents.push({ ...ctx, revision: envelope.revision, assignmentsHash: digest })
    used.push({ kind: 'document', ...ctx, reference: d.originalRead.reference, scopeReference: d.institutionalScope.reference,
      revision: envelope.revision, assignmentsHash: digest })
    if (!Object.hasOwn(d, 'currentAssignments') || d.currentAssignments !== d.rawAssignments ||
        d.expectedRevision !== envelope.revision) {
      add(missing, 'DOCUMENT_REVISION_STALE', ctx)
      // A superseded pending snapshot cannot prove a CURRENT responsibility either.
      continue
    }
    const all = envelope.dispatches.flatMap(r => r.recipients)
    for (const a of all) {
      const own = scopeValid && a.userId === scope.headUserId && a.functionalRole === 'jefe-unidad' && a.dependency === scope.dependency
      const specialist = validHierarchy(hierarchy) && a.functionalRole === 'especialista' &&
        a.dependency === scope.dependency && hierarchy.specialistUserIds.includes(a.userId)
      if (specialist) specialists.push({ ...ctx, assignmentId: a.id, userId: a.userId, status: a.status,
        pending: assignmentIsActive(a), attributedToHead: false })
      if (!own) {
        if (scopeValid && a.userId === scope.headUserId) add(missing, 'HEAD_ASSIGNMENT_IDENTITY_INCONSISTENT', { ...ctx, assignmentId: a.id })
        continue
      }
      const binding = { ...ctx, assignmentId: a.id, originAssignmentId: a.originAssignmentId }
      if (assignmentIsActive(a)) add(pending, 'HEAD_ASSIGNMENT_PENDING', binding)
      else if (a.status === 'ANULADO') {
        // Reuse the existing cancellation policy and trusted reader contract. No new evidence state.
        const view = { ...envelope, dispatches: [{ recipients: [a] }] }
        const r = evaluateClosure({ envelope: view, scope: { type: 'dependency', dependency: scope.dependency },
          evidence: d.closureEvidence || {}, evaluatedAt: Number.isFinite(Date.parse(evaluatedAt)) ? evaluatedAt : '1970-01-01T00:00:00Z' })
        if (r.summary.validCancelled !== 1 || d.closureEvidence?.evidenceIssues?.length) add(missing, 'CANCELLATION_AUTHORIZATION_UNVERIFIED', binding)
        else used.push({ kind: 'cancellation', ...binding, evidenceHash: evidenceHash(d.closureEvidence.cancellations[a.id]) })
      } else if (a.status === 'ATENDIDO' && !envelope.history.some(e => e.action === 'ASSIGNMENT_ATTENDED' &&
          e.actorUserId === a.userId && e.assignmentIds.includes(a.id) && e.at === a.attendedAt)) {
        add(missing, 'ATTENDANCE_EVIDENCE_INCOMPLETE', binding)
      }
    }
    for (const p of envelope.reviewProcesses || []) {
      const ownAuthor = scopeValid && p.authorUserId === scope.headUserId && p.authorRole === 'jefe-unidad' && p.dependency === scope.dependency
      if (ownAuthor && ['BORRADOR', 'OBSERVADA'].includes(p.state)) add(pending, 'HEAD_PROPOSAL_ACTION_PENDING', { ...ctx, processId: p.id, processRevision: p.revision })
      if (p.state === 'EN_REVISION_JEFATURA') {
        const recipient = p.events.filter(e => ['SUBMIT', 'ELEVATE'].includes(e.action) && e.review?.snapshot.versionId === p.snapshot.versionId).at(-1)?.review?.recipient
        if (!recipient) add(missing, 'REVIEW_RECIPIENT_UNVERIFIED', { ...ctx, processId: p.id })
        else if (scopeValid && recipient.userId === scope.headUserId && recipient.functionalRole === 'jefe-unidad' && recipient.dependency === scope.dependency) {
          add(pending, 'HEAD_REVIEW_PENDING', { ...ctx, processId: p.id, processRevision: p.revision })
        }
      }
      // Approval pending at Direccion is not automatically a task of the historical head.
    }
    for (const o of [...(envelope.reviewOperations || []), ...(envelope.closureOperations || [])]) {
      if (o.phase === 'COMMITTED') continue
      const p = envelope.reviewProcesses?.find(p => p.id === o.processId)
      const routed = p?.events.filter(e => ['SUBMIT', 'ELEVATE'].includes(e.action) && e.review?.snapshot.versionId === p.snapshot.versionId).at(-1)?.review?.recipient
      if (scopeValid && o.dependency === scope.dependency && (o.actorUserId === scope.headUserId ||
          p?.authorUserId === scope.headUserId || routed?.userId === scope.headUserId)) {
        add(pending, 'HEAD_OPERATION_RECONCILIATION_REQUIRED', { ...ctx, operationId: o.id, phase: o.phase })
      } else add(missing, 'UNRESOLVED_OPERATION_COMPETENCE', { ...ctx, operationId: o.id })
    }
  }
  if (coverageValid && (seen.size !== coverage.documentIds.length || coverage.documentIds.some(id => !seen.has(id)))) add(missing, 'DOCUMENT_INVENTORY_MISMATCH')
  const status = pending.length ? 'HAS_PENDING' : missing.length ? 'INDETERMINATE' : 'NO_PENDING'
  return { schemaVersion: 1, scope: { ...scope }, status, hasPendingResponsibilities: status === 'HAS_PENDING' ? true : status === 'NO_PENDING' ? false : null,
    blockingReasons: [...pending, ...missing], pendingResponsibilities: pending, evidenceGaps: missing,
    evidence: used, documentRevisions: documents, hierarchyRevision: hierarchy?.revision ?? null,
    specialistResponsibilities: specialists, coverageComplete: coverageValid && !missing.length,
    evaluatedAt, headChangeAllowed: false, writesEnabled: false }
}
