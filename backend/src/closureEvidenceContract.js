import { createHash } from 'node:crypto'

const fail = () => { throw Object.assign(new Error('CLOSURE_EVIDENCE_INVALID'), { status: 422 }) }
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k))
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 250
const serverTime = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === (v.includes('.') ? v : v.replace('Z', '.000Z'))
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
export const evidenceHash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const common = ['id', 'documentId', 'dependency', 'actorUserId', 'at', 'documentRevision', 'requestKey', 'eventId']
const actionFor = { cancellations: 'CANCEL_ASSIGNMENT', classifications: 'CLASSIFY_KNOWLEDGE', confirmations: 'ACKNOWLEDGE_KNOWLEDGE' }
const fields = { cancellations: ['assignmentId', 'reason'], classifications: ['exclusive', 'recipientUserIds'], confirmations: ['classificationId', 'recipientUserId'] }
export function evidenceEventId(record, action) {
  return evidenceHash([record.documentId, record.actorUserId, record.requestKey, action])
}

// Dedicated extension validator: the general assignments parser and its history remain unchanged.
export function validateClosureEvidence(envelope) {
  const extension = envelope.closureEvidence
  if (extension === undefined) return null
  if (!exact(extension, ['schemaVersion', 'cancellations', 'classifications', 'confirmations', 'events']) || extension.schemaVersion !== 1 ||
      ['cancellations', 'classifications', 'confirmations', 'events'].some(k => !Array.isArray(extension[k]))) fail()
  const ids = new Set(), operations = new Set(), linked = new Set(), cancelled = new Set(), classes = new Map(), confirmed = new Set()
  const assignments = new Map(envelope.dispatches.flatMap(d => d.recipients).map(a => [a.id, a]))
  const events = new Map()
  for (const e of extension.events) {
    if (!exact(e, ['id', 'action', 'recordId', 'actorUserId', 'dependency', 'at', 'documentRevision', 'requestKey', 'payloadHash']) ||
        !text(e.id) || events.has(e.id) || !Object.values(actionFor).includes(e.action) || !/^[a-f0-9]{64}$/.test(e.payloadHash)) fail()
    events.set(e.id, e)
  }
  for (const section of Object.keys(actionFor)) for (const r of extension[section]) {
    if (!exact(r, [...common, ...fields[section]]) || ![r.id, r.documentId, r.actorUserId, r.requestKey, r.eventId].every(text) ||
        ids.has(r.id) || r.documentId !== envelope.documentId || !['dsa', 'dti'].includes(r.dependency) ||
        !serverTime(r.at) || !Number.isSafeInteger(r.documentRevision) ||
        r.documentRevision < 1 || r.documentRevision > envelope.revision) fail()
    const key = JSON.stringify([r.actorUserId, r.requestKey])
    if (operations.has(key) || r.eventId !== evidenceEventId(r, actionFor[section])) fail()
    ids.add(r.id); operations.add(key)
    const e = events.get(r.eventId)
    if (!e || linked.has(e.id) || e.action !== actionFor[section] || e.recordId !== r.id || e.actorUserId !== r.actorUserId ||
        e.dependency !== r.dependency || e.at !== r.at || e.documentRevision !== r.documentRevision || e.requestKey !== r.requestKey || e.payloadHash !== evidenceHash(r)) fail()
    linked.add(e.id)
    if (section === 'cancellations') {
      const a = assignments.get(r.assignmentId)
      if (!a || a.status !== 'ANULADO' || a.dependency !== r.dependency || cancelled.has(a.id) ||
          typeof r.reason !== 'string' || !r.reason.trim() || r.reason.length > 2000 || Date.parse(r.at) < Date.parse(a.createdAt)) fail()
      cancelled.add(a.id)
    } else if (section === 'classifications') {
      if (classes.has(r.dependency) || typeof r.exclusive !== 'boolean' || !Array.isArray(r.recipientUserIds) || !r.recipientUserIds.length ||
          r.recipientUserIds.some(id => !text(id)) || new Set(r.recipientUserIds).size !== r.recipientUserIds.length) fail()
      classes.set(r.dependency, r)
    } else {
      const c = classes.get(r.dependency), key = JSON.stringify([r.classificationId, r.recipientUserId])
      if (!c || c.id !== r.classificationId || r.actorUserId !== r.recipientUserId || !c.recipientUserIds.includes(r.recipientUserId) ||
          r.documentRevision < c.documentRevision || Date.parse(r.at) < Date.parse(c.at) || confirmed.has(key)) fail()
      confirmed.add(key)
    }
  }
  if (linked.size !== events.size) fail()
  return extension
}
