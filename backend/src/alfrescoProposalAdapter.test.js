import test from 'node:test'
import assert from 'node:assert/strict'
import { createAlfrescoProposalAdapter } from './alfrescoProposalAdapter.js'
import { createResponseProposalOperations } from './responseProposalOperations.js'
import { createResponseProposalReader } from './responseProposalReader.js'
import { createDocumentQueue } from './documentQueue.js'
import { fixture } from './testFixtures/proposals.js'

test('real adapter REST contract creates proposal, references and journal; reader verifies it; retries do not duplicate', async () => {
  const f = fixture()
  const before = structuredClone(f.state.original.properties)
  const ops = createResponseProposalOperations({ alfrescoAdapter: f.adapter() })
  const p = await ops.create(f.input, f.session)
  assert.equal(p.state, 'BORRADOR'); assert.equal(p.proposalDocumentId, 'proposal-node')
  assert.equal(f.state.postCount, 1); assert.equal(f.state.linked, true)
  assert.equal(f.envelope().reviewOperations[0].phase, 'COMMITTED')
  assert.deepEqual(await f.adapter().execute(f.input, f.session), p)
  assert.equal(f.state.postCount, 1)
  const read = await createResponseProposalReader(f.settings, f.fetchImpl).list('original', f.session)
  assert.equal(read.proposals[0].status, 'AVAILABLE')
  assert.equal(f.state.original.properties['gd:estado'], before['gd:estado'])
  assert.deepEqual(f.state.original.properties['gd:responsablesActuales'], before['gd:responsablesActuales'])
  assert.deepEqual(f.envelope().dispatches, []); assert.deepEqual(f.envelope().history, [])
})

test('timeouts before/after creation never trigger blind POST; restart reconciles an existing node', async () => {
  for (const failure of ['before-create', 'after-create']) {
    const f = fixture(); f.state.failure = failure
    await assert.rejects(f.adapter().execute(f.input, f.session), /RECONCILIATION/)
    assert.equal(f.envelope().reviewOperations[0].phase, 'UNCERTAIN')
    await assert.rejects(f.adapter().execute(f.input, f.session), /RECONCILIATION/)
    if (failure === 'after-create') assert.equal((await f.adapter().reconcile(f.input, f.session)).state, 'BORRADOR')
    else await assert.rejects(f.adapter().reconcile(f.input, f.session), /RECONCILIATION/)
    assert.equal(f.state.postCount, 1)
  }
})

test('partial association and uncertain original commit are recoverable without another PDF', async () => {
  for (const failure of ['reference', 'final-put']) {
    const f = fixture(); f.state.failure = failure
    await assert.rejects(f.adapter().execute(f.input, f.session), /RECONCILIATION/)
    const p = await f.adapter().reconcile(f.input, f.session)
    assert.equal(p.events.length, 1); assert.equal(f.state.postCount, 1)
  }
})

test('new content creates one version, preserves previous bytes, and recovers an update timeout', async () => {
  const f = fixture(); const p = await f.adapter().execute(f.input, f.session)
  const input = { ...f.input, action: 'REVISE', processId: p.id, requestKey: 'revision-key', expectedRevision: 1, file: Buffer.from('%PDF-1.7 revised') }
  f.state.failure = 'after-update'
  await assert.rejects(f.adapter().execute(input, f.session), /RECONCILIATION/)
  const revised = await f.adapter().reconcile(input, f.session)
  assert.equal(revised.revision, 2); assert.equal(revised.snapshot.versionId, '1.1')
  assert.deepEqual(f.state.versionMap.get('1.0').bytes, f.input.file)
  assert.equal(f.state.putCount, 1)
  await f.adapter().execute(input, f.session)
  assert.equal(f.state.putCount, 1)
  assert.equal((await f.adapter().execute(f.input, f.session)).revision, 2, 'old key returns current process without altering new version')
  assert.ok(f.envelope().reviewOperations.every((o) => o.phase === 'COMMITTED'))
})

test('ACL, live revoked role, foreign author, stale revision and external changes block mutations', async () => {
  for (const mutate of [(f) => { f.state.folderCreate = false }, (f) => { f.state.originalUpdate = false }, (f) => { f.actor.groups = ['GROUP_DSA'] }]) {
    const f = fixture(); mutate(f)
    await assert.rejects(f.adapter().execute(f.input, f.session))
    assert.equal(f.state.postCount, 0)
  }
  const f = fixture(); const p = await f.adapter().execute(f.input, f.session)
  const revise = { ...f.input, action: 'REVISE', processId: p.id, requestKey: 'revise', expectedRevision: 1, file: Buffer.from('%PDF-new') }
  f.state.updates = false
  await assert.rejects(f.adapter().execute(revise, f.session), /UPDATE_FORBIDDEN/)
  f.state.updates = true
  f.session.alfresco.id = 'other'; f.actor.id = 'other'
  await assert.rejects(f.adapter().execute(revise, f.session), /AUTHOR_FORBIDDEN/)
  f.session.alfresco.id = 'author'; f.actor.id = 'author'
  await assert.rejects(f.adapter().execute({ ...revise, expectedRevision: 0 }, f.session), /STALE/)
  f.state.versionMap.get('1.0').bytes = Buffer.from('%PDF-external')
  await assert.rejects(f.adapter().execute(revise, f.session), /CONTENT_CHANGED/)
  assert.equal(f.state.putCount, 0)
})

test('size, privileged fields, idempotency collisions and absence of a production enable path', async () => {
  const f = fixture()
  await assert.rejects(createAlfrescoProposalAdapter(f.settings, { fetchImpl: f.fetchImpl, withDocument: createDocumentQueue() }).execute(f.input, f.session), /WRITES_DISABLED/)
  await assert.rejects(createAlfrescoProposalAdapter({ ...f.settings, alfrescoTarget: 'https://dev.example.com' }, { fetchImpl: f.fetchImpl, withDocument: createDocumentQueue(), simulationOnly: true }).execute(f.input, f.session), /WRITES_DISABLED/)
  await assert.rejects(f.adapter().execute({ ...f.input, authorUserId: 'forged' }, f.session), /INVALID_INPUT/)
  await assert.rejects(f.adapter().execute({ ...f.input, file: Buffer.alloc(25 * 1024 * 1024 + 1) }, f.session), /INVALID_INPUT/)
  await f.adapter().execute(f.input, f.session)
  await assert.rejects(f.adapter().execute({ ...f.input, title: 'changed' }, f.session), /IDEMPOTENCY/)
  const g = fixture()
  g.state.original.properties['gd:asignaciones'] = JSON.stringify({ ...g.envelope(), padding: 'x'.repeat(255 * 1024) })
  await assert.rejects(g.adapter().execute(g.input, g.session), /SIZE_LIMIT/)
  assert.equal(g.state.postCount, 0)
})

test('shared original mutex serializes creation retries and concurrent stale revisions', async () => {
  const f = fixture()
  const [p, same] = await Promise.all([f.adapter().execute(f.input, f.session), f.adapter().execute(f.input, f.session)])
  assert.equal(p.id, same.id); assert.equal(f.state.postCount, 1)
  const revise = { ...f.input, action: 'REVISE', processId: p.id, expectedRevision: 1, file: Buffer.from('%PDF-revised') }
  const results = await Promise.allSettled(['first', 'second'].map((requestKey) => f.adapter().execute({ ...revise, requestKey }, f.session)))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(f.state.putCount, 1)
  assert.equal(f.envelope().reviewProcesses[0].events.length, 2)
})

test('existing equivalent assignments and individual attended history survive all proposal phases', async () => {
  const f = fixture(); const at = '2026-11-18T15:00:00Z'
  const common = { documentId: 'original', senderUserId: 'director', senderRole: 'direccion', senderDependency: 'dsa', originAssignmentId: null, instruction: 'Atender', createdAt: at }
  const recipients = ['one', 'two'].map((userId, i) => ({ ...common, id: `assignment-${i}`, dispatchId: 'dispatch', userId, functionalRole: 'jefe-unidad', dependency: 'dsa', status: i ? 'ASIGNADO' : 'ATENDIDO',
    ...(i ? {} : { attendedAt: at, attendedByUserId: userId }) }))
  const dispatches = [{ ...common, id: 'dispatch', requestKey: 'dispatch-key', priority: 'Normal', status: 'ASIGNADO', recipients }]
  const history = [{ id: 'dispatch-event', action: 'DISPATCH_CREATED', actorUserId: 'director', at, dispatchId: 'dispatch', assignmentIds: recipients.map((r) => r.id) },
    { id: 'attend-event', action: 'ASSIGNMENT_ATTENDED', actorUserId: 'one', at, dispatchId: 'dispatch', assignmentIds: ['assignment-0'], requestKey: 'attended' }]
  f.state.original.properties['gd:asignaciones'] = JSON.stringify({ ...f.envelope(), dispatches, history })
  await f.adapter().execute(f.input, f.session)
  assert.deepEqual(f.envelope().dispatches, dispatches); assert.deepEqual(f.envelope().history, history)
  assert.equal(f.state.original.properties['gd:estado'], 'PENDIENTE')
})

test('pending operation requires the same actor, payload and live role after a restart', async () => {
  const f = fixture(); f.state.failure = 'after-create'
  await assert.rejects(f.adapter().execute(f.input, f.session), /RECONCILIATION/)
  f.actor.groups = ['GROUP_DSA']
  await assert.rejects(f.adapter().reconcile(f.input, f.session), /IDENTITY_REJECTED/)
  assert.equal(f.state.postCount, 1); assert.equal(f.state.linked, false)
  f.actor.groups = undefined
  await assert.rejects(f.adapter().reconcile({ ...f.input, file: Buffer.from('%PDF-different') }, f.session), /IDEMPOTENCY/)
  await f.adapter().reconcile(f.input, f.session)
  assert.equal(f.envelope().reviewOperations[0].phase, 'COMMITTED')
  const p = f.envelope().reviewProcesses[0]
  f.state.nodes.get('proposal-node').properties['cm:autoVersion'] = false
  await assert.rejects(f.adapter().execute({ ...f.input, action: 'REVISE', processId: p.id, requestKey: 'revise', expectedRevision: 1, file: Buffer.from('%PDF-next') }, f.session), /VERSIONING_REQUIRED/)
  assert.equal(f.state.putCount, 0)
})
