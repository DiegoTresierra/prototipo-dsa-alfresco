import { applyReviewEvent, reviewHash } from './responseReview.js'

const fail = (code, status = 409) => { throw Object.assign(new Error(code), { status }) }
const actions = ['SUBMIT', 'OBSERVE', 'ELEVATE', 'RETURN', 'APPROVE']
const pureAuthority = { verified: true, supervisorVerified: true, reviewerVerified: true, emissionVerified: true }
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v
const stable = (v) => JSON.stringify(canonical(v))

// Provider is a trusted server-side read-only integration boundary, not a request field.
async function resolveReviewer(provider, context, process, stage) {
  if (typeof provider?.resolveReviewers !== 'function') fail('REVIEW_INSTITUTIONAL_PROVIDER_PENDING', 503)
  let result
  try {
    result = await provider.resolveReviewers({ processId: process.id, documentId: process.originalDocumentId,
      authorUserId: process.authorUserId, authorRole: process.authorRole, dependency: process.dependency, stage })
  } catch { fail('REVIEW_REVIEWER_UNAVAILABLE', 503) }
  if (result?.verified !== true || !Array.isArray(result.reviewers) || !result.reviewers.length) fail('REVIEW_REVIEWER_NOT_VERIFIED', 503)
  if (result.reviewers.length !== 1) fail('REVIEW_REVIEWER_AMBIGUOUS')
  const candidate = result.reviewers[0]
  if (typeof candidate?.userId !== 'string' || !candidate.userId || !Array.isArray(candidate.groupIds) || !candidate.groupIds.length ||
      candidate.groupIds.some((g) => typeof g !== 'string' || !g.startsWith('GROUP_'))) fail('REVIEW_REVIEWER_NOT_VERIFIED', 503)
  let person
  try { person = await context.person(candidate.userId) }
  catch (error) { fail(error.status === 403 ? 'REVIEW_REVIEWER_NOT_VERIFIED' : 'REVIEW_REVIEWER_UNAVAILABLE', error.status === 403 ? 403 : 503) }
  const role = stage === 'jefatura' ? 'jefe-unidad' : 'direccion'
  if (person.functionalRole !== role || person.dependency !== process.dependency || !candidate.groupIds.every((g) => person.groups.includes(g))) fail('REVIEW_REVIEWER_NOT_VERIFIED', 403)
  return { userId: person.userId, functionalRole: person.functionalRole, dependency: person.dependency }
}

async function authorityFor(input, p, context, provider) {
  const { identity } = context
  const actorId = identity.person.id
  if (identity.dependency.toLowerCase() !== p.dependency) fail('REVIEW_DEPENDENCY_MISMATCH', 403)
  if (input.action === 'SUBMIT') {
    if (actorId !== p.authorUserId || identity.functionalRole !== p.authorRole) fail('REVIEW_AUTHOR_REQUIRED', 403)
    if (p.state === 'OBSERVADA') fail('REVIEW_NEW_REVISION_REQUIRED')
    if (p.state !== 'BORRADOR') fail('REVIEW_INVALID_STATE')
    return resolveReviewer(provider, context, p, p.authorRole === 'especialista' ? 'jefatura' : 'direccion')
  }
  const head = ['OBSERVE', 'ELEVATE'].includes(input.action)
  if (p.state !== (head ? 'EN_REVISION_JEFATURA' : 'EN_REVISION_DIRECCION')) fail('REVIEW_INVALID_STATE')
  if (identity.functionalRole !== (head ? 'jefe-unidad' : 'direccion')) fail('REVIEW_REVIEWER_NOT_VERIFIED', 403)
  if (input.action === 'APPROVE' && actorId === p.authorUserId) fail('REVIEW_SELF_APPROVAL_POLICY_PENDING', 403)
  const routed = p.events.filter((ev) => ['SUBMIT', 'ELEVATE'].includes(ev.action) && ev.review?.snapshot.versionId === p.snapshot.versionId).at(-1)?.review?.recipient
  if (!routed) fail('REVIEW_ROUTING_REQUIRED', 503)
  const current = await resolveReviewer(provider, context, p, head ? 'jefatura' : 'direccion')
  if (current.userId !== routed.userId || current.functionalRole !== routed.functionalRole || current.dependency !== routed.dependency) fail('REVIEW_REVIEWER_CHANGED')
  if (current.userId !== actorId) fail('REVIEW_REVIEWER_NOT_VERIFIED', 403)
  if (input.action === 'ELEVATE') return resolveReviewer(provider, context, p, 'direccion')
  if (input.action === 'APPROVE') return null
  let author
  try { author = await context.person(p.authorUserId) } catch { fail('REVIEW_RECIPIENT_NOT_VERIFIED', 503) }
  if (author.functionalRole !== p.authorRole || author.dependency !== p.dependency) fail('REVIEW_RECIPIENT_NOT_VERIFIED', 403)
  return { userId: author.userId, functionalRole: author.functionalRole, dependency: author.dependency }
}

function beforeEvent(p, index) {
  let replay = { ...p, revision: 0, state: 'BORRADOR', snapshot: null, events: [], approval: null, emissionDocumentId: null }
  for (const event of p.events.slice(0, index)) replay = applyReviewEvent(replay, event, pureAuthority)
  return replay
}

export async function verifyCurrentApproval(p, context, provider) {
  if (!['APROBADA', 'EMITIDA'].includes(p.state) || !p.approval) fail('REVIEW_APPROVAL_REQUIRED')
  const index = p.events.findIndex((e) => e.id === p.approval.eventId && e.action === 'APPROVE')
  const event = p.events[index]
  if (!event?.review || stable(event.review.snapshot) !== stable(p.snapshot) ||
      ['versionId', 'contentSha256', 'metadataSha256'].some((k) => p.approval[k] !== p.snapshot[k])) fail('REVIEW_APPROVAL_OUTDATED')
  if (event.actorUserId === p.authorUserId) fail('REVIEW_SELF_APPROVAL_POLICY_PENDING', 403)
  if (context.identity.functionalRole !== 'direccion' || context.identity.dependency.toLowerCase() !== p.dependency) fail('REVIEW_EMISSION_AUTHORITY_REQUIRED', 403)
  const approver = await context.person(event.actorUserId)
  if (approver.functionalRole !== 'direccion' || approver.dependency !== p.dependency) fail('REVIEW_APPROVER_NOT_VERIFIED', 403)
  const current = await resolveReviewer(provider, context, beforeEvent(p, index), 'direccion')
  if (current.userId !== event.actorUserId || current.userId !== context.identity.person.id) fail('REVIEW_EMISSION_AUTHORITY_REQUIRED', 403)
  await context.verify(p)
  return { originalDocumentId: p.originalDocumentId, processId: p.id, proposalDocumentId: p.proposalDocumentId,
    approvalEventId: event.id, versionId: p.snapshot.versionId, contentSha256: p.snapshot.contentSha256, metadataSha256: p.snapshot.metadataSha256 }
}

export function createResponseReviewDecisions({ alfrescoAdapter, institutionalProvider, clock = () => new Date() } = {}) {
  async function decide(input, session, { reconcile = false } = {}) {
    const keys = ['documentId', 'processId', 'action', 'requestKey', 'expectedRevision', 'expectedVersionId', 'reason']
    if (!input || Object.keys(input).length !== keys.length || Object.keys(input).some((k) => !keys.includes(k)) ||
        ![input.documentId, input.processId, input.requestKey].every((v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,250}$/.test(v)) ||
        !actions.includes(input.action) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
        typeof input.expectedVersionId !== 'string' || !/^[0-9]+\.[0-9]+$/.test(input.expectedVersionId) ||
        typeof input.reason !== 'string' || input.reason.length > 4000) fail('REVIEW_INVALID_INPUT', 422)
    if (['OBSERVE', 'RETURN'].includes(input.action) && !input.reason.trim()) fail('REVIEW_OBSERVATION_REQUIRED', 422)
    if (!alfrescoAdapter?.reviewTransaction) fail('PROPOSAL_WRITES_DISABLED', 503)
    try {
      return await alfrescoAdapter.reviewTransaction(input.documentId, session, async (context) => {
        let stored = context.original
        const p = stored.envelope.reviewProcesses?.find((p) => p.id === input.processId)
        if (!p) fail('REVIEW_PROCESS_NOT_AVAILABLE', 403)
        const actor = context.identity.person.id
        const id = reviewHash(JSON.stringify([input.documentId, actor, input.requestKey]))
        let op = stored.envelope.reviewOperations?.find((o) => o.id === id)
        const index = p.events.findIndex((ev) => ev.actorUserId === actor && ev.requestKey === input.requestKey)
        const previous = index >= 0 ? p.events[index] : null
        if (previous && (!previous.review || !op) || op && (!actions.includes(op.action) || op.processId !== p.id)) fail('REVIEW_IDEMPOTENCY_CONFLICT')
        if ((stored.envelope.reviewOperations || []).some((o) => o.id !== id && o.phase !== 'COMMITTED')) fail('REVIEW_RECONCILIATION_REQUIRED')
        if (op && op.phase !== 'COMMITTED' && !reconcile) fail('REVIEW_RECONCILIATION_REQUIRED')
        if (reconcile && !op) fail('REVIEW_OPERATION_NOT_FOUND', 404)
        const affected = previous ? beforeEvent(p, index) : p
        if (input.expectedRevision !== affected.revision) fail(previous ? 'REVIEW_IDEMPOTENCY_CONFLICT' : 'REVIEW_STALE_REVISION')
        if (input.expectedVersionId !== affected.snapshot.versionId) fail('REVIEW_STALE_VERSION')
        const recipient = await authorityFor(input, affected, context, institutionalProvider)
        await context.verify(p, affected.snapshot)
        const review = { schemaVersion: 1, processId: p.id, affectedRevision: affected.revision, snapshot: structuredClone(affected.snapshot), recipient }
        const payloadHash = reviewHash(stable([input.action, p.id, actor, context.identity.functionalRole,
          p.dependency, input.expectedRevision, input.expectedVersionId, input.reason, review]))
        if (op && op.payloadHash !== payloadHash) fail('REVIEW_IDEMPOTENCY_CONFLICT')
        if (op?.phase === 'COMMITTED' && !previous) fail('REVIEW_RESULT_UNCERTAIN', 502)
        const event = { id: `${id}-event`, requestKey: input.requestKey, action: input.action, actorUserId: actor,
          actorRole: context.identity.functionalRole, dependency: p.dependency, at: op?.at || clock().toISOString(),
          expectedRevision: input.expectedRevision, snapshot: null, reason: input.reason, emissionDocumentId: null, review }
        // Validate before writing the intention; repeated events must match their receipt.
        const next = applyReviewEvent(previous ? beforeEvent(p, index) : p, event, pureAuthority)
        if (previous && stable(previous) !== stable(event)) fail('REVIEW_IDEMPOTENCY_CONFLICT')
        if (previous && op.phase === 'COMMITTED') return { process: p, repeated: true, operationId: id }
        if (!op) {
          op = { schemaVersion: 1, id, requestKey: input.requestKey, actorUserId: actor, dependency: p.dependency,
            action: input.action, payloadHash, expectedRevision: input.expectedRevision, processId: p.id, proposalDocumentId: p.proposalDocumentId,
            previousVersionIds: [p.snapshot.versionId], phase: 'PREPARED', at: event.at, snapshot: structuredClone(p.snapshot) }
          const preview = { ...stored.envelope, revision: stored.envelope.revision + 2,
            reviewProcesses: stored.envelope.reviewProcesses.map((v) => v.id === p.id ? next : v),
            reviewOperations: [...(stored.envelope.reviewOperations || []), { ...op, phase: 'COMMITTED' }] }
          // Preflight full final size through the same strict parser before any PUT.
          context.validate(preview)
        }
        try {
          if (!stored.envelope.reviewOperations?.some((o) => o.id === id)) {
            stored = await context.save({ ...stored.envelope, revision: stored.envelope.revision + 1,
              reviewOperations: [...(stored.envelope.reviewOperations || []), op] }, stored.raw)
          }
          // Recheck PDF/version and live reviewer resolution before committing the decision.
          context.identity = await context.revalidate()
          const recipientNow = await authorityFor(input, affected, context, institutionalProvider)
          if (JSON.stringify(recipientNow) !== JSON.stringify(recipient)) fail('REVIEW_REVIEWER_CHANGED')
          await context.verify(p, affected.snapshot)
          stored = await context.save({ ...stored.envelope, revision: stored.envelope.revision + 1,
            reviewProcesses: stored.envelope.reviewProcesses.map((v) => v.id === p.id ? previous ? p : next : v),
            reviewOperations: stored.envelope.reviewOperations.map((o) => o.id === id ? { ...op, phase: 'COMMITTED' } : o) }, stored.raw)
          await context.verify(stored.envelope.reviewProcesses.find((v) => v.id === p.id), affected.snapshot)
          return { process: stored.envelope.reviewProcesses.find((v) => v.id === p.id), repeated: Boolean(previous), operationId: id }
        } catch (error) {
          try {
            const fresh = await context.read()
            if (fresh.envelope.reviewOperations?.some((o) => o.id === id)) {
              await context.save({ ...fresh.envelope, revision: fresh.envelope.revision + 1,
                reviewOperations: (fresh.envelope.reviewOperations || []).map((o) => o.id === id ? { ...o, phase: 'UNCERTAIN' } : o) }, fresh.raw)
            }
          } catch { /* PREPARED remains a durable recovery marker if available. */ }
          throw Object.assign(new Error('REVIEW_RESULT_UNCERTAIN'), { status: 502, cause: error })
        }
      })
    } catch (error) {
      if (['PROPOSAL_ACL_DENIED', 'PROPOSAL_ORIGINAL_FORBIDDEN', 'PROPOSAL_INACCESSIBLE'].includes(error.message)) fail('REVIEW_PERMISSION_INSUFFICIENT', 403)
      if (['PROPOSAL_INCONSISTENT', 'PROPOSAL_CONTENT_CHANGED', 'PROPOSAL_INVALID_VERSION'].includes(error.message)) fail('REVIEW_CONTENT_OR_METADATA_CHANGED')
      throw error
    }
  }
  return { decide, reconcile: (input, session) => decide(input, session, { reconcile: true }) }
}
