import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDocumentIssuer } from './documentIssuer.js'
import { officialFixture } from './testFixtures/officialEmission.js'
import { validateAttentionInput } from './attentionPolicy.js'
const unitId = '00000000-0000-4000-8000-000000000099'
function configure(f, role) {
  f.conditions.actorRole = role
  const actor = { ...f.session('DTI', 'author-fixture'), functionalRole: role }
  f.settings.documentIssuerAssignments = { 'author-fixture': { unitId, documentCode: role === 'especialista' ? 'DTI-UNIT-AA' : 'DTI-UNIT', signatoryCode: 'AA' } }
  f.nodes.set(unitId, { id: unitId, nodeType: 'gdo:unidad', properties: { 'gdo:codigoDependencia': 'DTI', 'gdo:codigoUnidad': 'UNIT', 'gdo:estadoUnidad': 'ACTIVA' } })
  f.nodes.set('membership-fixture', { id: 'membership-fixture', nodeType: 'gdo:asignacion', properties: { 'gdo:idUsuario': 'author-fixture', 'gdo:idUnidad': unitId,
    'gdo:rolAsignacion': role, 'gdo:dependenciaAsignacion': 'DTI', 'gdo:estadoAsignacion': 'ACTIVA' } })
  f.children.set(unitId, ['membership-fixture'])
  return actor
}
for (const role of ['jefe-unidad', 'especialista']) test(`${role} issues one numbered own PDF without recipient, reception or ACL mutation`, async t => {
  const f = officialFixture(t), actor = configure(f, role)
  const request = { ...f.input('own-emission'), recipientDependency: '', receiptCategory: '' }
  const first = await f.service.issue(actor, request)
  assert.equal(first.receivedEntry, null); assert.equal(first.distributed, false)
  assert.equal(first.emittedEntry.properties['gd:numero'], '1')
  assert.equal(first.emittedEntry.properties['gd:codigoDocumental'], f.settings.documentIssuerAssignments['author-fixture'].documentCode)
  assert.equal(first.emittedEntry.properties['gd:dependenciaOrigen'], 'DTI')
  assert.ok(!first.emittedEntry.properties['gd:dependenciaDestino'])
  assert.equal(first.emittedEntry.properties['gd:asignaciones'], undefined)
  assert.equal(f.children.get('DSA-attention').length, 0)
  assert.ok(!f.calls.some(c => c.path.endsWith('/secondary-children')))
  f.restart()
  const repeat = await f.service.issue(actor, request)
  assert.equal(repeat.emittedEntry.id, first.emittedEntry.id)
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})
test('same shared issuer keeps direction, unit and personal sequences independent', async t => {
  const f = officialFixture(t)
  const own = { ...f.input('own'), recipientDependency: '', receiptCategory: '' }
  const d = await f.service.issue(f.session('DTI'), { ...own, requestKey: 'direction' })
  const head = configure(f, 'jefe-unidad'), h = await f.service.issue(head, { ...own, requestKey: 'head' })
  const specialist = configure(f, 'especialista'), s = await f.service.issue(specialist, { ...own, requestKey: 'specialist' })
  assert.deepEqual([d, h, s].map(r => r.emittedEntry.properties['gd:numero']), ['1', '1', '1'])
  assert.deepEqual([d, h, s].map(r => r.emittedEntry.properties['gd:codigoDocumental']), ['DTI', 'DTI-UNIT', 'DTI-UNIT-AA'])
})
test('missing configuration, inactive relation, foreign unit and duplicate personal code fail before PDF creation', async t => {
  for (const kind of ['missing', 'inactive', 'foreign', 'duplicate']) {
    const f = officialFixture(t), actor = configure(f, 'especialista')
    if (kind === 'missing') f.settings.documentIssuerAssignments = {}
    if (kind === 'inactive') f.nodes.get('membership-fixture').properties['gdo:estadoAsignacion'] = 'INACTIVA'
    if (kind === 'foreign') f.nodes.get(unitId).properties['gdo:codigoDependencia'] = 'DSA'
    if (kind === 'duplicate') f.settings.documentIssuerAssignments.other = { ...f.settings.documentIssuerAssignments['author-fixture'] }
    await assert.rejects(f.service.issue(actor, { ...f.input(kind), recipientDependency: '', receiptCategory: '' }), /DOCUMENT_ISSUER_/)
    assert.ok(!f.calls.some(c => c.method === 'POST'))
  }
})
test('own emission is not permission to distribute or bypass Direction review', async t => {
  const f = officialFixture(t), actor = configure(f, 'especialista')
  await assert.rejects(f.service.issue(actor, f.input('distributed', 'DTI')), /DOCUMENT_DISTRIBUTION_AUTHORITY_PENDING/)
  assert.ok(!f.calls.some(c => c.method === 'POST'))
})
test('GET-based code resolver rejects incomplete unit pagination and never infers personal initials', async () => {
  const identity = { dependency: 'DTI', functionalRole: 'especialista', person: { id: 'person-fixture', firstName: 'Ignored Name' } }
  const settings = { documentIssuerAssignments: { 'person-fixture': { unitId, documentCode: 'DTI-UNIT-AA', signatoryCode: 'AA' } } }
  const get = async path => path.includes('/children') ? { list: { entries: [], pagination: { count: 0, skipCount: 0, totalItems: 1, hasMoreItems: true } } } :
    { entry: { id: unitId, nodeType: 'gdo:unidad', properties: { 'gdo:estadoUnidad': 'ACTIVA', 'gdo:codigoUnidad': 'UNIT', 'gdo:codigoDependencia': 'DTI' } } }
  await assert.rejects(resolveDocumentIssuer(settings, identity, get), /UNIT_NOT_VERIFIED/)
  delete settings.documentIssuerAssignments['person-fixture'].signatoryCode
  await assert.rejects(resolveDocumentIssuer(settings, identity, get), /CODE_CONFLICT/)
})
test('annex and antecedent cannot be relabeled as a response by the existing API', () => {
  for (const relationType of ['annex', 'antecedent']) assert.throws(() => validateAttentionInput({ relationType }), /DOCUMENT_RELATION_TYPE_NOT_SUPPORTED/)
})
test('technical emission identity must be explicitly non-administrative before any PDF creation', async t => {
  for (const capability of [true, undefined]) {
    const f = officialFixture(t)
    f.conditions.adminService = capability === true
    f.conditions.missingServiceCapabilities = capability === undefined
    await assert.rejects(f.service.issue(f.session(), f.input()), /SERVICE_IDENTITY_REJECTED/)
    assert.ok(!f.calls.some(c => c.method === 'POST'))
  }
})
test('own emission timeout reconciles the same UUID and simultaneous retries do not allocate another PDF', async t => {
  const f = officialFixture(t), actor = configure(f, 'especialista')
  const request = { ...f.input('own-timeout'), recipientDependency: '', receiptCategory: '' }
  f.conditions.timeoutAfterCreate = true
  await assert.rejects(f.service.issue(actor, request))
  // An uncertain live issuer deliberately retains its lease. Reconcile it first;
  // never remove a writer lock to make a simulated restart pass.
  const [a, b] = await Promise.all([f.service.issue(actor, request), f.service.issue(actor, request)])
  assert.equal(a.emittedEntry.id, b.emittedEntry.id)
  assert.equal(a.emittedEntry.properties['gd:numero'], '1')
  f.restart()
  assert.equal((await f.service.issue(actor, request)).emittedEntry.id, a.emittedEntry.id)
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})
