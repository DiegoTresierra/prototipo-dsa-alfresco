import test from 'node:test'
import assert from 'node:assert/strict'
import { assertEnvelopeExtensionsPreserved } from './envelopeExtensions.js'
import { attentionFixture, actor, originalId, responseId } from './testFixtures/attention.js'
import { fixture } from './testFixtures/proposals.js'
import { setup } from './testFixtures/reviews.js'
const extension = () => ({ schemaVersion: 1, cancellations: [], classifications: [], confirmations: [], events: [] })
const attach = node => {
  const e = JSON.parse(node.properties['gd:asignaciones'])
  e.closureEvidence = extension(); e.futureExtension = { schemaVersion: 99, opaque: ['preserve'] }
  node.properties['gd:asignaciones'] = JSON.stringify(e)
}
const check = e => { assert.deepEqual(e.closureEvidence, extension()); assert.deepEqual(e.futureExtension, { schemaVersion: 99, opaque: ['preserve'] }) }
test('ordinary writers cannot drop, add or modify opaque extensions; unknown versions remain opaque', () => {
  const base = { revision: 1, futureExtension: { version: 99 } }
  assert.doesNotThrow(() => assertEnvelopeExtensionsPreserved(base, { ...base, revision: 2 }))
  for (const next of [{ revision: 2 }, { ...base, futureExtension: {} }, { ...base, newExtension: [] }]) {
    assert.throws(() => assertEnvelopeExtensionsPreserved(base, next), /EXTENSION_MODIFICATION_FORBIDDEN/)
  }
})
test('dispatch and individual attention preserve known and unknown extensions byte-equivalently', async () => {
  const f = attentionFixture(), root = await f.seed(); attach(f.nodes.get(originalId))
  await f.repository.attendAssignment({ documentId: originalId, assignmentId: root.recipients[1].id, requestKey: 'extension-attend', responseDocumentId: null }, actor('staff', 'especialista'))
  check(f.envelope())
  await f.repository.withDocument(originalId, () => f.repository.createDispatch({ documentId: originalId, senderUserId: 'director', senderRole: 'direccion', senderDependency: 'dsa',
    originAssignmentId: null, instruction: 'Atender', priority: 'Normal', requestKey: 'extension-dispatch', recipients: [{ id: 'other-head', functionalRole: 'jefe-unidad', dependency: 'dsa' }] }, actor('director', 'direccion')))
  check(f.envelope())
})
test('proposal creation and review journal writes preserve opaque evidence', async () => {
  const f = fixture(); attach(f.state.original)
  await f.adapter().execute(f.input, f.session); check(f.envelope())
  const r = await setup(); attach(r.state.original)
  await r.service().decide(r.input('SUBMIT'), r.sessions.author); check(r.envelope())
})
test('full envelope size includes unknown extensions before any documentary write', async () => {
  const f = attentionFixture(), root = await f.seed(), node = f.nodes.get(originalId)
  attach(node)
  const e = f.envelope(); e.futureExtension.padding = 'x'.repeat(256 * 1024); node.properties['gd:asignaciones'] = JSON.stringify(e)
  const before = node.properties['gd:asignaciones']
  await assert.rejects(f.repository.attendAssignment({ documentId: originalId, assignmentId: root.recipients[1].id, requestKey: 'oversize', responseDocumentId: null }, actor('staff', 'especialista')))
  assert.equal(node.properties['gd:asignaciones'], before)
})

test('malformed known extensions reject response linking before any association or aspect write', async () => {
  const f = attentionFixture(); await f.seed(); f.addResponse()
  const node = f.nodes.get(originalId); attach(node)
  const e = f.envelope(); e.closureEvidence.schemaVersion = 2
  node.properties['gd:asignaciones'] = JSON.stringify(e)
  f.state.calls.length = 0
  await assert.rejects(f.repository.linkResponse({ documentId: originalId, assignmentId: null,
    responseDocumentId: responseId, requestKey: 'malformed-extension-link' }, actor('director', 'direccion')), /CLOSURE_EVIDENCE_INVALID/)
  assert.equal(f.state.calls.filter(c => c.method !== 'GET').length, 0)
})

test('malformed known extensions reject proposal creation before PDF or journal writes', async () => {
  const f = fixture(); attach(f.state.original)
  const e = f.envelope(); e.closureProcesses = [{ schemaVersion: 99 }]; e.closureOperations = []
  f.state.original.properties['gd:asignaciones'] = JSON.stringify(e)
  const before = f.state.original.properties['gd:asignaciones']
  await assert.rejects(f.adapter().execute(f.input, f.session), /CLOSURE_INVALID_PROCESS_CONTRACT/)
  assert.equal(f.state.postCount, 0)
  assert.equal(f.state.original.properties['gd:asignaciones'], before)
})
