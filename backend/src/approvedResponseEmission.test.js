import test from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './testFixtures/reviews.js'
import { officialFixture } from './testFixtures/officialEmission.js'
import { createAlfrescoProposalAdapter } from './alfrescoProposalAdapter.js'
import { createOfficialEmissionService } from './officialEmissionService.js'
import { createApprovedResponseEmission } from './approvedResponseEmission.js'
import { proposalMetadataHash, assertReviewResponseLink, applyReviewEvent } from './responseReview.js'

async function integrated(t, { approved = true, typed = true, legacy = false } = {}) {
  const f = await setup('jefe-unidad')
  if (typed) {
    // Seed an existing typed proposal before review. This does NOT claim that the
    // stage-2 creation API currently accepts a business type.
    f.state.nodes.get('proposal-node').properties['gd:tipoDocumental'] = 'OFICIO'
    f.state.versionMap.get('1.0').node.properties['gd:tipoDocumental'] = 'OFICIO'
    const envelope = f.envelope()
    const hash = proposalMetadataHash(f.state.nodes.get('proposal-node'))
    envelope.reviewProcesses[0].snapshot.metadataSha256 = hash
    envelope.reviewProcesses[0].events[0].snapshot.metadataSha256 = hash
    envelope.reviewOperations[0].snapshot.metadataSha256 = hash
    f.state.original.properties['gd:asignaciones'] = JSON.stringify(envelope)
  }
  if (approved) {
    await f.service().decide(f.input('SUBMIT'), f.sessions.author)
    await f.service().decide(f.input('APPROVE'), f.sessions.direction)
  }
  const e = officialFixture(t)
  const legacyResult = legacy ? await e.service.issue(e.session('DSA', 'direction'), e.input('legacy-before-review')) : null
  e.service.release()
  const roots = Object.fromEntries(['DTI', 'DSA'].map((dep) => [dep, { ...e.settings.officeInboxNodeIds[dep], reviewSource: f.settings.officeInboxNodeIds[dep].porAtender }]))
  Object.assign(f.settings, { alfrescoTarget: e.settings.alfrescoTarget, officeInboxNodeIds: roots, dispatchPersistence: 'alfresco',
    dispatchPilot: e.settings.dispatchPilot, distributionService: e.settings.distributionService, officeGroupIds: e.settings.officeGroupIds, officialEmission: e.settings.officialEmission })
  const serviceAuth = 'Basic ' + Buffer.from('gd_distribucion:test-only').toString('base64')
  f.actors.set(serviceAuth, { id: 'gd_distribucion', functionalRole: 'direccion', dependency: 'DSA' })
  const references = new Set()
  const conditions = { referenceDenied: false }
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const method = options.method || 'GET'
    const id = u.pathname.split('/nodes/')[1]?.split('/')[0]
    const auth = options.headers.Authorization
    const actor = f.actors.get(auth)
    const translated = { ...options, headers: { ...options.headers, Authorization: auth === serviceAuth ? auth : `actor:${actor?.dependency}|${actor?.id}` } }
    if (u.pathname.includes('/people/')) return f.fetchImpl(url, options)
    if (u.pathname.endsWith('/classes/gd_identificacion') || u.pathname.endsWith('/classes/gd_clasificacion')) return e.fetch(url, translated)
    if (e.nodes.has(id)) {
      if (method === 'PUT') {
        const body = JSON.parse(options.body)
        assert.deepEqual(Object.keys(body), ['aspectNames'], 'no ACL or metadata mutation on the official PDF')
        e.nodes.get(id).aspectNames = body.aspectNames
        return Response.json({ entry: e.nodes.get(id) })
      }
      if (u.pathname.endsWith('/targets')) {
        if (method === 'POST') {
          if (conditions.referenceDenied) return Response.json({}, { status: 403 })
          assert.deepEqual(JSON.parse(options.body), { targetId: 'original', assocType: 'cm:references' })
          references.add(id)
          return Response.json({ entry: { id: 'original' } }, { status: 201 })
        }
        return Response.json({ list: { entries: references.has(id) ? [{ entry: { id: 'original', association: { assocType: 'cm:references' } } }] : [], pagination: { hasMoreItems: false, skipCount: 0 } } })
      }
      return e.fetch(url, translated)
    }
    return f.fetchImpl(url, options)
  }
  let official
  const makeOfficial = () => createOfficialEmissionService(f.settings, fetchImpl, () => new Date('2026-11-19T18:00:00Z'))
  official = makeOfficial()
  e.beforeCleanup(() => official.release())
  const policy = async () => ({ documentPeriod: '2026 - II', priority: 'Normal', recipientDependency: 'DTI', receiptCategory: 'por-atender' })
  const make = (emitter = official) => createApprovedResponseEmission({
    alfrescoAdapter: createAlfrescoProposalAdapter(f.settings, { fetchImpl, withDocument: f.withDocument, simulationOnly: true }), officialEmitter: emitter,
    institutionalProvider: f.provider, resolveEmissionOptions: policy, clock: () => new Date('2026-11-19T18:00:00Z'),
  })
  const input = { documentId: 'original', processId: f.proposal.id, requestKey: 'emit-approved', expectedRevision: f.envelope().reviewProcesses[0].revision, expectedVersionId: '1.0' }
  return { f, e, conditions, input, make, references, legacyResult, get official() { return official }, restart() { official.release(); official = makeOfficial(); return make() } }
}

test('approved bytes use the existing real issuer, counter, identity and distribution; UUIDs stay separate', async (t) => {
  const x = await integrated(t)
  const before = x.f.envelope()
  const result = await x.make().emit(x.input, x.f.sessions.direction)
  assert.equal(result.process.state, 'EMITIDA'); assert.equal(result.emission.record.number, 1)
  assert.equal(result.emission.record.documentCode, 'DSA')
  assert.deepEqual(result.metadataWarnings, ['DOCUMENT_PRIORITY_NOT_PERSISTED', 'ACADEMIC_PERIOD_NOT_PERSISTED'])
  assert.notEqual(result.emission.record.documentId, result.process.proposalDocumentId)
  assert.notEqual(result.emission.record.documentId, 'original')
  assert.deepEqual(x.e.nodes.get(result.emission.record.documentId).file, x.f.state.versionMap.get('1.0').bytes)
  assert.ok(x.e.children.get('DTI-attention').includes(result.emission.record.documentId))
  assert.ok(x.references.has(result.emission.record.documentId))
  assert.deepEqual(x.f.envelope().dispatches, before.dispatches)
  assert.equal(x.f.state.original.properties['gd:estado'], 'PENDIENTE')
  assert.equal(x.f.envelope().history.at(-1).action, 'DOCUMENT_RESPONSE_LINKED')
  const again = await x.restart().emit(x.input, x.f.sessions.direction)
  assert.equal(again.repeated, true); assert.equal(again.emission.record.documentId, result.emission.record.documentId)
  assert.deepEqual(again.metadataWarnings, result.metadataWarnings)
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})

test('missing approval and missing approved type block before an official PDF is created', async (t) => {
  for (const options of [{ approved: false }, { typed: false }]) {
    const x = await integrated(t, options)
    await assert.rejects(x.make().emit(x.input, x.f.sessions.direction), options.approved === false ? /APPROVAL_REQUIRED/ : /DOCUMENT_TYPE_REQUIRED/)
    assert.equal([...x.e.nodes.values()].filter((n) => n.isFile).length, 0)
  }
})

test('changed content, empty/missing version and altered metadata never issue', async (t) => {
  for (const mutate of [
    (f) => { f.state.versionMap.get('1.0').bytes = Buffer.from('%PDF-altered') },
    (f) => { f.state.versionMap.get('1.0').bytes = Buffer.alloc(0) },
    (f) => { f.state.versionMap.delete('1.0') },
    (f) => { f.state.nodes.get('proposal-node').properties['cm:title'] = 'modified' },
  ]) {
    const x = await integrated(t); mutate(x.f)
    await assert.rejects(x.make().emit(x.input, x.f.sessions.direction))
    assert.equal([...x.e.nodes.values()].filter((n) => n.isFile).length, 0)
  }
})

test('wrong actor/department, revoked authority, stale UI and ACL denials cannot emit', async (t) => {
  for (const mutate of [
    (x) => { x.f.actors.get('Basic direction').groups = ['GROUP_DSA'] },
    (x) => { x.f.state.denyOriginalRead = true },
    (x) => { x.f.state.denyProposalRead = true },
    (x) => { x.input.expectedRevision = 99 },
    (x) => { x.input.expectedVersionId = '99.0' },
  ]) {
    const x = await integrated(t); mutate(x)
    await assert.rejects(x.make().emit(x.input, x.f.sessions.direction))
    assert.equal([...x.e.nodes.values()].filter((n) => n.isFile).length, 0)
  }
  const x = await integrated(t)
  await assert.rejects(x.make().emit(x.input, x.f.sessions.head), /AUTHORITY_REQUIRED/)
  await assert.rejects(x.make().emit(x.input, x.f.sessions.foreign), /AUTHORITY_REQUIRED/)
  await assert.rejects(x.make().emit({ ...x.input, file: Buffer.from('%PDF-forged') }, x.f.sessions.direction), /INVALID_INPUT/)
})

test('timeout after official creation reconciles with the same number and no second PDF', async (t) => {
  const x = await integrated(t); x.e.conditions.timeoutAfterCreate = true
  let failure
  try { await x.make().emit(x.input, x.f.sessions.direction) } catch (e) { failure = e }
  assert.equal(failure.message, 'REVIEW_EMISSION_RESULT_UNCERTAIN')
  assert.equal(failure.number, 1); assert.ok(failure.emittedNodeId)
  assert.equal(x.f.envelope().reviewProcesses[0].state, 'APROBADA')
  assert.equal(x.f.envelope().reviewOperations.at(-1).phase, 'UNCERTAIN')
  await assert.rejects(x.make().emit(x.input, x.f.sessions.direction), /RECONCILIATION_REQUIRED/)
  const recovered = await x.make().reconcile(x.input, x.f.sessions.direction)
  assert.equal(recovered.emission.record.documentId, failure.emittedNodeId)
  assert.equal(recovered.emission.record.number, 1)
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})

test('partial original registration survives a new issuer/coordinator and never emits twice', async (t) => {
  const x = await integrated(t); x.f.state.failure = 'final-put'
  await assert.rejects(x.make().emit(x.input, x.f.sessions.direction), /RESULT_UNCERTAIN/)
  const recovered = await x.restart().reconcile(x.input, x.f.sessions.direction)
  assert.equal(recovered.process.state, 'EMITIDA'); assert.equal(recovered.emission.record.number, 1)
  assert.equal(x.f.envelope().reviewProcesses[0].events.filter((e) => e.action === 'EMIT').length, 1)
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})

test('an incomplete HTTP success is reconciled by GET, never trusted as an issued process', async (t) => {
  const x = await integrated(t)
  const emitter = { async issueReviewed(...args) { await x.official.issueReviewed(...args); return { officialEmission: true } } }
  await assert.rejects(x.make(emitter).emit(x.input, x.f.sessions.direction), /RESULT_UNCERTAIN/)
  assert.equal(x.f.envelope().reviewProcesses[0].state, 'APROBADA')
  assert.ok(x.f.envelope().reviewOperations.at(-1).emission.record.documentId)
  assert.equal((await x.restart().reconcile(x.input, x.f.sessions.direction)).process.state, 'EMITIDA')
})

test('legacy raw emission and response linkage cannot register an unreviewed PDF in this circuit', async (t) => {
  const x = await integrated(t)
  const payload = { ...x.e.input(), file: x.f.state.versionMap.get('1.0').bytes }
  await assert.rejects(x.official.issue(x.f.sessions.direction, payload), /REVIEW_SERVICE_REQUIRED/)
  await assert.rejects(x.official.issue(x.f.sessions.direction, { ...payload, approved: true }), /REVIEW_SERVICE_REQUIRED/)
  assert.throws(() => assertReviewResponseLink(x.f.envelope(), 'arbitrary-emission'), /REVIEW_EMISSION_REQUIRED/)
  assert.doesNotThrow(() => assertReviewResponseLink({ dispatches: [], history: [] }, 'legacy-response'))
  assert.equal((await x.make().emit(x.input, x.f.sessions.direction)).process.state, 'EMITIDA')
  assert.doesNotThrow(() => assertReviewResponseLink(x.f.envelope(), x.f.envelope().reviewProcesses[0].emissionDocumentId))
})

test('invalidated or stale approval never reserves a number; arbitrary payload and production activation stay blocked', async (t) => {
  const x = await integrated(t)
  const envelope = x.f.envelope(); const p = envelope.reviewProcesses[0]
  envelope.reviewProcesses[0] = applyReviewEvent(p, { id: 'new-revision', requestKey: 'new-version', action: 'REVISE', actorUserId: p.authorUserId,
    actorRole: p.authorRole, dependency: p.dependency, at: '2026-11-19T17:00:00Z', expectedRevision: p.revision,
    snapshot: { ...p.snapshot, versionId: '2.0' }, reason: '', emissionDocumentId: null }, { verified: true })
  x.f.state.original.properties['gd:asignaciones'] = JSON.stringify(envelope)
  assert.equal(envelope.reviewProcesses[0].approval, null)
  await assert.rejects(x.make().emit({ ...x.input, expectedRevision: envelope.reviewProcesses[0].revision, expectedVersionId: '2.0' }, x.f.sessions.direction), /APPROVAL_REQUIRED/)
  assert.equal([...x.e.nodes.values()].filter((n) => n.isFile).length, 0)
  const y = await integrated(t)
  const stale = y.f.envelope(); stale.reviewProcesses[0].approval.contentSha256 = 'a'.repeat(64)
  y.f.state.original.properties['gd:asignaciones'] = JSON.stringify(stale)
  await assert.rejects(y.make().emit(y.input, y.f.sessions.direction), /INVALID_HISTORY/)
  const blocked = createApprovedResponseEmission({ alfrescoAdapter: createAlfrescoProposalAdapter(y.f.settings), officialEmitter: y.official })
  await assert.rejects(blocked.emit(y.input, y.f.sessions.direction), /WRITES_DISABLED/)
})

test('reference failure preserves the official receipt; a new key and empty reconciliation cannot create another PDF', async (t) => {
  const x = await integrated(t); x.conditions.referenceDenied = true
  await assert.rejects(x.make().emit(x.input, x.f.sessions.direction), /RESULT_UNCERTAIN/)
  const receipt = x.f.envelope().reviewOperations.at(-1).emission
  assert.ok(receipt); assert.equal(receipt.record.number, 1)
  await assert.rejects(x.make().emit({ ...x.input, requestKey: 'other-key' }, x.f.sessions.direction), /RECONCILIATION_REQUIRED/)
  x.conditions.referenceDenied = false
  assert.equal((await x.restart().reconcile(x.input, x.f.sessions.direction)).emission.record.documentId, receipt.record.documentId)
  await assert.rejects(x.make().emit({ ...x.input, requestKey: 'other-key', expectedRevision: x.f.envelope().reviewProcesses[0].revision }, x.f.sessions.direction), /ALREADY_STARTED/)
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
  const y = await integrated(t)
  y.f.state.onOriginalPut = (envelope) => { if (envelope.reviewOperations.at(-1).action === 'EMIT') throw new Error('timeout-before-official-call') }
  await assert.rejects(y.make().emit(y.input, y.f.sessions.direction))
  y.f.state.onOriginalPut = null
  await assert.rejects(y.make().reconcile(y.input, y.f.sessions.direction), /RESULT_UNCERTAIN/)
  assert.equal(y.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 0)
})

test('altering a PDF cannot use the raw endpoint to bypass review; existing legitimate emission retries still recover', async (t) => {
  const x = await integrated(t, { legacy: true })
  await assert.rejects(x.official.issue(x.f.sessions.direction, { ...x.e.input(), file: Buffer.concat([x.f.state.versionMap.get('1.0').bytes, Buffer.from('\n%changed')]) }), /REVIEW_CLASSIFICATION_REQUIRED/)
  const recovered = await x.official.issue(x.f.sessions.direction, x.e.input('legacy-before-review'))
  assert.equal(recovered.emittedEntry.id, x.legacyResult.emittedEntry.id)
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})

test('correct IDs in an HTTP success do not prove secondary delivery; partial identity remains recoverable', async (t) => {
  const x = await integrated(t)
  const partial = { async issueReviewed(...args) {
    const result = await x.official.issueReviewed(...args)
    x.e.children.set('DTI-attention', [])
    return result
  } }
  let error
  try { await x.make(partial).emit(x.input, x.f.sessions.direction) } catch (e) { error = e }
  assert.equal(error.message, 'REVIEW_EMISSION_RESULT_UNCERTAIN')
  assert.equal(error.number, 1); assert.ok(error.emittedNodeId)
  assert.equal(x.f.envelope().reviewProcesses[0].state, 'APROBADA')
  const result = await x.restart().reconcile(x.input, x.f.sessions.direction)
  assert.equal(result.process.state, 'EMITIDA')
  assert.ok(x.e.children.get('DTI-attention').includes(result.emission.record.documentId))
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})

test('external official number mutation never replaces the verified historical receipt', async (t) => {
  const x = await integrated(t)
  const first = await x.make().emit(x.input, x.f.sessions.direction)
  x.e.nodes.get(first.emission.record.documentId).properties['gd:numero'] = '99'
  await assert.rejects(x.make().emit(x.input, x.f.sessions.direction), /RESULT_UNCERTAIN/)
  assert.equal(x.f.envelope().reviewOperations.at(-1).emission.record.number, 1)
  await assert.rejects(x.restart().reconcile(x.input, x.f.sessions.direction), /RESULT_UNCERTAIN/)
  const p = x.f.envelope().reviewProcesses[0]
  assert.equal(p.events.find((e) => e.action === 'EMIT').emission.record.number, 1)
  assert.equal(x.f.envelope().reviewOperations.at(-1).emission.record.number, 1)
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})

test('two concurrent retries of one approval share the original lock and allocate one official UUID', async (t) => {
  const x = await integrated(t)
  const [a, b] = await Promise.all([x.make().emit(x.input, x.f.sessions.direction), x.make().emit(x.input, x.f.sessions.direction)])
  assert.equal(a.emission.record.documentId, b.emission.record.documentId)
  assert.equal(a.emission.record.number, b.emission.record.number)
  assert.equal(b.repeated, true)
  assert.equal(x.f.envelope().reviewProcesses[0].events.filter((e) => e.action === 'EMIT').length, 1)
  assert.equal(x.e.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})
