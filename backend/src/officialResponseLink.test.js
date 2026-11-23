import test from 'node:test'
import assert from 'node:assert/strict'
import { attentionFixture, actor, originalId, responseId } from './testFixtures/attention.js'
import { createAlfrescoDispatchRepository } from './alfrescoDispatchRepository.js'

async function setup(role = 'especialista') {
  const f = attentionFixture(), dispatch = await f.seed()
  const userId = role === 'especialista' ? 'staff' : 'head'
  const own = dispatch.recipients.find(a => a.userId === userId)
  f.addResponse()
  const n = f.nodes.get(responseId)
  n.createdByUser.id = userId
  Object.assign(n.properties, { 'gd:codigoDocumental': role === 'especialista' ? 'DSA-UNIT-AA' : 'DSA-UNIT',
    'gd:identidadEmision': JSON.stringify({ version: 1, actorId: userId, requestKey: 'issued-fixture', payloadHash: 'b'.repeat(64) }) })
  return { f, own, session: actor(userId, role), input: { documentId: originalId, assignmentId: null, responseDocumentId: responseId, requestKey: 'link-official-fixture' } }
}
for (const role of ['jefe-unidad', 'especialista']) test(`${role} reuses one own official UUID/number on a received foreign original without attending`, async () => {
  const { f, own, session, input } = await setup(role)
  const before = structuredClone(f.nodes.get(responseId)), originalState = f.nodes.get(originalId).properties['gd:estado']
  const first = await f.repository.linkResponse(input, session)
  assert.equal(first.assignment.id, own.id); assert.equal(first.assignment.status, 'ASIGNADO')
  assert.equal(first.assignment.responses[0].documentId, responseId)
  assert.equal(f.nodes.get(originalId).properties['gd:estado'], originalState)
  assert.deepEqual(f.nodes.get(responseId).properties, before.properties)
  assert.deepEqual(f.nodes.get(responseId).createdByUser, before.createdByUser)
  assert.equal(f.nodes.get(responseId).parentId, before.parentId)
  assert.ok(!f.state.calls.some(c => c.method === 'POST' && c.path.endsWith('/children')))
  const restarted = createAlfrescoDispatchRepository(f.settings, f.fetchImpl)
  await restarted.linkResponse(input, session)
  assert.equal(f.state.calls.filter(c => c.method === 'POST' && c.path.endsWith('/targets')).length, 1)
  assert.equal((await restarted.relatedResponses(originalId, session)).responses[0].available, true)
  const reverse = await restarted.relatedOriginals(responseId, session, async id => id === originalId)
  assert.equal(reverse.originals[0].originalDocumentId, originalId)
  assert.equal(reverse.originals[0].relationType, 'response')
  await assert.rejects(restarted.linkResponse({ ...input, requestKey: 'different-key' }, session), /ALREADY_LINKED/)
})
test('draft or merely registered PDF cannot enter official candidates or create a response relation', async () => {
  const { f, input, session } = await setup()
  delete f.nodes.get(responseId).properties['gd:identidadEmision']
  assert.deepEqual(await f.repository.listResponseCandidates(session), [])
  await assert.rejects(f.repository.linkResponse(input, session), /OFFICIAL_DOCUMENT_REQUIRED/)
  assert.ok(!f.state.calls.some(c => c.method === 'POST'))
})
test('inconsistent identity, ACL and missing/ambiguous original competence block reuse', async () => {
  const { f, input, session } = await setup()
  f.nodes.get(responseId).properties['gd:identidadEmision'] = JSON.stringify({ version: 1, actorId: 'different-author', requestKey: 'key', payloadHash: 'a'.repeat(64) })
  await assert.rejects(f.repository.linkResponse(input, session), /OFFICIAL_DOCUMENT_REQUIRED/)
  f.state.denyActor = true
  await assert.rejects(f.repository.linkResponse(input, session), /READ_DENIED/)
  f.state.denyActor = false
  await assert.rejects(f.repository.linkResponse(input, actor('unassigned', 'especialista')), /NOT_OWNED/)
})
test('partial association is not an official response until its original journal is verified; retry recovers without duplicate', async () => {
  const { f, input, session } = await setup()
  f.state.originalPutStatus = 500
  await assert.rejects(f.repository.linkResponse(input, session), /LINK_PARTIAL/)
  const orphan = await f.repository.relatedOriginals(responseId, session, async () => true)
  assert.equal(orphan.originals.length, 0); assert.equal(orphan.complete, false)
  f.state.originalPutStatus = 200
  await f.repository.linkResponse(input, session)
  assert.equal((await f.repository.relatedOriginals(responseId, session, async () => true)).originals.length, 1)
  assert.equal(f.state.calls.filter(c => c.method === 'POST' && c.path.endsWith('/targets')).length, 1)
  assert.equal((await f.repository.relatedOriginals(responseId, session, async () => false)).originals.length, 0)
})
test('timeout after the original commit is recovered through its stable key', async () => {
  const { f, input, session } = await setup()
  // Preexisting referencing aspect isolates the simulated timeout to the journal PUT.
  f.nodes.get(responseId).aspectNames.push('cm:referencing')
  f.state.failAfterCommit = true
  await assert.rejects(f.repository.linkResponse(input, session), /LINK_PARTIAL/)
  const result = await f.repository.linkResponse(input, session)
  assert.equal(result.assignment.responses.length, 1)
  assert.equal(f.envelope().history.filter(e => e.action === 'RESPONSE_LINKED').length, 1)
})
test('multiple own assignments require an explicit selection instead of choosing one arbitrarily', async () => {
  const { f, input, session, own } = await setup()
  await f.repository.withDocument(originalId, () => f.repository.createDispatch({ documentId: originalId, senderUserId: 'director', senderRole: 'direccion', senderDependency: 'dsa',
    originAssignmentId: null, requestKey: 'another-obligation', instruction: 'Another task', priority: 'Normal',
    recipients: [{ id: 'staff', functionalRole: 'especialista', dependency: 'dsa' }] }, actor('director', 'direccion')))
  await assert.rejects(f.repository.linkResponse(input, session), /ASSIGNMENT_AMBIGUOUS/)
  assert.equal((await f.repository.linkResponse({ ...input, assignmentId: own.id }, session)).assignment.id, own.id)
})
test('role revocation after the association prevents original journal PUT and leaves a detectable partial relation', async () => {
  const { f, input, session } = await setup()
  let revoked = false
  const fetch = async (url, options) => {
    if (revoked && options.headers.Authorization === session.authorization && new URL(url).pathname.endsWith('/people/-me-')) return Response.json({ entry: { id: 'staff', enabled: false } })
    const r = await f.fetchImpl(url, options)
    if (options.method === 'POST' && new URL(url).pathname.endsWith('/targets')) revoked = true
    return r
  }
  const repository = createAlfrescoDispatchRepository(f.settings, fetch)
  await assert.rejects(repository.linkResponse(input, session), /LINK_PARTIAL/)
  assert.ok(f.references.get(responseId).has(originalId))
  assert.equal(f.envelope().history.filter(e => e.action === 'RESPONSE_LINKED').length, 0)
})
