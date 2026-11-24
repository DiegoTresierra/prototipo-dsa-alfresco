import test from 'node:test'
import assert from 'node:assert/strict'
import { listClosureInbox, closureCategory } from './closureInbox.js'
import { identityResponse } from './testFixtures/institutionalIdentity.js'
import { evaluateClosure } from './closureEvaluation.js'
import { evidenceHash } from './closureEvidenceContract.js'

function fixture() {
  const settings = { alfrescoTarget: 'https://closure-inbox.invalid', groupMappings: {
    dependencies: { DSA: 'GROUP_FIXTURE_DSA', DTI: 'GROUP_FIXTURE_DTI' }, functions: { direccion: 'GROUP_FIXTURE_DIRECTION', especialista: 'GROUP_FIXTURE_STAFF' } },
  officeInboxNodeIds: { DSA: { emitidos: 'dsa-emitted', porAtender: 'dsa-attention', porConocimiento: 'dsa-knowledge' },
    DTI: { emitidos: 'dti-emitted', porAtender: 'dti-attention', porConocimiento: 'dti-knowledge' } } }
  const session = { alfresco: { id: 'direction-fixture' }, authorization: 'actor-fixture', authorizationStatus: 'active',
    functionalRole: 'direccion', dependency: 'DSA', capabilities: ['documents:read'] }
  const person = { id: session.alfresco.id, dependency: 'DSA', functionalRole: 'direccion' }
  const actors = new Map([[session.authorization, person]])
  const nodes = new Map(), folders = new Map(), calls = [], evaluated = []
  for (const f of Object.values(settings.officeInboxNodeIds).flatMap(Object.values)) folders.set(f, [])
  function add(id, memberships = ['dsa-attention'], status = 'ATENDIDO', dependency = 'dsa') {
    const e = { schemaVersion: 1, documentId: id, revision: 1, dispatches: [], history: [] }
    if (status) {
      const r = { id: `dispatch-${id}`, documentId: id, senderUserId: 'direction-fixture', senderRole: 'direccion', senderDependency: dependency,
        requestKey: `key-${id}`, originAssignmentId: null, instruction: 'Fixture', priority: 'Normal', createdAt: '2026-11-23T15:00:00Z', status: 'ASIGNADO' }
      r.recipients = ['staff-one', 'staff-two'].map((userId, i) => ({ id: `assignment-${id}-${i}`, documentId: id, dispatchId: r.id,
        userId, functionalRole: 'especialista', dependency, senderUserId: r.senderUserId, senderRole: r.senderRole, senderDependency: dependency,
        originAssignmentId: null, instruction: r.instruction, createdAt: r.createdAt, status }))
      e.dispatches.push(r); e.history.push({ id: `event-${id}`, action: 'DISPATCH_CREATED', actorUserId: r.senderUserId, at: r.createdAt,
        dispatchId: r.id, assignmentIds: r.recipients.map(a => a.id) })
    }
    nodes.set(id, { id, name: `${id}.pdf`, nodeType: 'cm:content', isFile: true, parentId: 'other-primary-emitted',
      content: { mimeType: 'application/pdf' }, properties: { 'cm:title': `Asunto ${id}`, 'gd:asignaciones': JSON.stringify(e) } })
    for (const f of memberships) folders.get(f).push(id)
    return e
  }
  const state = { deny: null, failPage: false, uncertain: false, closed: false }
  async function fetch(url, options) {
    const u = new URL(url); assert.equal(u.hostname, 'closure-inbox.invalid'); assert.equal(options.method, 'GET')
    assert.equal(options.headers.Authorization, session.authorization); calls.push(u.pathname)
    const auth = identityResponse(url, options, actors, settings.groupMappings); if (auth) return auth
    const parts = u.pathname.split('/'), child = parts.at(-1) === 'children', id = child ? parts.at(-2) : parts.at(-1)
    if (state.deny === id) return Response.json({}, { status: 403 })
    if (!child) return Response.json({ entry: nodes.get(id) })
    const skip = Number(u.searchParams.get('skipCount')), all = folders.get(id) || []
    if (state.failPage && skip > 0) throw new Error('simulated timeout')
    const entries = all.slice(skip, skip + 1).map(id => ({ entry: { id, association: { assocType: 'cm:contains', isPrimary: false } } }))
    return Response.json({ list: { entries, pagination: { skipCount: skip, count: entries.length, totalItems: all.length, hasMoreItems: skip + entries.length < all.length } } })
  }
  const evaluate = async id => {
    evaluated.push(id)
    if (state.uncertain) throw new Error('CLOSURE_RESULT_UNCERTAIN')
    const envelope = JSON.parse(nodes.get(id).properties['gd:asignaciones'])
    return { evaluation: evaluateClosure({ envelope, scope: { type: 'dependency', dependency: person.dependency.toLowerCase() },
      evidence: { originalRead: true, institutionalScope: true, projections: true }, evaluatedAt: '2026-11-23T16:00:00Z' }),
    sourcePropertiesHash: evidenceHash(state.staleSnapshot ? { changed: true } : nodes.get(id).properties),
    writesEnabled: false, canClose: false, closed: state.closed,
    ...(state.closed ? { closedAt: '2026-11-23T16:00:00Z', closedBy: 'direction-fixture', closureProcessId: 'closure-fixture',
      closureReceipt: { schemaVersion: 2, executionMode: 'ALFRESCO', documentId: id, dependency: person.dependency.toLowerCase(),
        at: '2026-11-23T16:00:00Z', actorUserId: 'direction-fixture', processId: 'closure-fixture', operationId: 'operation-fixture' } } : {}) }
  }
  return { settings, session, person, nodes, folders, calls, evaluated, add, state, fetch, evaluate,
    read: () => listClosureInbox(settings, session, evaluate, fetch) }
}

test('discovers attended and pending interventions, never bare Emitidos; deduplicates secondary UUIDs', async () => {
  const f = fixture(); f.add('attended', ['dsa-attention', 'dsa-knowledge']); f.add('pending', undefined, 'ASIGNADO')
  f.add('bare-emitted', ['dsa-emitted'], null)
  const r = await f.read()
  assert.equal(r.source, 'alfresco'); assert.equal(r.documents.length, 2); assert.equal(f.evaluated.length, 2)
  const a = r.documents.find(d => d.id === 'attended').closure
  assert.equal(a.compliance, 'MET'); assert.equal(a.evaluation.summary.attended, 2)
  assert.equal(a.canClose, false); assert.equal(a.responsibleUserIds.length, 2)
  assert.equal(a.category, 'APTAS'); assert.deepEqual(r.counts, { APTAS: 1, PENDIENTES: 1, CERRADAS: 0 })
  assert.equal(r.documents.find(d => d.id === 'pending').closure.compliance, 'BLOCKED')
})
test('unclassified received document stays indeterminate; knowledge folder never proves exclusivity', async () => {
  const f = fixture(); f.add('unclassified', ['dsa-knowledge'], null)
  const r = await f.read(); assert.equal(r.documents[0].closure.compliance, 'INDETERMINATE')
  assert.ok(r.documents[0].closure.evaluation.blockingReasons.includes('NO_CLASSIFIED_OBLIGATIONS'))
})
test('shared UUID has an independent DSA and DTI intervention key and obligations', async () => {
  const f = fixture(); const e = f.add('shared', ['dsa-attention', 'dti-attention'])
  const other = f.add('template', [], 'ASIGNADO', 'dti')
  for (const r of other.dispatches) {
    r.documentId = e.documentId
    for (const a of r.recipients) a.documentId = e.documentId
  }
  e.dispatches.push(...other.dispatches); e.history.push(...other.history)
  f.nodes.get('shared').properties['gd:asignaciones'] = JSON.stringify(e)
  assert.equal((await f.read()).documents[0].closure.key, 'shared:dsa')
  f.person.dependency = 'DTI'; f.session.dependency = 'DTI'
  const dti = (await f.read()).documents[0].closure
  assert.equal(dti.key, 'shared:dti'); assert.equal(dti.compliance, 'BLOCKED')
})
test('closed intervention is distinguishable and never re-enabled', async () => {
  const f = fixture(); f.add('closed'); f.state.closed = true
  const r = await f.read(); assert.equal(r.documents[0].closure.closed, true); assert.equal(r.documents[0].closure.canClose, false)
  assert.equal(r.documents[0].closure.category, 'CERRADAS')
})
test('evaluation timeout becomes explicit indeterminate row, not success or empty inbox', async () => {
  const f = fixture(); f.add('uncertain'); f.state.uncertain = true
  const r = await f.read(); assert.equal(r.documents[0].closure.compliance, 'INDETERMINATE')
  assert.ok(r.documents[0].closure.evaluation.blockingReasons.includes('CLOSURE_RESULT_UNCERTAIN'))
  assert.equal(r.counts, null); assert.equal(r.complete, false)
})
test('attended obligations, simulation, response existence and pending operations cannot fabricate a real closure', () => {
  const met = { closed: false, evaluation: { documentId: 'original', scope: { dependency: 'dsa' }, preliminaryCompliance: 'MET',
    blockingReasons: [], knowledgeSummary: { exclusivelyKnowledge: false } } }
  assert.equal(closureCategory(met), 'APTAS')
  assert.equal(closureCategory({ ...met, closed: true }), 'PENDIENTES')
  const simulated = { ...met, closed: true, closedAt: 'date', closedBy: 'actor', closureProcessId: 'process',
    closureReceipt: { schemaVersion: 1, executionMode: 'SIMULATED', documentId: 'original', dependency: 'dsa', at: 'date', actorUserId: 'actor', processId: 'process', operationId: 'op' } }
  assert.equal(closureCategory(simulated), 'PENDIENTES')
  assert.equal(closureCategory({ ...met, uncertain: true }), 'PENDIENTES')
  assert.equal(closureCategory({ ...met, pendingOperation: { requestKey: 'pending' } }), 'PENDIENTES')
})
test('later page timeout rejects the entire discovery instead of a partial empty result', async () => {
  const f = fixture(); f.add('first'); f.add('second'); f.state.failPage = true
  await assert.rejects(f.read(), /CLOSURE_INBOX_UNAVAILABLE/)
})
test('denied node produces a partial warning without displaying its metadata', async () => {
  const f = fixture(); f.add('denied'); f.state.deny = 'denied'
  const r = await f.read(); assert.equal(r.documents.length, 0); assert.equal(r.complete, false); assert.equal(r.documentErrors.length, 1)
})
test('non-Direction and revoked session are rejected before document enumeration', async () => {
  const f = fixture(); f.person.functionalRole = 'especialista'; f.session.functionalRole = 'especialista'
  await assert.rejects(f.read(), /CLOSURE_DIRECTION_REQUIRED/)
  f.session.functionalRole = 'direccion'
  await assert.rejects(f.read(), /INSTITUTIONAL_IDENTITY_REJECTED/)
  assert.ok(!f.calls.some(p => p.includes('/nodes/')))
})
test('malformed assignments remain indeterminate and cannot activate close', async () => {
  const f = fixture(); f.add('bad'); f.nodes.get('bad').properties['gd:asignaciones'] = '{'
  const r = await f.read(); assert.equal(r.documents[0].closure.compliance, 'INDETERMINATE'); assert.equal(r.documents[0].closure.canClose, false)
})
test('changed metadata or assignments between enumeration and evaluation cannot certify complete counts', async () => {
  const f = fixture(); f.add('changed'); f.state.staleSnapshot = true
  const r = await f.read()
  assert.equal(r.documents[0].closure.compliance, 'INDETERMINATE')
  assert.equal(r.documents[0].closure.category, 'PENDIENTES')
  assert.ok(r.documents[0].closure.evaluation.blockingReasons.includes('CLOSURE_STALE_EVALUATION'))
  assert.equal(r.counts, null); assert.equal(r.complete, false)
})
