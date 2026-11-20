import { evidenceHash } from './closureEvidenceContract.js'
const fail = () => { throw Object.assign(new Error('CLOSURE_INVALID_PROCESS_CONTRACT'), { status: 422 }) }
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k))
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 250
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const time = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
export const closureOperationId = (documentId, actorUserId, requestKey) => evidenceHash(['CLOSE_INTERVENTION', documentId, actorUserId, requestKey])
export const closureProcessId = (documentId, dependency) => evidenceHash(['DEPENDENCY_CLOSURE', documentId, dependency])
export const closureIntentHash = o => evidenceHash([o.documentId, o.dependency, o.actorUserId, o.requestKey, o.reason, o.expectedEnvelopeRevision])
export function closureSourceHash(envelope) {
  const { revision, closureProcesses, closureOperations, ...source } = envelope
  return evidenceHash(source)
}
export function validateOrdinaryClosures(envelope) {
  if (envelope.closureProcesses === undefined && envelope.closureOperations === undefined) return
  if (!Array.isArray(envelope.closureProcesses) || !Array.isArray(envelope.closureOperations)) fail()
  const ops = new Map(), deps = new Set()
  const assignments = new Map(envelope.dispatches.flatMap(d => d.recipients).map(a => [a.id, a]))
  for (const o of envelope.closureOperations) {
    if (!exact(o, ['schemaVersion', 'executionMode', 'id', 'processId', 'documentId', 'dependency', 'actorUserId', 'requestKey', 'reason', 'expectedEnvelopeRevision', 'phase', 'at', 'payloadHash', 'sourceHash', 'evaluationHash']) ||
        o.schemaVersion !== 1 || o.executionMode !== 'SIMULATED' || ![o.documentId, o.actorUserId, o.requestKey].every(text) || o.documentId !== envelope.documentId ||
        !['dsa', 'dti'].includes(o.dependency) || typeof o.reason !== 'string' || !o.reason.trim() || o.reason.length > 2000 ||
        !Number.isSafeInteger(o.expectedEnvelopeRevision) || o.expectedEnvelopeRevision < 0 || o.expectedEnvelopeRevision >= envelope.revision ||
        !['PREPARED', 'COMMITTED'].includes(o.phase) || !time(o.at) || ![o.payloadHash, o.sourceHash, o.evaluationHash].every(hash) ||
        o.id !== closureOperationId(o.documentId, o.actorUserId, o.requestKey) || ops.has(o.id) ||
        o.processId !== closureProcessId(o.documentId, o.dependency) || o.payloadHash !== closureIntentHash(o)) fail()
    ops.set(o.id, o)
  }
  for (const p of envelope.closureProcesses) {
    if (!exact(p, ['schemaVersion', 'executionMode', 'id', 'documentId', 'dependency', 'state', 'authority', 'at', 'reason', 'sourceEnvelopeRevision', 'committedEnvelopeRevision', 'evidence', 'events']) ||
        p.schemaVersion !== 1 || p.executionMode !== 'SIMULATED' || p.documentId !== envelope.documentId || !['dsa', 'dti'].includes(p.dependency) || deps.has(p.dependency) ||
        p.id !== closureProcessId(p.documentId, p.dependency) || p.state !== 'CERRADA' || !time(p.at) ||
        !Number.isSafeInteger(p.sourceEnvelopeRevision) || p.sourceEnvelopeRevision < 0 || p.committedEnvelopeRevision !== p.sourceEnvelopeRevision + 2 ||
        p.committedEnvelopeRevision > envelope.revision || !Array.isArray(p.events) || p.events.length !== 1 ||
        !exact(p.authority, ['userId', 'functionalRole', 'dependency', 'reference', 'groupIds']) || !text(p.authority.userId) ||
        p.authority.functionalRole !== 'direccion' || p.authority.dependency !== p.dependency || !text(p.authority.reference) ||
        !Array.isArray(p.authority.groupIds) || !p.authority.groupIds.length || p.authority.groupIds.some(g => !text(g)) ||
        !exact(p.evidence, ['sourceHash', 'evaluationHash', 'assignmentIds']) || !hash(p.evidence.sourceHash) || !hash(p.evidence.evaluationHash) ||
        !Array.isArray(p.evidence.assignmentIds) || p.evidence.assignmentIds.some(id => !text(id) || assignments.get(id)?.dependency !== p.dependency) || new Set(p.evidence.assignmentIds).size !== p.evidence.assignmentIds.length) fail()
    const e = p.events[0], o = ops.get(e?.operationId)
    if (!exact(e, ['id', 'operationId', 'action', 'actorUserId', 'at', 'requestKey', 'payloadHash']) || !o || o.phase !== 'COMMITTED' ||
        e.id !== `${o.id}-closed` || e.action !== 'CLOSE_INTERVENTION' || e.actorUserId !== o.actorUserId || e.actorUserId !== p.authority.userId ||
        e.at !== o.at || e.at !== p.at || e.requestKey !== o.requestKey || e.payloadHash !== o.payloadHash ||
        p.id !== o.processId || p.dependency !== o.dependency || p.reason !== o.reason || p.sourceEnvelopeRevision !== o.expectedEnvelopeRevision ||
        p.evidence.sourceHash !== o.sourceHash || p.evidence.evaluationHash !== o.evaluationHash) fail()
    deps.add(p.dependency)
  }
  for (const o of ops.values()) if (o.phase === 'COMMITTED' && !envelope.closureProcesses.some(p => p.events[0].operationId === o.id)) fail()
  for (const o of ops.values()) if (o.phase === 'PREPARED' && deps.has(o.dependency)) fail()
}
