import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrdinaryClosureEngine } from './ordinaryClosureEngine.js'
import { createClosureSimulationStore } from './closureSimulationStore.js'
import { validateOrdinaryClosures, closureSourceHash } from './ordinaryClosureContract.js'
import { evidenceHash, evidenceEventId } from './closureEvidenceContract.js'
import { attentionFixture, actor, originalId } from './testFixtures/attention.js'
import { identityResponse } from './testFixtures/institutionalIdentity.js'
import { projections } from './alfrescoDispatchRepository.js'

async function fixture(mode = 'attended') {
  const f = attentionFixture(), root = await f.seed()
  for (let i = 0; i < root.recipients.length; i++) {
    if (mode === 'pending' && i === 1 || mode === 'cancelled' || mode === 'mixed' && i === 1 || mode === 'unverified-cancel') continue
    const recipient = root.recipients[i]
    await f.repository.attendAssignment({ documentId: originalId, assignmentId: recipient.id, requestKey: `attend-${i}`, responseDocumentId: null }, actor(recipient.userId, recipient.functionalRole))
  }
  const envelope = f.envelope()
  envelope.futureExtension = { schemaVersion: 99, opaque: 'preserve' }
  envelope.closureEvidence = { schemaVersion: 1, cancellations: [], classifications: [], confirmations: [], events: [] }
  if (['cancelled', 'mixed', 'unverified-cancel'].includes(mode)) {
    for (const a of envelope.dispatches[0].recipients) {
      if (mode === 'mixed' && a.status === 'ATENDIDO') continue
      a.status = 'ANULADO'
      if (mode === 'unverified-cancel') continue
      const r = { id: `cancel-${a.id}`, documentId: originalId, dependency: 'dsa', actorUserId: 'director', at: '2099-01-01T12:00:00Z',
        documentRevision: envelope.revision, requestKey: `cancel-${a.id}`, assignmentId: a.id, reason: 'Motivo sintético' }
      r.eventId = evidenceEventId(r, 'CANCEL_ASSIGNMENT')
      envelope.closureEvidence.cancellations.push(r)
      envelope.closureEvidence.events.push({ id: r.eventId, action: 'CANCEL_ASSIGNMENT', recordId: r.id, actorUserId: r.actorUserId,
        dependency: r.dependency, at: r.at, documentRevision: r.documentRevision, requestKey: r.requestKey, payloadHash: evidenceHash(r) })
    }
  }
  const node = f.nodes.get(originalId)
  node.properties['gd:asignaciones'] = JSON.stringify(envelope); Object.assign(node.properties, projections(envelope))
  const faults = {}, store = createClosureSimulationStore({ nodes: f.nodes, withDocument: f.repository.withDocument, faults })
  const session = actor('director', 'direccion')
  const actors = new Map([[session.authorization, { id: 'director', functionalRole: 'direccion', dependency: 'DSA' }]])
  const state = { denied: false, change: false, revoke: false, noProvider: false, proofDenied: false }
  let sourceReads = 0, currentStore = store
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, 'GET', 'decision adapter cannot perform real HTTP writes')
    assert.equal(options.headers.Authorization, session.authorization)
    const identity = identityResponse(url, options, actors, f.settings.groupMappings)
    if (identity) return identity
    const p = new URL(url).pathname
    if (p.includes('/people/director') && !p.endsWith('/groups')) return Response.json({ entry: { id: 'director', enabled: true } })
    if (state.denied) return Response.json({}, { status: 403 })
    if (p.endsWith(`/nodes/${originalId}`)) {
      sourceReads++
      if (state.change && sourceReads === 2) {
        const n = currentStore.node(originalId), e = JSON.parse(n.properties['gd:asignaciones'])
        e.revision++; e.futureExtension.opaque = 'changed outside queue'
        n.properties['gd:asignaciones'] = JSON.stringify(e); currentStore.replaceFixtureNode(n)
      }
      return Response.json({ entry: currentStore.node(originalId) })
    }
    return f.fetchImpl(url, options)
  }
  const provider = {
    async authorizeOrdinaryClosure(input) {
      if (state.revoke && input.envelopeRevision > envelope.revision) actors.get(session.authorization).functionalRole = 'especialista'
      return { ...input, verified: !state.proofDenied, source: 'alfresco', reference: 'synthetic-closure-authority', groupIds: ['GROUP_DIRECTORS'] }
    },
    async verifyClosureEvidence(input) { return { ...input, verified: true, source: 'alfresco', reference: 'synthetic-event-proof', groupIds: ['GROUP_DIRECTORS'], authorizedAt: '2099-01-01T12:00:00Z' } },
  }
  const engine = () => createOrdinaryClosureEngine(f.settings, { store: currentStore, fetchImpl, institutionalProvider: state.noProvider ? undefined : provider, clock: () => new Date('2099-01-01T13:00:00Z') })
  const input = { documentId: originalId, scope: { type: 'dependency', dependency: 'dsa' }, expectedEnvelopeRevision: envelope.revision, requestKey: 'close-key', reason: 'Constancia sintética' }
  return { f, store, faults, session, actors, state, provider, engine, input, fetchImpl,
    restart: () => { currentStore = createClosureSimulationStore({ nodes: currentStore.snapshot(), withDocument: f.repository.withDocument }); return currentStore } }
}

for (const mode of ['attended', 'mixed', 'cancelled']) test(`ordinary direct decision ${mode} persists only a simulated closed intervention`, async () => {
  const x = await fixture(mode), before = await x.store.read(originalId)
  const result = await x.engine().decide(x.input, x.session), after = await x.store.read(originalId)
  assert.equal(result.process.state, 'CERRADA'); assert.equal(result.simulationOnly, true); assert.equal(result.writesEnabled, false)
  assert.equal(result.process.dependency, 'dsa')
  assert.equal(closureSourceHash(after.envelope), closureSourceHash(before.envelope))
  assert.equal(after.envelope.closureOperations[0].phase, 'COMMITTED')
  assert.equal(after.envelope.revision, before.envelope.revision + 2)
  assert.equal(after.node.properties['gd:estado'], before.node.properties['gd:estado'])
  for (const key of Object.keys(before.node.properties).filter(k => k !== 'gd:asignaciones')) assert.deepEqual(after.node.properties[key], before.node.properties[key])
  assert.doesNotThrow(() => validateOrdinaryClosures(after.envelope))
})
for (const mode of ['pending', 'unverified-cancel']) test(`requirements ${mode} never produce a process`, async () => {
  const x = await fixture(mode), before = x.store.snapshot()
  await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_REQUIREMENTS_NOT_MET/)
  assert.deepEqual(x.store.snapshot(), before)
})
test('non-Direction, wrong dependency, unverified authority and absent provider reject', async () => {
  for (const kind of ['role', 'dependency', 'proof', 'provider']) {
    const x = await fixture()
    if (kind === 'role') { x.session.functionalRole = 'especialista'; x.actors.get(x.session.authorization).functionalRole = 'especialista' }
    if (kind === 'dependency') { x.session.dependency = 'DTI'; x.actors.get(x.session.authorization).dependency = 'DTI' }
    if (kind === 'proof') x.state.proofDenied = true
    if (kind === 'provider') x.state.noProvider = true
    await assert.rejects(x.engine().decide(x.input, x.session))
    assert.equal((await x.store.read(originalId)).envelope.closureProcesses, undefined)
  }
})
test('actor ACL denied, stale expected revision and integral scope never close', async () => {
  const x = await fixture(); x.state.denied = true
  await assert.rejects(x.engine().decide(x.input, x.session), e => e.status === 403)
  x.state.denied = false
  await assert.rejects(x.engine().decide({ ...x.input, expectedEnvelopeRevision: 0 }, x.session), /CLOSURE_STALE_REVISION/)
  await assert.rejects(x.engine().decide({ ...x.input, scope: { type: 'document' } }, x.session), /CLOSURE_INTEGRAL_DISABLED/)
})
test('concurrent external modification invalidates evaluation rather than overwriting', async () => {
  const x = await fixture(); x.state.change = true
  await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_SNAPSHOT_CHANGED/)
  assert.equal((await x.store.read(originalId)).envelope.closureProcesses, undefined)
})
test('idempotent simultaneous requests share queue; changed intent and second closure are rejected', async () => {
  const x = await fixture(), engine = x.engine()
  const results = await Promise.all([engine.decide(x.input, x.session), engine.decide(x.input, x.session)])
  assert.equal(results[0].process.id, results[1].process.id)
  assert.equal(results[1].repeated, true)
  assert.equal((await x.store.read(originalId)).envelope.closureProcesses.length, 1)
  await assert.rejects(engine.decide({ ...x.input, reason: 'Different intent' }, x.session), /CLOSURE_IDEMPOTENCY_CONFLICT/)
  await assert.rejects(engine.decide({ ...x.input, requestKey: 'another-key' }, x.session), /CLOSURE_ALREADY_CLOSED/)
})
for (const phase of ['PREPARED', 'COMMITTED']) test(`timeout after ${phase} reconciles after simulated restart without another closure`, async () => {
  const x = await fixture(); x.faults.throwAfterPhase = phase
  await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_RESULT_UNCERTAIN/)
  x.restart()
  if (phase === 'PREPARED') await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_RECONCILIATION_REQUIRED/)
  const result = await x.engine().reconcile(x.input, x.session)
  assert.equal(result.process.state, 'CERRADA')
  assert.equal((await x.engine().decide(x.input, x.session)).repeated, true)
})
test('documentary changes after partial operation block reconciliation', async () => {
  const x = await fixture(); x.faults.throwAfterPhase = 'PREPARED'
  await assert.rejects(x.engine().decide(x.input, x.session))
  const node = x.store.node(originalId), envelope = JSON.parse(node.properties['gd:asignaciones'])
  envelope.futureExtension.opaque = 'external'; node.properties['gd:asignaciones'] = JSON.stringify(envelope); x.store.replaceFixtureNode(node)
  await assert.rejects(x.engine().reconcile(x.input, x.session), /CLOSURE_RECONCILIATION_CONFLICT/)
})
test('only genuine memory stores, mock transport and invalid host can instantiate engine', async () => {
  const x = await fixture()
  for (const options of [{ store: { simulationOnly: true }, fetchImpl: x.fetchImpl }, { store: x.store, fetchImpl: globalThis.fetch }]) {
    assert.throws(() => createOrdinaryClosureEngine(x.f.settings, options), /CLOSURE_REAL_WRITES_DISABLED/)
  }
  assert.throws(() => createOrdinaryClosureEngine({ ...x.f.settings, alfrescoTarget: 'https://repository.example.org' }, { store: x.store, fetchImpl: x.fetchImpl }), /CLOSURE_REAL_WRITES_DISABLED/)
})
test('closed evidence history is validated and cannot be rewritten by simulated persistence', async () => {
  const x = await fixture(); await x.engine().decide(x.input, x.session)
  const before = await x.store.read(originalId), next = structuredClone(before.envelope)
  next.revision++; next.closureProcesses[0].reason = 'rewrite'
  await assert.rejects(x.store.save(originalId, next, before.raw), /CLOSURE_INVALID_PROCESS_CONTRACT/)
  assert.equal((await x.store.read(originalId)).raw, before.raw)
})

test('closing DSA never closes pending DTI obligations on the same UUID', async () => {
  const x = await fixture(), node = x.store.node(originalId), e = JSON.parse(node.properties['gd:asignaciones'])
  const d = structuredClone(e.dispatches[0])
  Object.assign(d, { id: 'dti-dispatch', requestKey: 'dti-dispatch', senderUserId: 'dti-direction', senderDependency: 'dti' })
  const a = { ...d.recipients[0], id: 'dti-assignment', userId: 'dti-specialist', dependency: 'dti', functionalRole: 'especialista',
    status: 'ASIGNADO', dispatchId: d.id, senderUserId: d.senderUserId, senderDependency: 'dti' }
  delete a.attendedAt; delete a.attendedByUserId; d.recipients = [a]
  e.dispatches.push(d); e.history.push({ id: 'dti-created', action: 'DISPATCH_CREATED', actorUserId: d.senderUserId, at: d.createdAt, dispatchId: d.id, assignmentIds: [a.id] })
  e.revision++; x.input.expectedEnvelopeRevision = e.revision
  node.properties['gd:asignaciones'] = JSON.stringify(e); Object.assign(node.properties, projections(e)); x.store.replaceFixtureNode(node)
  await x.engine().decide(x.input, x.session)
  const after = (await x.store.read(originalId)).envelope
  assert.deepEqual(after.dispatches, e.dispatches)
  assert.deepEqual(after.closureProcesses.map(p => p.dependency), ['dsa'])
  assert.equal(after.dispatches.at(-1).recipients[0].status, 'ASIGNADO')
})
test('size overhead of journal and decision cannot exceed the whole envelope limit', async () => {
  const x = await fixture(), node = x.store.node(originalId), e = JSON.parse(node.properties['gd:asignaciones'])
  e.futureExtension.padding = 'x'.repeat(256 * 1024 - Buffer.byteLength(JSON.stringify(e)) - 100)
  node.properties['gd:asignaciones'] = JSON.stringify(e); x.store.replaceFixtureNode(node)
  const before = (await x.store.read(originalId)).raw
  await assert.rejects(x.engine().decide(x.input, x.session), /CLOSURE_ENVELOPE_SIZE_LIMIT/)
  assert.equal((await x.store.read(originalId)).raw, before)
})
test('role revoked between preparation and commit is revalidated and no closure is committed', async () => {
  const x = await fixture(); x.state.revoke = true
  await assert.rejects(x.engine().decide(x.input, x.session), /INSTITUTIONAL_IDENTITY_REJECTED/)
  const after = (await x.store.read(originalId)).envelope
  assert.deepEqual(after.closureProcesses, [])
  assert.equal(after.closureOperations[0].phase, 'PREPARED')
})

test('simulation store cannot be repurposed by replacing a method; client enable flags are rejected', async () => {
  const x = await fixture()
  assert.equal(Object.isFrozen(x.store), true)
  assert.throws(() => { x.store.save = globalThis.fetch }, TypeError)
  await assert.rejects(x.engine().decide({ ...x.input, approved: true, executionMode: 'REAL' }, x.session), /CLOSURE_INVALID_DECISION/)
  assert.equal((await x.store.read(originalId)).envelope.closureProcesses, undefined)
})

test('a fresh process has no simulated decisions unless an explicit fixture snapshot is restored', async () => {
  const x = await fixture(); await x.engine().decide(x.input, x.session)
  const fresh = createClosureSimulationStore({ nodes: x.f.nodes, withDocument: x.f.repository.withDocument })
  assert.equal((await fresh.read(originalId)).envelope.closureProcesses, undefined)
  assert.equal((await x.store.read(originalId)).envelope.closureProcesses[0].executionMode, 'SIMULATED')
  assert.equal((await x.restart().read(originalId)).envelope.closureProcesses[0].executionMode, 'SIMULATED')
})
