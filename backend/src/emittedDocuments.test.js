import test from 'node:test'
import assert from 'node:assert/strict'
import { listInstitutionalEmitted } from './emittedDocuments.js'
import { emittedFixture } from './testFixtures/emitted.js'

test('institutional originals include all creators and historical numbers; secondary distribution and dispatch never change origin/UUID', async () => {
  const f = emittedFixture()
  const before = JSON.stringify([...f.nodes])
  const dti = await listInstitutionalEmitted(f.settings, f.session('DTI'), f.fetch)
  assert.deepEqual(dti.documents.map((n) => n.id), ['dti-original', 'dti-legacy', 'dti-unit'])
  assert.equal(dti.documents[1].emittedOrigin.evidence, 'institutional-primary-folder')
  assert.equal(dti.documents[1].documentIdentity.originalDependency, null)
  assert.equal(dti.documents[1].contentWarning, 'EMPTY_PDF_CONTENT')
  assert.equal(dti.documents[0].createdByUser.id, 'fixture_director_b')
  assert.equal(dti.documents[0].emittedOrigin.dependency, 'DTI')
  const dsa = await listInstitutionalEmitted(f.settings, f.session('DSA'), f.fetch)
  assert.deepEqual(dsa.documents.map((n) => n.id), ['dsa-original'])
  assert.equal(dsa.documents[0].emittedOrigin.evidence, 'gd:codigoDocumental')
  assert.equal(dsa.documents[0].documentIdentity.originalDependency, 'DSA')
  assert.equal(JSON.stringify([...f.nodes]), before)
  assert.ok(f.calls.every((c) => c.method === 'GET' && c.authorization.startsWith('actor-')))
  assert.ok(f.calls.some((c) => c.query.includes('skipCount=2')))
})

test('Alfresco ACL rejects root access and individual denials are visible partial results; no technical fallback', async () => {
  const f = emittedFixture()
  f.denied.add('dti-root')
  await assert.rejects(listInstitutionalEmitted(f.settings, f.session('DTI'), f.fetch), { status: 403 })
  f.denied.clear(); f.denied.add('dti-legacy')
  const snapshot = await listInstitutionalEmitted(f.settings, f.session('DTI'), f.fetch)
  assert.equal(snapshot.documents.length, 2)
  assert.equal(snapshot.documentErrors[0].documentId, 'dti-legacy')
  assert.equal(snapshot.documentErrors[0].status, 403)
  assert.equal((await listInstitutionalEmitted(f.settings, f.session('DTI', 'jefe-unidad'), f.fetch)).documents.length, 0)
})

for (const role of ['jefe-unidad', 'especialista']) test(`${role} sees own originals only, without recipient or provisional unit authority`, async () => {
  const f = emittedFixture(), session = f.session('DTI', role)
  f.nodes.get('dti-unit').createdByUser.id = session.alfresco.id
  f.children.get('dti-root').push('dti-unit')
  const r = await listInstitutionalEmitted(f.settings, session, f.fetch)
  assert.deepEqual(r.documents.map(n => n.id), ['dti-unit'])
  assert.equal(r.accessScope, 'own'); assert.equal(r.scopeNotice, 'UNIT_COMPETENCE_NOT_VERIFIED_OWN_ONLY')
  assert.equal(r.documents[0].properties['gd:destinatario'], undefined)
  f.denied.add('dti-unit')
  const denied = await listInstitutionalEmitted(f.settings, session, f.fetch)
  assert.equal(denied.documents.length, 0); assert.equal(denied.documentErrors.length, 1)
})

test('a later page failure is never returned as an empty successful Emitidos list', async () => {
  const f = emittedFixture()
  await assert.rejects(listInstitutionalEmitted(f.settings, f.session('DTI'), (url, options) =>
    url.includes('skipCount=2') ? Response.json({}, { status: 503 }) : f.fetch(url, options)), /EMITTED_REPOSITORY_READ_REJECTED/)
})

test('conflicting declared origin is reported and never rewritten or assigned to the dispatcher', async () => {
  const f = emittedFixture()
  f.nodes.get('dti-original').properties['gd:dependenciaOrigen'] = 'DSA'
  const snapshot = await listInstitutionalEmitted(f.settings, f.session('DTI'), f.fetch)
  assert.equal(snapshot.documents.some((n) => n.id === 'dti-original'), false)
  assert.equal(snapshot.documentErrors[0].error, 'EMITTED_ORIGIN_CONFLICT')
  assert.equal(f.nodes.get('dti-original').properties['gd:dependenciaOrigen'], 'DSA')
})

test('verified membership plus declared original origin is sufficient even when primary parent differs', async () => {
  const f = emittedFixture()
  f.nodes.get('dti-original').parentId = 'another-primary'
  const snapshot = await listInstitutionalEmitted(f.settings, f.session('DTI'), f.fetch)
  assert.equal(snapshot.documents.some((n) => n.id === 'dti-original'), true)
  f.nodes.get('dti-original').properties = { 'gd:asignaciones': 'dispatcher-is-not-origin' }
  const unknown = await listInstitutionalEmitted(f.settings, f.session('DTI'), f.fetch)
  assert.equal(unknown.documents.some((n) => n.id === 'dti-original'), false)
})
