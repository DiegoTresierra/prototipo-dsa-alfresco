import test from 'node:test'
import assert from 'node:assert/strict'
import { validateClosureEvidence, evidenceHash, evidenceEventId } from './closureEvidenceContract.js'
import { createClosurePreflight } from './closurePreflight.js'
import { attentionFixture, actor, originalId } from './testFixtures/attention.js'
import { identityResponse } from './testFixtures/institutionalIdentity.js'
import { projections, parseAssignments } from './alfrescoDispatchRepository.js'

const at = '2099-01-01T12:00:00Z', now = '2099-01-01T13:00:00Z'
const sections = { cancellations: 'CANCEL_ASSIGNMENT', classifications: 'CLASSIFY_KNOWLEDGE', confirmations: 'ACKNOWLEDGE_KNOWLEDGE' }
function append(envelope, section, values) {
  const ext = envelope.closureEvidence ||= { schemaVersion: 1, cancellations: [], classifications: [], confirmations: [], events: [] }
  const action = sections[section], id = `record-${ext.events.length}`
  const r = { id, documentId: originalId, dependency: 'dsa', actorUserId: 'director', at, documentRevision: 5, requestKey: id, ...values }
  r.eventId = evidenceEventId(r, action)
  ext[section].push(r)
  ext.events.push({ id: r.eventId, action, recordId: r.id, actorUserId: r.actorUserId, dependency: r.dependency,
    at: r.at, documentRevision: r.documentRevision, requestKey: r.requestKey, payloadHash: evidenceHash(r) })
  return r
}
function rehash(envelope, record) {
  const event = envelope.closureEvidence.events.find(e => e.recordId === record.id)
  record.eventId = evidenceEventId(record, event.action)
  Object.assign(event, { id: record.eventId, actorUserId: record.actorUserId, dependency: record.dependency, at: record.at,
    documentRevision: record.documentRevision, requestKey: record.requestKey, payloadHash: evidenceHash(record) })
}
async function fixture(knowledge = false) {
  const f = attentionFixture(); await f.seed()
  const envelope = f.envelope(); envelope.revision = 8
  const session = actor('director', 'direccion')
  const actors = new Map([
    [session.authorization, { id: 'director', functionalRole: 'direccion', dependency: 'DSA' }],
    ['staff', { id: 'staff', functionalRole: 'especialista', dependency: 'DSA' }],
    ['head', { id: 'head', functionalRole: 'jefe-unidad', dependency: 'DSA' }],
    ['dti-director', { id: 'dti-director', functionalRole: 'direccion', dependency: 'DTI' }],
  ])
  if (knowledge) {
    envelope.dispatches = []; envelope.history = []
    const classification = append(envelope, 'classifications', { exclusive: true, recipientUserIds: ['staff', 'head'] })
    for (const id of classification.recipientUserIds) append(envelope, 'confirmations', { classificationId: classification.id, recipientUserId: id, actorUserId: id })
  } else for (const a of envelope.dispatches[0].recipients) {
    a.status = 'ANULADO'
    append(envelope, 'cancellations', { assignmentId: a.id, reason: 'Motivo sintético de prueba' })
  }
  const node = f.nodes.get(originalId)
  const sync = () => { node.properties['gd:asignaciones'] = JSON.stringify(envelope); Object.assign(node.properties, projections(envelope)) }
  sync()
  const calls = []
  let getNodeCount = 0
  const options = { deny: false, concurrent: false, providerMissing: false, roster: undefined, proofDenied: false }
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, session.authorization)
    calls.push(String(url))
    const p = new URL(url).pathname
    const own = identityResponse(url, init, actors, f.settings.groupMappings)
    if (own) return own
    const id = decodeURIComponent(p.split('/people/')[1]?.split('/')[0] || '')
    const user = [...actors.values()].find(a => a.id === id)
    if (user) {
      if (p.endsWith('/groups')) return identityResponse(url, { ...init, headers: { Authorization: id } }, new Map([[id, user]]), f.settings.groupMappings)
      return Response.json({ entry: { id, enabled: user.enabled !== false } })
    }
    if (options.deny) return Response.json({}, { status: 403 })
    if (p.endsWith(`/nodes/${originalId}`) && ++getNodeCount === 2 && options.concurrent) node.properties['cm:title'] = 'External modification'
    return f.fetchImpl(url, init)
  }
  const providerCalls = []
  const institutionalProvider = { async verifyClosureEvidence(input) {
    providerCalls.push(input)
    const user = [...actors.values()].find(a => a.id === input.actorUserId)
    return { ...input, verified: !options.proofDenied, source: 'alfresco', reference: 'synthetic-authority-proof',
      groupIds: [f.settings.groupMappings.functions[user.functionalRole]], authorizedAt: at,
      exclusive: true, recipientUserIds: options.roster || ['staff', 'head'] }
  } }
  const run = () => createClosurePreflight(f.settings, { fetchImpl, clock: () => new Date(now),
    institutionalProvider: options.providerMissing ? undefined : institutionalProvider })({ documentId: originalId, scope: { type: 'dependency', dependency: 'dsa' } }, session)
  return { f, envelope, node, session, actors, options, sync, run, calls, providerCalls }
}

test('valid cancellation records and linked events yield preliminary compliance through actor GETs', async () => {
  const x = await fixture(), before = structuredClone(x.node)
  assert.ok(validateClosureEvidence(parseAssignments(x.node.properties['gd:asignaciones'], originalId)))
  const result = await x.run()
  assert.equal(result.preliminaryCompliance, 'MET')
  assert.equal(result.summary.validCancelled, 2)
  assert.equal(result.formalClosureAllowed, false)
  assert.deepEqual(x.node, before)
})
test('missing reason, unknown extension version and unverified event are rejected at common read validation', async () => {
  for (const mutate of [e => { delete e.closureEvidence.cancellations[0].reason }, e => { e.closureEvidence.schemaVersion = 2 },
    e => { e.closureEvidence.events.pop() }, e => { e.closureEvidence.events[0].payloadHash = '0'.repeat(64) }]) {
    const x = await fixture(); mutate(x.envelope); x.sync()
    assert.throws(() => parseAssignments(x.node.properties['gd:asignaciones'], originalId), /CLOSURE_EVIDENCE_INVALID/)
    assert.throws(() => validateClosureEvidence(x.envelope), /CLOSURE_EVIDENCE_INVALID/)
    await assert.rejects(x.run(), /CLOSURE_EVIDENCE_INVALID/)
  }
})
test('actor without Direction competence and cross-dependency authority cannot authorize cancellation', async () => {
  for (const actorUserId of ['head', 'dti-director']) {
    const x = await fixture(), r = x.envelope.closureEvidence.cancellations[0]
    r.actorUserId = actorUserId; rehash(x.envelope, r); x.sync()
    assert.equal((await x.run()).preliminaryCompliance, 'INDETERMINATE')
  }
})
test('current role alone never replaces historical event and institutional competence proof', async () => {
  for (const flag of ['providerMissing', 'proofDenied']) {
    const x = await fixture(); x.options[flag] = true
    const result = await x.run()
    assert.equal(result.preliminaryCompliance, 'INDETERMINATE')
    assert.equal(result.summary.validCancelled, 0)
  }
})
test('valid individual knowledge confirmations yield independent preliminary compliance', async () => {
  const x = await fixture(true), before = structuredClone(x.node), result = await x.run()
  assert.equal(result.preliminaryCompliance, 'MET')
  assert.equal(result.knowledgeSummary.confirmed, 2)
  assert.equal(result.summary.total, 0)
  assert.equal(result.formalClosureAllowed, false)
  assert.deepEqual(x.node, before)
  assert.equal(x.providerCalls.filter(p => p.action === 'ACKNOWLEDGE_KNOWLEDGE').length, 2)
})
test('foreign actor, repeated confirmation, or incomplete roster cannot prove knowledge', async () => {
  for (const kind of ['foreign', 'duplicate', 'incomplete']) {
    const x = await fixture(true), r = x.envelope.closureEvidence.confirmations[0]
    if (kind === 'foreign') { r.actorUserId = 'director'; rehash(x.envelope, r) }
    if (kind === 'duplicate') append(x.envelope, 'confirmations', { classificationId: r.classificationId, recipientUserId: r.recipientUserId, actorUserId: r.actorUserId })
    if (kind === 'incomplete') x.options.roster = ['staff', 'head', 'another-institutional-user']
    x.sync()
    if (kind === 'incomplete') assert.notEqual((await x.run()).preliminaryCompliance, 'MET')
    else await assert.rejects(x.run(), /CLOSURE_EVIDENCE_INVALID/)
  }
})
test('nonexclusive classification does not establish completion for a document without ordinary obligations', async () => {
  const x = await fixture(true), c = x.envelope.closureEvidence.classifications[0]
  c.exclusive = false; rehash(x.envelope, c); x.sync()
  assert.equal((await x.run()).preliminaryCompliance, 'INDETERMINATE')
})
test('one missing knowledge confirmation does not count as another recipient confirmation', async () => {
  const x = await fixture(true), r = x.envelope.closureEvidence.confirmations.pop()
  x.envelope.closureEvidence.events = x.envelope.closureEvidence.events.filter(e => e.id !== r.eventId); x.sync()
  const result = await x.run()
  assert.equal(result.preliminaryCompliance, 'BLOCKED')
  assert.equal(result.knowledgeSummary.confirmed, 1)
  assert.equal(result.knowledgeSummary.pending, 1)
})
test('actor ACL denial fails closed and concurrent changes invalidate the evidence snapshot', async () => {
  const x = await fixture(); x.options.deny = true
  await assert.rejects(x.run(), e => e.status === 403)
  const y = await fixture(); y.options.concurrent = true
  await assert.rejects(y.run(), /CLOSURE_SNAPSHOT_CHANGED/)
})
test('historical envelope has no fabricated evidence and preserves other sections', async () => {
  const x = await fixture(); delete x.envelope.closureEvidence; x.sync()
  const before = structuredClone(x.node)
  assert.equal(validateClosureEvidence(x.envelope), null)
  assert.equal((await x.run()).preliminaryCompliance, 'INDETERMINATE')
  assert.deepEqual(x.node, before)
})
test('records from another dependency are not read or disclosed on a shared original', async () => {
  const x = await fixture(true), c = x.envelope.closureEvidence.classifications[0]
  c.dependency = 'dti'; rehash(x.envelope, c)
  for (const r of x.envelope.closureEvidence.confirmations) { r.dependency = 'dti'; rehash(x.envelope, r) }
  x.sync()
  const result = await x.run()
  assert.equal(result.preliminaryCompliance, 'INDETERMINATE')
  assert.equal(x.providerCalls.length, 0)
  assert.ok(!JSON.stringify(result).includes('synthetic-authority-proof'))
})
