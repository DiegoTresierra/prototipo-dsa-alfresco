import { createHash } from 'node:crypto'

export const reviewStates = ['BORRADOR', 'EN_REVISION_JEFATURA', 'OBSERVADA', 'EN_REVISION_DIRECCION', 'APROBADA', 'EMITIDA']
export const reviewHash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { status }) }
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 250
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const time = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const roles = ['direccion', 'jefe-unidad', 'especialista']
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k))
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
export function validateReviewEmission(receipt) {
  const r = receipt?.record
  if (!exact(receipt, ['schemaVersion', 'originalDocumentId', 'proposalDocumentId', 'processId', 'approvalEventId', 'versionId', 'contentSha256', 'metadataSha256', 'record']) ||
      receipt.schemaVersion !== 1 || ![receipt.originalDocumentId, receipt.proposalDocumentId, receipt.processId, receipt.approvalEventId].every(text) ||
      !/^[0-9]+\.[0-9]+$/.test(receipt.versionId) || !hash(receipt.contentSha256) || !hash(receipt.metadataSha256) ||
      !exact(r, ['documentId', 'documentCode', 'cycle', 'number', 'actorId', 'requestKey', 'payloadHash']) ||
      ![r.documentId, r.documentCode, r.actorId, r.requestKey].every(text) || !hash(r.payloadHash) ||
      !Number.isSafeInteger(r.cycle) || r.cycle < 1 || !Number.isSafeInteger(r.number) || r.number < 1 ||
      r.documentId === receipt.originalDocumentId || r.documentId === receipt.proposalDocumentId) fail('REVIEW_INVALID_EMISSION_RECEIPT', 422)
  if (r.requestKey !== `review-${reviewHash(JSON.stringify([receipt.originalDocumentId, receipt.processId, receipt.approvalEventId]))}`) fail('REVIEW_INVALID_EMISSION_RECEIPT', 422)
}
export function proposalMetadataHash(node) {
  // Explicit approval-relevant fields; audit dates and version bookkeeping are excluded.
  return reviewHash(JSON.stringify([node.properties?.['cm:title'] || '', node.properties?.['cm:description'] || '', node.properties?.['gd:tipoDocumental'] || '', node.properties?.['gd:dependenciaOrigen'] || '']))
}
export function verifyProposalPdf(bytes, expectedHash) {
  if (!bytes.length || bytes.subarray(0, 5).toString() !== '%PDF-') fail('PROPOSAL_INVALID_VERSION', 422)
  if (reviewHash(bytes) !== expectedHash) fail('PROPOSAL_CONTENT_CHANGED', 409)
}
export function assertReviewResponseLink(envelope, responseDocumentId) {
  if (!envelope.reviewProcesses?.length) return
  const p = envelope.reviewProcesses.find((p) => p.state === 'EMITIDA' && p.emissionDocumentId === responseDocumentId &&
    p.events.some((event) => event.action === 'EMIT' && event.emission?.record.documentId === responseDocumentId))
  if (!p || (envelope.reviewOperations || []).some((o) => o.processId === p.id && o.phase !== 'COMMITTED')) fail('RESPONSE_REVIEW_EMISSION_REQUIRED', 403)
}

// Pure state machine. Input authority is supplied ONLY by a future server-side institutional resolver.
export function applyReviewEvent(process, event, authority = {}) {
  if (!exact(event, ['id', 'requestKey', 'action', 'actorUserId', 'actorRole', 'dependency', 'at', 'expectedRevision', 'snapshot', 'reason', 'emissionDocumentId', ...(event?.review === undefined ? [] : ['review']), ...(event?.emission === undefined ? [] : ['emission'])]) ||
      ![event.id, event.requestKey, event.actorUserId].every(text) || !roles.includes(event.actorRole) ||
      !['dti', 'dsa'].includes(event.dependency) || !time(event.at) || !Number.isSafeInteger(event.expectedRevision) ||
      typeof event.reason !== 'string' || event.reason.length > 4000) fail('REVIEW_INVALID_EVENT', 422)
  const previous = process.events.find((e) => e.actorUserId === event.actorUserId && e.requestKey === event.requestKey)
  if (previous) {
    if (!same(previous, event)) fail('REVIEW_IDEMPOTENCY_CONFLICT')
    return process
  }
  if (process.events.some((e) => e.id === event.id)) fail('REVIEW_DUPLICATE_EVENT')
  if (event.expectedRevision !== process.revision) fail('REVIEW_STALE_REVISION')
  if (process.events.length && Date.parse(event.at) < Date.parse(process.events.at(-1).at)) fail('REVIEW_INVALID_HISTORY', 422)
  if (authority.verified !== true || event.dependency !== process.dependency) fail('REVIEW_AUTHORITY_REQUIRED', 403)
  if (event.emission !== undefined) {
    validateReviewEmission(event.emission)
    const r = event.emission
    if (event.action !== 'EMIT' || r.originalDocumentId !== process.originalDocumentId || r.proposalDocumentId !== process.proposalDocumentId ||
        r.processId !== process.id || r.approvalEventId !== process.approval?.eventId || r.record.documentId !== event.emissionDocumentId ||
        r.record.actorId !== event.actorUserId || r.record.documentCode !== process.dependency.toUpperCase() ||
        ['versionId', 'contentSha256', 'metadataSha256'].some((k) => r[k] !== process.snapshot?.[k])) fail('REVIEW_INVALID_EMISSION_RECEIPT', 422)
  }
  if (event.review !== undefined) {
    const r = event.review
    if (!exact(r, ['schemaVersion', 'processId', 'affectedRevision', 'snapshot', 'recipient']) || r.schemaVersion !== 1 || r.processId !== process.id ||
        r.affectedRevision !== event.expectedRevision || !same(r.snapshot, process.snapshot) ||
        !['SUBMIT', 'OBSERVE', 'ELEVATE', 'RETURN', 'APPROVE'].includes(event.action)) fail('REVIEW_INVALID_DECISION', 422)
    if (authority.reviewerVerified !== true) fail('REVIEW_REVIEWER_NOT_VERIFIED', 403)
    if (event.action === 'APPROVE' ? r.recipient !== null :
      !exact(r.recipient, ['userId', 'functionalRole', 'dependency']) || !text(r.recipient.userId) || !roles.includes(r.recipient.functionalRole) || r.recipient.dependency !== process.dependency) fail('REVIEW_INVALID_RECIPIENT', 422)
    if (event.action === 'SUBMIT' && process.state === 'OBSERVADA') fail('REVIEW_NEW_REVISION_REQUIRED')
    const expectedRole = event.action === 'SUBMIT' ? process.authorRole === 'especialista' ? 'jefe-unidad' : 'direccion' : event.action === 'ELEVATE' ? 'direccion' : process.authorRole
    if (r.recipient && r.recipient.functionalRole !== expectedRole) fail('REVIEW_INVALID_RECIPIENT', 422)
    if (['OBSERVE', 'RETURN'].includes(event.action) && r.recipient.userId !== process.authorUserId) fail('REVIEW_INVALID_RECIPIENT', 422)
    if (event.action !== 'SUBMIT') {
      const routed = process.events.filter((e) => ['SUBMIT', 'ELEVATE'].includes(e.action) && e.review?.snapshot.versionId === process.snapshot.versionId).at(-1)?.review?.recipient
      if (!routed || routed.userId !== event.actorUserId || routed.functionalRole !== event.actorRole || routed.dependency !== event.dependency) fail('REVIEW_REVIEWER_NOT_VERIFIED', 403)
    }
  }
  let state = process.state
  let snapshot = process.snapshot
  let approval = process.approval
  let emissionDocumentId = process.emissionDocumentId
  const author = event.actorUserId === process.authorUserId && event.actorRole === process.authorRole
  if (event.action === 'CREATE' || event.action === 'REVISE') {
    if (!author || event.action === 'CREATE' && process.revision !== 0 || event.action === 'REVISE' && (!process.revision || state === 'EMITIDA')) fail('REVIEW_TRANSITION_DENIED', 403)
    if (!exact(event.snapshot, ['versionId', 'contentSha256', 'metadataSha256']) || !/^[0-9]+\.[0-9]+$/.test(event.snapshot.versionId) ||
        !hash(event.snapshot.contentSha256) || !hash(event.snapshot.metadataSha256)) fail('REVIEW_INVALID_SNAPSHOT', 422)
    if (process.events.some((e) => e.snapshot?.versionId === event.snapshot.versionId)) fail('REVIEW_VERSION_ALREADY_REGISTERED')
    snapshot = event.snapshot; approval = null; state = 'BORRADOR'
  } else {
    if (event.snapshot !== null || !snapshot) fail('REVIEW_INVALID_SNAPSHOT', 422)
    if (event.action === 'SUBMIT' && author && ['BORRADOR', 'OBSERVADA'].includes(state)) {
      if (event.actorRole === 'especialista' && authority.supervisorVerified !== true) fail('ORGANIZATIONAL_HIERARCHY_PENDING', 503)
      state = event.actorRole === 'especialista' ? 'EN_REVISION_JEFATURA' : 'EN_REVISION_DIRECCION'
    } else if (event.action === 'OBSERVE' && state === 'EN_REVISION_JEFATURA' && event.actorRole === 'jefe-unidad' && authority.supervisorVerified === true && event.reason.trim()) state = 'OBSERVADA'
    else if (event.action === 'ELEVATE' && state === 'EN_REVISION_JEFATURA' && event.actorRole === 'jefe-unidad' && authority.supervisorVerified === true) state = 'EN_REVISION_DIRECCION'
    else if (event.action === 'RETURN' && state === 'EN_REVISION_DIRECCION' && event.actorRole === 'direccion' && event.reason.trim()) state = 'OBSERVADA'
    else if (event.action === 'APPROVE' && state === 'EN_REVISION_DIRECCION' && event.actorRole === 'direccion') {
      if (event.actorUserId === process.authorUserId) fail('REVIEW_SELF_APPROVAL_POLICY_PENDING', 403)
      state = 'APROBADA'; approval = { eventId: event.id, ...snapshot }
    } else if (event.action === 'EMIT' && state === 'APROBADA' && event.actorRole === 'direccion' && authority.emissionVerified === true && text(event.emissionDocumentId)) {
      state = 'EMITIDA'; emissionDocumentId = event.emissionDocumentId
    } else fail('REVIEW_TRANSITION_DENIED', 403)
  }
  if (event.action !== 'EMIT' && event.emissionDocumentId !== null) fail('REVIEW_INVALID_EVENT', 422)
  return { ...process, revision: process.revision + 1, state, snapshot, approval, emissionDocumentId, events: [...process.events, structuredClone(event)] }
}

export function validateReviewProcesses(processes, documentId, assignments) {
  if (processes === undefined) return
  if (!Array.isArray(processes)) fail('REVIEW_INVALID_PROCESSES', 422)
  const ids = new Set(); const nodes = new Set()
  for (const p of processes) {
    if (!exact(p, ['schemaVersion', 'id', 'originalDocumentId', 'proposalDocumentId', 'authorUserId', 'authorRole', 'dependency', 'assignmentId', 'revision', 'state', 'snapshot', 'events', 'approval', 'emissionDocumentId']) ||
        p.schemaVersion !== 1 || ![p.id, p.proposalDocumentId, p.authorUserId].every(text) || p.proposalDocumentId === documentId ||
        p.originalDocumentId !== documentId || !roles.includes(p.authorRole) || !['dti', 'dsa'].includes(p.dependency) ||
        !Number.isSafeInteger(p.revision) || p.revision < 1 || !reviewStates.includes(p.state) || !Array.isArray(p.events) || !p.events.length ||
        ids.has(p.id) || nodes.has(p.proposalDocumentId)) fail('REVIEW_INVALID_PROCESS', 422)
    if (p.assignmentId !== null) {
      const a = assignments.get(p.assignmentId)
      if (!a || a.userId !== p.authorUserId || a.functionalRole !== p.authorRole || a.dependency !== p.dependency) fail('REVIEW_INVALID_ASSIGNMENT', 422)
    } else if (p.authorRole !== 'direccion') fail('REVIEW_INVALID_ASSIGNMENT', 422)
    let replay = { ...p, revision: 0, state: 'BORRADOR', snapshot: null, events: [], approval: null, emissionDocumentId: null }
    for (const event of p.events) {
      if (!replay.revision && event.action !== 'CREATE' || replay.revision && event.action === 'CREATE') fail('REVIEW_INVALID_HISTORY', 422)
      const next = applyReviewEvent(replay, event, { verified: true, supervisorVerified: true, emissionVerified: true, reviewerVerified: true })
      if (next.revision !== replay.revision + 1 || replay.events.length && Date.parse(event.at) < Date.parse(replay.events.at(-1).at)) fail('REVIEW_INVALID_HISTORY', 422)
      replay = next
    }
    for (const key of ['revision', 'state', 'snapshot', 'approval', 'emissionDocumentId']) if (!same(p[key], replay[key])) fail('REVIEW_INVALID_HISTORY', 422)
    ids.add(p.id); nodes.add(p.proposalDocumentId)
  }
}
