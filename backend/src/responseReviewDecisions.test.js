import test from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './testFixtures/reviews.js'
import { createResponseReviewDecisions } from './responseReviewDecisions.js'
import { createResponseProposalOperations } from './responseProposalOperations.js'
import { applyReviewEvent, validateReviewProcesses } from './responseReview.js'
import { parseAssignments } from './alfrescoDispatchRepository.js'
import { createResponseProposalReader } from './responseProposalReader.js'
import { createAlfrescoProposalAdapter } from './alfrescoProposalAdapter.js'
import { createDocumentQueue } from './documentQueue.js'

test('specialist presents to verified head, observations survive revision, head elevates and direction approves', async () => {
  const f = await setup(); const service = f.service()
  let r = await service.decide(f.input('SUBMIT'), f.sessions.author)
  assert.equal(r.process.state, 'EN_REVISION_JEFATURA')
  r = await service.decide(f.input('OBSERVE'), f.sessions.head)
  assert.equal(r.process.state, 'OBSERVADA')
  await assert.rejects(service.decide(f.input('SUBMIT'), f.sessions.author), /NEW_REVISION_REQUIRED/)
  await f.adapter().execute({ action: 'REVISE', documentId: 'original', processId: f.proposal.id, assignmentId: 'author-assignment', requestKey: 'revise', expectedRevision: r.process.revision,
    file: Buffer.from('%PDF-new revision'), title: 'Respuesta', description: 'Propuesta' }, f.session)
  await service.decide(f.input('SUBMIT'), f.sessions.author)
  r = await service.decide(f.input('ELEVATE'), f.sessions.head)
  assert.equal(r.process.state, 'EN_REVISION_DIRECCION')
  r = await service.decide(f.input('APPROVE'), f.sessions.direction)
  assert.equal(r.process.state, 'APROBADA')
  const event = r.process.events.at(-1)
  assert.equal(event.review.affectedRevision, event.expectedRevision)
  assert.deepEqual(event.review.snapshot, r.process.snapshot)
  assert.equal(event.actorUserId, 'direction'); assert.equal(event.actorRole, 'direccion')
  assert.equal(event.at, '2026-11-19T16:00:00.000Z')
  assert.ok(r.process.events.some((e) => e.action === 'OBSERVE' && e.reason === 'Corregir la respuesta'))
  assert.deepEqual(f.envelope().dispatches, f.dispatches); assert.deepEqual(f.envelope().history, f.history)
  assert.equal(f.state.original.properties['gd:estado'], 'PENDIENTE')
})

test('head and direction start directly at direction review; direction can return; self approval stays pending', async () => {
  for (const role of ['jefe-unidad', 'direccion']) {
    const f = await setup(role); const s = f.service()
    const submitted = await s.decide(f.input('SUBMIT'), f.sessions.author)
    assert.equal(submitted.process.state, 'EN_REVISION_DIRECCION')
    assert.equal(submitted.process.events.filter((e) => e.action === 'ELEVATE').length, 0)
    assert.equal((await s.decide(f.input('RETURN'), f.sessions.direction)).process.state, 'OBSERVADA')
  }
  const f = await setup('direccion')
  const provider = { resolveReviewers: async () => ({ verified: true, reviewers: [{ userId: 'author', groupIds: ['GROUP_DIRECTION'] }] }) }
  await f.service(provider).decide(f.input('SUBMIT'), f.sessions.author)
  await assert.rejects(f.service(provider).decide(f.input('APPROVE'), f.sessions.author), /SELF_APPROVAL_POLICY_PENDING/)
})

test('supervisor absent, ambiguous, wrong actor, changing routing and department mismatch deny decisions', async () => {
  const f = await setup()
  await assert.rejects(f.service(null).decide(f.input('SUBMIT'), f.sessions.author), /PROVIDER_PENDING/)
  await assert.rejects(f.service({ resolveReviewers: async () => ({ verified: true, reviewers: [] }) }).decide(f.input('SUBMIT'), f.sessions.author), /NOT_VERIFIED/)
  await assert.rejects(f.service({ resolveReviewers: async () => ({ verified: true, reviewers: [{ userId: 'head' }, { userId: 'wrong-head' }] }) }).decide(f.input('SUBMIT'), f.sessions.author), /AMBIGUOUS/)
  await f.service().decide(f.input('SUBMIT'), f.sessions.author)
  await assert.rejects(f.service().decide(f.input('OBSERVE'), f.sessions['wrong-head']), /NOT_VERIFIED/)
  const changed = { resolveReviewers: async () => ({ verified: true, reviewers: [{ userId: 'wrong-head', groupIds: ['GROUP_HEAD'] }] }) }
  await assert.rejects(f.service(changed).decide(f.input('OBSERVE'), f.sessions['wrong-head']), /REVIEWER_CHANGED/)
  await assert.rejects(f.service().decide(f.input('ELEVATE'), f.sessions.foreign), /DEPENDENCY_MISMATCH/)
  assert.equal(f.envelope().reviewProcesses[0].state, 'EN_REVISION_JEFATURA')
})

test('live role revocation, actor ACL, reviewer enabled status and forged flags deny transitions', async () => {
  for (const mutate of [(f) => { f.actor.groups = ['GROUP_DSA'] }, (f) => { f.state.denyOriginalRead = true },
    (f) => { f.state.denyProposalRead = true }, (f) => { f.state.denyVersion = true },
    (f) => { f.actors.get('Basic head').enabled = false }, (f) => { f.state.originalUpdate = false }]) {
    const f = await setup(); mutate(f)
    await assert.rejects(f.service().decide(f.input('SUBMIT'), f.sessions.author))
    assert.equal(f.envelope().reviewProcesses[0].revision, 1)
  }
  const f = await setup()
  await assert.rejects(f.service().decide({ ...f.input('SUBMIT'), approved: true }, f.sessions.author), /INVALID_INPUT/)
  await assert.rejects(f.service().decide(f.input('APPROVE'), f.sessions.head), /INVALID_STATE/)
  assert.equal(f.state.putCount, 0)
})

test('stale revision/version and altered PDF or metadata reject before decision persistence', async () => {
  for (const [change, error] of [
    [(f, i) => { i.expectedRevision = 9 }, /STALE_REVISION/],
    [(f, i) => { i.expectedVersionId = '9.0' }, /STALE_VERSION/],
    [(f) => { f.state.versionMap.get('1.0').bytes = Buffer.from('%PDF-altered') }, /CONTENT_OR_METADATA_CHANGED/],
    [(f) => { f.state.nodes.get('proposal-node').properties['cm:title'] = 'changed' }, /CONTENT_OR_METADATA_CHANGED/],
    [(f) => { f.state.nodes.get('proposal-node').properties['cm:versionLabel'] = '2.0' }, /CONTENT_OR_METADATA_CHANGED/],
  ]) {
    const f = await setup(); const input = f.input('SUBMIT'); change(f, input)
    await assert.rejects(f.service().decide(input, f.sessions.author), error)
    assert.equal(f.envelope().reviewProcesses[0].state, 'BORRADOR')
  }
})

test('idempotent replay preserves old observations and rejects a reused key with a different reason', async () => {
  const f = await setup(); const s = f.service()
  const submit = f.input('SUBMIT'); await s.decide(submit, f.sessions.author)
  const observe = f.input('OBSERVE'); const result = await s.decide(observe, f.sessions.head)
  assert.equal((await s.decide(observe, f.sessions.head)).repeated, true)
  assert.equal((await s.decide(submit, f.sessions.author)).process.revision, result.process.revision)
  await assert.rejects(s.decide({ ...observe, reason: 'different' }, f.sessions.head), /IDEMPOTENCY/)
  assert.equal(f.envelope().reviewProcesses[0].events.length, 3)
})

test('competing decisions serialize on shared original mutex and only one expected revision commits', async () => {
  const f = await setup(); const s = f.service()
  await s.decide(f.input('SUBMIT'), f.sessions.author)
  const a = f.input('OBSERVE'); const b = f.input('ELEVATE')
  const results = await Promise.allSettled([s.decide(a, f.sessions.head), f.service().decide(b, f.sessions.head)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.find((r) => r.status === 'rejected').reason.message, 'REVIEW_STALE_REVISION')
  assert.equal(f.envelope().reviewProcesses[0].events.length, 3)
})

test('uncertain commit reconciles after restart without a duplicated decision; role revoked during operation blocks commit', async () => {
  const f = await setup(); const input = f.input('SUBMIT')
  f.state.failure = 'final-put'
  await assert.rejects(f.service().decide(input, f.sessions.author), /RESULT_UNCERTAIN/)
  assert.equal(f.envelope().reviewOperations.at(-1).phase, 'UNCERTAIN')
  const reader = createResponseProposalReader(f.settings, f.fetchImpl)
  assert.deepEqual((await reader.list('original', f.sessions.author)).proposals, [{ status: 'UNAVAILABLE' }])
  assert.equal((await f.service().reconcile(input, f.sessions.author)).repeated, true)
  assert.equal((await reader.list('original', f.sessions.author)).proposals[0].status, 'AVAILABLE')
  assert.equal(f.envelope().reviewProcesses[0].events.length, 2)
  const g = await setup()
  g.state.onOriginalPut = (envelope) => { if (envelope.reviewOperations.at(-1).phase === 'PREPARED') g.actor.enabled = false }
  const request = g.input('SUBMIT')
  await assert.rejects(g.service().decide(request, g.sessions.author), /RESULT_UNCERTAIN/)
  assert.equal(g.envelope().reviewProcesses[0].state, 'BORRADOR')
  assert.equal(g.envelope().reviewOperations.at(-1).phase, 'UNCERTAIN')
  g.state.onOriginalPut = null; g.actor.enabled = true
  await assert.rejects(g.service().decide(request, g.sessions.author), /RECONCILIATION_REQUIRED/)
  assert.equal((await g.service().reconcile(request, g.sessions.author)).process.state, 'EN_REVISION_JEFATURA')
})

test('new revision invalidates approval while keeping its decision snapshot; old envelopes remain compatible', async () => {
  const f = await setup('jefe-unidad'); const s = f.service()
  await s.decide(f.input('SUBMIT'), f.sessions.author)
  const approved = (await s.decide(f.input('APPROVE'), f.sessions.direction)).process
  const revised = applyReviewEvent(approved, { id: 'new-event', requestKey: 'new-revision', action: 'REVISE', actorUserId: 'author', actorRole: 'jefe-unidad', dependency: 'dsa',
    at: '2026-11-19T17:00:00Z', expectedRevision: approved.revision, snapshot: { ...approved.snapshot, versionId: '2.0' }, reason: '', emissionDocumentId: null }, { verified: true })
  assert.equal(revised.approval, null)
  assert.ok(revised.events.some((e) => e.action === 'APPROVE' && e.review.snapshot.versionId === '1.0'))
  const assignments = new Map(f.envelope().dispatches.flatMap((d) => d.recipients).map((a) => [a.id, a]))
  assert.doesNotThrow(() => validateReviewProcesses([revised], 'original', assignments))
  assert.deepEqual(parseAssignments(undefined, 'original').dispatches, [])
  const ops = createResponseProposalOperations({ decisionService: s })
  assert.equal((await ops.decide(f.input('APPROVE', { requestKey: approved.events.at(-1).requestKey, expectedRevision: approved.revision - 1 }), f.sessions.direction)).repeated, true)
  await assert.rejects(createResponseReviewDecisions().decide(f.input('SUBMIT'), f.sessions.author), /WRITES_DISABLED/)
  const blocked = createAlfrescoProposalAdapter(f.settings, { fetchImpl: f.fetchImpl, withDocument: createDocumentQueue() })
  await assert.rejects(createResponseReviewDecisions({ alfrescoAdapter: blocked, institutionalProvider: f.provider }).decide(f.input('SUBMIT'), f.sessions.author), /WRITES_DISABLED/)
})

test('strict decision history rejects changed actor, recipient and hash; limits apply before intention writes', async () => {
  const f = await setup(); await f.service().decide(f.input('SUBMIT'), f.sessions.author)
  const p = (await f.service().decide(f.input('OBSERVE'), f.sessions.head)).process
  const assignments = new Map(f.envelope().dispatches.flatMap((d) => d.recipients).map((a) => [a.id, a]))
  for (const corrupt of [
    (event) => { event.actorUserId = 'wrong-head' },
    (event) => { event.review.recipient.userId = 'wrong-author' },
    (event) => { event.review.snapshot.contentSha256 = 'a'.repeat(64) },
  ]) {
    const changed = structuredClone(p); corrupt(changed.events.at(-1))
    assert.throws(() => validateReviewProcesses([changed], 'original', assignments))
  }
  const g = await setup()
  const envelope = g.envelope()
  envelope.padding = 'x'.repeat(256 * 1024 - Buffer.byteLength(JSON.stringify(envelope)) - 100)
  g.state.original.properties['gd:asignaciones'] = JSON.stringify(envelope)
  await assert.rejects(g.service().decide(g.input('SUBMIT'), g.sessions.author), /SIZE_LIMIT/)
  assert.equal(g.envelope().reviewOperations.length, 1, 'no decision intention was written')
})
