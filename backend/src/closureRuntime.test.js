import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { once } from 'node:events'
import { attentionFixture, actor, originalId, responseId } from './testFixtures/attention.js'
import { identityResponse } from './testFixtures/institutionalIdentity.js'
import { projections } from './alfrescoDispatchRepository.js'
import { acquirePilotLease } from './dispatchPilot.js'
import { createClosureAuthority } from './closureAuthority.js'
import { createAlfrescoClosureStore } from './alfrescoClosureStore.js'
import { createAlfrescoOrdinaryClosureEngine } from './ordinaryClosureEngine.js'
import { assertInterventionMutable } from './closedInterventionPolicy.js'
import { installClosureRoutes } from './closureRoutes.js'
import { assessClosureRecovery } from './closureRecoveryAssessment.js'
import { closureOperationId, closureIntentHash, closureSourceHash } from './ordinaryClosureContract.js'

async function setup(t, dependency = 'DSA') {
  const f = attentionFixture(), root = await f.seed()
  for (const a of root.recipients) await f.repository.attendAssignment({ documentId: originalId, assignmentId: a.id, requestKey: `attend-${a.id}`, responseDocumentId: null }, actor(a.userId, a.functionalRole))
  const e = f.envelope()
  for (const d of e.dispatches) { d.senderDependency = dependency.toLowerCase(); for (const a of d.recipients) { a.dependency = dependency.toLowerCase(); a.senderDependency = dependency.toLowerCase() } }
  const node = f.nodes.get(originalId)
  node.properties['gd:asignaciones'] = JSON.stringify(e); Object.assign(node.properties, projections(e))
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-runtime-'))
  f.settings.dispatchPilot.leasePath = path.join(temporary, 'writer.lock')
  f.settings.documentClosure = { writesEnabled: true, environment: 'dev', expectedTarget: f.settings.alfrescoTarget, acknowledgement: 'single-instance-exclusive-writer-dev-closure' }
  const release = acquirePilotLease(f.settings)
  t.after(() => { release(); fs.rmSync(temporary, { recursive: true, force: true }) })
  const session = { ...actor('director', 'direccion'), dependency }
  const person = { id: 'director', functionalRole: 'direccion', dependency }
  const actors = new Map([[session.authorization, person]])
  const technical = 'Basic ' + Buffer.from('fixture_distribution:test-only').toString('base64')
  const state = { puts: 0, timeout: null, actorDenied: false, update: true, admin: false, timeoutBefore: false, denyAfterCommit: false }
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).hostname, 'alfresco.invalid', 'never contact real Alfresco')
    const p = new URL(url).pathname
    if (options.method === 'PUT') {
      assert.equal(options.headers.Authorization, technical)
      if (state.timeoutBefore) { state.timeoutBefore = false; throw new Error('simulated timeout before journal') }
      const body = JSON.parse(options.body)
      assert.deepEqual(Object.keys(body), ['properties']); assert.deepEqual(Object.keys(body.properties), ['gd:asignaciones'])
      node.properties['gd:asignaciones'] = body.properties['gd:asignaciones']; state.puts++
      if (state.timeout === JSON.parse(body.properties['gd:asignaciones']).closureOperations.at(-1).phase) { state.timeout = null; throw new Error('simulated timeout') }
      if (state.denyAfterCommit && JSON.parse(body.properties['gd:asignaciones']).closureOperations.at(-1).phase === 'COMMITTED') state.actorDenied = true
      return Response.json({ entry: node })
    }
    assert.equal(options.method, 'GET')
    if (options.headers.Authorization === technical && p.endsWith('/people/-me-')) return Response.json({ entry: { id: 'fixture_distribution', enabled: true, capabilities: { isAdmin: state.admin } } })
    const identity = identityResponse(url, options, actors, f.settings.groupMappings)
    if (identity) return identity
    if (state.actorDenied && options.headers.Authorization === session.authorization) return Response.json({}, { status: 403 })
    if (p.endsWith(`/nodes/${originalId}`)) {
      const n = structuredClone(node)
      if (options.headers.Authorization === technical && !state.update) n.allowableOperations = []
      return Response.json({ entry: n })
    }
    return f.fetchImpl(url, options)
  }
  const provider = createClosureAuthority(f.settings, fetchImpl)
  const store = () => createAlfrescoClosureStore(f.settings, { withDocument: f.repository.withDocument, fetchImpl })
  const engine = () => createAlfrescoOrdinaryClosureEngine(f.settings, { store: store(), fetchImpl, institutionalProvider: provider })
  const input = { documentId: originalId, scope: { type: 'dependency', dependency: dependency.toLowerCase() }, expectedEnvelopeRevision: e.revision, requestKey: 'closure-fixture', reason: 'Constancia sintética' }
  return { f, node, state, session, person, fetchImpl, provider, engine, input, release }
}
for (const dependency of ['DSA', 'DTI']) test(`Alfresco REST mocked ${dependency} writes and verifies a distinct V2 intervention`, async t => {
  const x = await setup(t, dependency), before = structuredClone(x.node)
  const r = await x.engine().decide(x.input, x.session)
  assert.equal(r.process.executionMode, 'ALFRESCO'); assert.equal(r.process.schemaVersion, 2)
  assert.equal(r.process.dependency, dependency.toLowerCase()); assert.equal(x.state.puts, 2)
  assert.equal(x.node.properties['gd:estado'], before.properties['gd:estado'])
  assert.deepEqual(x.f.envelope().dispatches, JSON.parse(before.properties['gd:asignaciones']).dispatches)
  assert.equal((await x.engine().decide(x.input, x.session)).repeated, true); assert.equal(x.state.puts, 2)
})
test('revocation, wrong dependency, ACL, update denial and administrative technical identity reject', async t => {
  for (const kind of ['revoked', 'other', 'acl', 'update', 'admin']) {
    const x = await setup(t)
    if (kind === 'revoked') x.person.functionalRole = 'especialista'
    if (kind === 'other') x.input.scope.dependency = 'dti'
    if (kind === 'acl') x.state.actorDenied = true
    if (kind === 'update') x.state.update = false
    if (kind === 'admin') x.state.admin = true
    await assert.rejects(x.engine().decide(x.input, x.session)); assert.equal(x.state.puts, 0)
  }
})
test('independent closure gate and a held single-writer lease are mandatory', async t => {
  const x = await setup(t); x.f.settings.documentClosure.writesEnabled = false
  assert.throws(() => x.engine().decide(x.input, x.session), /CLOSURE_WRITES_DISABLED/)
  x.f.settings.documentClosure.writesEnabled = true; x.release()
  assert.throws(() => x.engine().decide(x.input, x.session), /CLOSURE_EXCLUSIVE_WRITER_NOT_CONFIRMED/)
  assert.equal(x.state.puts, 0)
})
for (const phase of ['PREPARED', 'COMMITTED']) test(`mocked REST timeout ${phase} restores from Alfresco properties after service restart`, async t => {
  const x = await setup(t); x.state.timeout = phase
  await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_RESULT_UNCERTAIN/)
  if (phase === 'PREPARED') {
    await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_RECONCILIATION_REQUIRED/)
    assert.throws(() => assertInterventionMutable(x.f.envelope(), 'dsa'), /DOCUMENT_INTERVENTION_CLOSURE_PENDING/)
    assert.doesNotThrow(() => assertInterventionMutable(x.f.envelope(), 'dti'))
  }
  assert.equal((await x.engine().reconcile(x.input, x.session)).process.state, 'CERRADA')
  assert.equal(x.f.envelope().closureProcesses.length, 1); assert.equal(x.state.puts, 2)
})
test('real closures block new dispatch, attention and response links only for their dependency', async t => {
  const x = await setup(t); await x.engine().decide(x.input, x.session)
  const e = x.f.envelope()
  assert.throws(() => assertInterventionMutable(e, 'dsa'), /DOCUMENT_INTERVENTION_CLOSED/)
  assert.doesNotThrow(() => assertInterventionMutable(e, 'dti'))
  await assert.rejects(x.f.repository.attendAssignment({ documentId: originalId, assignmentId: e.dispatches[0].recipients[1].id, requestKey: 'post-close', responseDocumentId: null }, actor('staff', 'especialista')), /DOCUMENT_INTERVENTION_CLOSED/)
  x.f.addResponse()
  await assert.rejects(x.f.repository.linkResponse({ documentId: originalId, assignmentId: null, responseDocumentId: responseId, requestKey: 'post-close-link' }, x.session), /DOCUMENT_INTERVENTION_CLOSED/)
  const d = e.dispatches[0]
  await assert.rejects(x.f.repository.withDocument(originalId, () => x.f.repository.createDispatch({ ...d, requestKey: 'post-close-dispatch', recipients: [{ id: 'other-head', dependency: 'dsa', functionalRole: 'jefe-unidad' }] }, x.session)), /DOCUMENT_INTERVENTION_CLOSED/)
})
test('SIMULATED records cannot be promoted by the REST store', async t => {
  const x = await setup(t); await x.engine().decide(x.input, x.session)
  const e = x.f.envelope()
  for (const p of [...e.closureProcesses, ...e.closureOperations]) { p.schemaVersion = 1; p.executionMode = 'SIMULATED' }
  x.node.properties['gd:asignaciones'] = JSON.stringify(e)
  await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_SIMULATION_CANNOT_BE_PROMOTED/)
  assert.equal(x.state.puts, 2)
})
test('HTTP evaluation, explicit confirmation and reconciliation require session, CSRF and separate enablement', async t => {
  const x = await setup(t), app = express(); app.use(express.json())
  const requireSession = (req, res, next) => { if (req.get('x-fixture-session') !== 'director') return res.sendStatus(401); req.session = x.session; next() }
  const requireCsrf = (req, res, next) => req.get('x-csrf-token') === 'test-only' ? next() : res.sendStatus(403)
  installClosureRoutes(app, x.f.settings, { repository: x.f.repository, requireSession, requireCsrf, fetchImpl: x.fetchImpl })
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}/api/documents/closure`
  const headers = { 'x-fixture-session': 'director', 'x-csrf-token': 'test-only', 'Content-Type': 'application/json' }
  assert.equal((await fetch(base + `?documentId=${originalId}`)).status, 401)
  const evaluation = await (await fetch(base + `?documentId=${originalId}`, { headers })).json(); assert.equal(evaluation.canClose, true)
  const { scope, ...body } = x.input
  assert.equal((await fetch(base, { method: 'POST', headers: { ...headers, 'x-csrf-token': 'bad' }, body: JSON.stringify(body) })).status, 403)
  x.f.settings.documentClosure.writesEnabled = false
  assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) })).status, 503)
  assert.equal((await (await fetch(base + `?documentId=${originalId}`, { headers })).json()).canClose, false)
  x.f.settings.documentClosure.writesEnabled = true
  assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ ...body, scope: { type: 'dependency', dependency: 'dti' } }) })).status, 400)
  assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) })).status, 200)
  assert.equal((await (await fetch(base + `?documentId=${originalId}`, { headers })).json()).closed, true)
})

test('same backend queue serializes concurrent REST decisions and preserves opaque extensions', async t => {
  const x = await setup(t), e = x.f.envelope()
  e.futureExtension = { schemaVersion: 99, opaque: ['preserve'] }; x.node.properties['gd:asignaciones'] = JSON.stringify(e)
  const engine = x.engine()
  const result = await Promise.all([engine.decide(x.input, x.session), engine.decide(x.input, x.session)])
  assert.equal(result[0].process.id, result[1].process.id); assert.equal(result[1].repeated, true)
  assert.equal(x.state.puts, 2); assert.deepEqual(x.f.envelope().futureExtension, e.futureExtension)
})
test('unknown result without a confirmed journal blocks blind retry in the active backend', async t => {
  const x = await setup(t), engine = x.engine(); x.state.timeoutBefore = true
  await assert.rejects(engine.decide(x.input, x.session), /CLOSURE_RESULT_UNCERTAIN/)
  await assert.rejects(engine.decide(x.input, x.session), /CLOSURE_RECONCILIATION_REQUIRED/)
  await assert.rejects(engine.reconcile(x.input, x.session), /CLOSURE_OPERATION_NOT_FOUND/)
  assert.equal(x.state.puts, 0)
})
test('lost verification after committed PUT is uncertain; restored ACL recovers the same decision', async t => {
  const x = await setup(t), engine = x.engine(); x.state.denyAfterCommit = true
  await assert.rejects(engine.decide(x.input, x.session), /CLOSURE_RESULT_UNCERTAIN/)
  x.state.actorDenied = false
  assert.equal((await engine.reconcile(x.input, x.session)).repeated, true)
  assert.equal(x.state.puts, 2)
})
test('technical identity cannot impersonate actor; cancellation state alone is insufficient', async t => {
  const x = await setup(t); x.person.id = 'fixture_distribution'
  await assert.rejects(x.engine().decide(x.input, x.session), /INSTITUTIONAL_IDENTITY_REJECTED/)
  assert.equal(x.state.puts, 0)
  const y = await setup(t), e = y.f.envelope()
  e.history = e.history.filter(h => h.action !== 'ASSIGNMENT_ATTENDED')
  for (const a of e.dispatches[0].recipients) { a.status = 'ANULADO'; delete a.attendedAt; delete a.attendedByUserId }
  y.node.properties['gd:asignaciones'] = JSON.stringify(e); Object.assign(y.node.properties, projections(e))
  await assert.rejects(y.engine().decide(y.input, y.session), /CLOSURE_REQUIREMENTS_NOT_MET/)
  assert.equal(y.state.puts, 0)
})

test('membership in several dependencies is ambiguous, never global closure authority', async t => {
  const x = await setup(t)
  x.person.groups = ['GROUP_DSA', 'GROUP_DTI', 'GROUP_DIRECTORS']
  await assert.rejects(x.engine().decide(x.input, x.session), /INSTITUTIONAL_IDENTITY_REJECTED/)
  assert.equal(x.state.puts, 0)
})
test('valid configuration flags cannot enable a real host before recovery and writer fencing are proven', async t => {
  const x = await setup(t)
  x.f.settings.alfrescoTarget = 'https://repository.example.org'
  x.f.settings.documentClosure.expectedTarget = x.f.settings.alfrescoTarget
  x.f.settings.dispatchPilot.environments.dev.expectedTarget = x.f.settings.alfrescoTarget
  assert.throws(() => x.engine().decide(x.input, x.session), /CLOSURE_REAL_READINESS_BLOCKED/)
  assert.equal(x.state.puts, 0)
})
test('recovery assessment distinguishes absence, positive unsent proof, preparation, conflict and applied receipt', async t => {
  const x = await setup(t), before = x.f.envelope()
  const intent = { documentId: originalId, dependency: 'dsa', operationId: closureOperationId(originalId, 'director', x.input.requestKey),
    payloadHash: closureIntentHash({ ...x.input, dependency: 'dsa', actorUserId: 'director' }), sourceHash: closureSourceHash(before), expectedEnvelopeRevision: before.revision }
  const assess = (envelope, dispatchProof) => assessClosureRecovery({ envelope, intent, dispatchProof })
  assert.equal(assess(before).state, 'UNCERTAIN')
  const proof = { schemaVersion: 1, source: 'durable-dispatch-journal', verified: true, state: 'NEVER_DISPATCHED', allPriorWritersStopped: true,
    documentId: originalId, operationId: intent.operationId, payloadHash: intent.payloadHash, reference: 'synthetic-transport-proof' }
  assert.equal(assess(before, proof).state, 'NOT_EXECUTED')
  assert.equal(assess(before, { ...proof, allPriorWritersStopped: false }).state, 'UNCERTAIN')
  assert.equal(assess(before, { ...proof, payloadHash: '0'.repeat(64) }).state, 'UNCERTAIN')
  const engine = x.engine(); x.state.timeout = 'PREPARED'
  await assert.rejects(engine.decide(x.input, x.session), /CLOSURE_RESULT_UNCERTAIN/)
  const prepared = x.f.envelope()
  assert.equal(assess(prepared).state, 'PENDING')
  const external = structuredClone(prepared); external.revision++
  assert.equal(assess(external).state, 'CONFLICT')
  await engine.reconcile(x.input, x.session)
  const applied = assess(x.f.envelope())
  assert.equal(applied.state, 'APPLIED'); assert.equal(applied.mayAutomaticallyWrite, false)
})
