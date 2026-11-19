import test from 'node:test'
import assert from 'node:assert/strict'
import { officialFixture } from './testFixtures/officialEmission.js'
import { legacyFingerprint, sha256 } from './emissionReconciliation.js'

test('real REST adapter creates PDF and metadata atomically, serializes requests, verifies GET and secondary distribution', async (t) => {
  const f = officialFixture(t)
  const results = await Promise.all(['a', 'b'].map((key) => f.service.issue(f.session('DSA', `test-director-${key}`), f.input(key))))
  assert.deepEqual(results.map((r) => r.emittedEntry.properties['gd:numero']), ['1', '2'])
  assert.deepEqual(results.map((r) => JSON.parse(r.emittedEntry.properties['gd:identidadEmision']).actorId), ['test-director-a', 'test-director-b'])
  assert.ok(results.every((r) => r.emittedEntry.id === r.receivedEntry.id))
  assert.equal(f.children.get('DTI-attention').length, 2)
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 2)
  assert.ok(f.calls.some((c) => c.method === 'GET' && c.path.endsWith('/content')))
  const other = await f.service.issue(f.session('DTI'), f.input('other', 'DTI'))
  assert.equal(other.emittedEntry.properties['gd:numero'], '1')
  assert.equal(other.emittedEntry.properties['gd:codigoDocumental'], 'DTI')
})

test('same actor/key/hash replays after restart; changed bytes or parameters conflict and previous cycle is retained', async (t) => {
  const f = officialFixture(t)
  f.clock.now = new Date('2027-01-01T20:00:00Z')
  const first = await f.service.issue(f.session(), f.input())
  f.clock.now = new Date('2027-01-02T05:00:00Z')
  f.restart()
  const repeat = await f.service.issue(f.session(), f.input())
  assert.equal(repeat.emittedEntry.id, first.emittedEntry.id)
  assert.equal(repeat.emittedEntry.properties['gd:cicloDocumental'], 2026)
  await assert.rejects(f.service.issue(f.session(), { ...f.input(), title: 'different' }), /RETRY_CONFLICT/)
  await assert.rejects(f.service.issue(f.session(), { ...f.input(), file: Buffer.from('%PDF-other') }), /RETRY_CONFLICT/)
  const next = await f.service.issue(f.session(), f.input('new-cycle'))
  assert.equal(next.emittedEntry.properties['gd:cicloDocumental'], 2027)
  assert.equal(next.emittedEntry.properties['gd:numero'], '1')
})

test('timeout after create blocks next allocation and restart until same-key reconciliation succeeds', async (t) => {
  const f = officialFixture(t)
  f.conditions.timeoutAfterCreate = true
  await assert.rejects(f.service.issue(f.session(), f.input()), (e) => e.uncertain === true)
  await assert.rejects(f.service.issue(f.session(), f.input('another')), /NUMBERING_RESULT_UNCERTAIN/)
  assert.throws(() => f.restart(), /LEASE_UNAVAILABLE/)
  const recovered = await f.service.issue(f.session(), f.input())
  assert.equal(recovered.emittedEntry.properties['gd:numero'], '1')
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
  f.restart()
})

test('actor ACL, receiving read prerequisites, role and creation denials never change ACL', async (t) => {
  const f = officialFixture(t)
  await assert.rejects(f.service.issue({ ...f.session(), functionalRole: 'jefe-unidad' }, f.input()), /DIRECTION_REQUIRED/)
  await assert.rejects(f.service.issue({ ...f.session(), functionalRole: 'especialista' }, f.input()), /DIRECTION_REQUIRED/)
  f.conditions.noRecipientRead = true
  const permitted = await f.service.issue(f.session(), f.input('node-allowed'))
  assert.equal(permitted.emittedEntry.properties['gd:numero'], '1')
  f.conditions.noRecipientRead = false
  f.conditions.createDenied = true
  await assert.rejects(f.service.issue(f.session(), f.input('creation-denied')), (e) => e.uncertain === true)
  assert.ok(f.calls.every((c) => !['PUT', 'PATCH', 'DELETE'].includes(c.method)))
})

test('legacy data blocks unless explicitly approved and fingerprinted; changes invalidate exclusion; cancelled official numbers remain used', async (t) => {
  const f = officialFixture(t)
  const legacy = { file: Buffer.from('legacy test'), id: 'legacy', nodeType: 'cm:content', isFile: true, properties: { 'gd:numero': 'TEST-MF-001' }, content: { mimeType: 'application/pdf' } }
  f.nodes.set('legacy', legacy); f.children.get('DSA-emitted').push('legacy')
  await assert.rejects(f.service.issue(f.session(), f.input()), /RECONCILIATION_REQUIRED/)
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0)
  f.manifest.exclusions.push({ documentId: 'legacy', contentSha256: sha256(legacy.file), fingerprint: legacyFingerprint(legacy, sha256(legacy.file)), reason: 'approved controlled test' })
  f.writeManifest(); f.restart()
  const first = await f.service.issue(f.session(), f.input())
  first.emittedEntry.properties['gd:estado'] = 'ANULADO'
  f.nodes.get(first.emittedEntry.id).properties['gd:estado'] = 'ANULADO'
  assert.equal((await f.service.issue(f.session(), f.input('next'))).emittedEntry.properties['gd:numero'], '2')
  legacy.properties['gd:numero'] = 'changed'
  await assert.rejects(f.service.issue(f.session(), f.input('changed-exclusion')), /RECONCILIATION_CHANGED/)
})

test('a failed GET or content mismatch is never absence and never authorizes another upload', async (t) => {
  const f = officialFixture(t)
  f.conditions.corruptContent = true
  await assert.rejects(f.service.issue(f.session(), f.input()), (e) => e.uncertain === true)
  f.conditions.corruptContent = false
  f.conditions.readDenied = true
  await assert.rejects(f.service.issue(f.session(), f.input()), /ALFRESCO_REJECTED/)
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
})

test('empty DSA sequence does not require approval for incompatible DTI histories', async (t) => {
  const f = officialFixture(t)
  f.settings.officialEmission.reconciliationPath = ''
  f.settings.officialEmission.reconciliationSha256 = ''
  f.restart()
  const legacy = { id: 'DTI-only-legacy', nodeType: 'cm:content', isFile: true, properties: { 'gd:numero': 'TEST-001' }, content: { mimeType: 'application/pdf' } }
  f.nodes.set(legacy.id, legacy); f.children.get('DTI-emitted').push(legacy.id)
  assert.equal((await f.service.issue(f.session(), f.input())).emittedEntry.properties['gd:numero'], '1')
  await assert.rejects(f.service.issue(f.session('DTI'), f.input('dti', 'DTI')), /RECONCILIATION_REQUIRED/)
})

test('missing recipient node read is an explicit partial, with no ACL write or association until manual authorization', async (t) => {
  const f = officialFixture(t)
  f.conditions.noRecipientRead = true
  f.conditions.noNodeRecipientRead = true
  await assert.rejects(f.service.issue(f.session(), f.input()), (error) => {
    assert.equal(error.message, 'OFFICIAL_RECIPIENT_NODE_READ_REQUIRED')
    assert.equal(error.emittedNodeId, 'pdf-1')
    assert.equal(error.uncertain, true)
    return true
  })
  assert.equal(f.children.get('DTI-attention').length, 0)
  assert.equal(f.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/children')).length, 1)
  // Authorized operator intervention is simulated only in repository state.
  f.nodes.get('pdf-1').permissions = { isInheritanceEnabled: true, locallySet: [{ authorityId: 'GROUP_DTI', name: 'Consumer', accessStatus: 'ALLOWED' }] }
  const recovered = await f.service.issue(f.session(), f.input())
  assert.equal(recovered.emittedEntry.id, 'pdf-1')
  assert.equal(f.children.get('DTI-attention').length, 1)
  assert.ok(f.calls.every((call) => !['PUT', 'PATCH', 'DELETE'].includes(call.method)))
  assert.equal(f.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/children')).length, 1)
})

test('secondary association denial does not bypass permissions or duplicate the PDF', async (t) => {
  const f = officialFixture(t)
  f.conditions.associationDenied = true
  await assert.rejects(f.service.issue(f.session(), f.input()), (error) => error.uncertain === true)
  assert.equal(f.children.get('DTI-attention').length, 0)
  assert.equal(f.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/children')).length, 1)
})

test('legitimate attention changes do not invalidate approved test classification during emission', async (t) => {
  const f = officialFixture(t)
  const bytes = Buffer.from('legacy test')
  const node = { id: 'test-active', nodeType: 'cm:content', isFile: true, parentId: 'DSA-emitted', file: bytes,
    properties: { 'gd:numero': 'TEST', 'gd:asignaciones': 'old revision' }, content: { mimeType: 'application/pdf' } }
  f.nodes.set(node.id, node); f.children.get('DSA-emitted').push(node.id)
  f.manifest.exclusions.push({ documentId: node.id, contentSha256: sha256(bytes), fingerprint: legacyFingerprint(node, sha256(bytes)), reason: 'approved test' })
  f.writeManifest(); f.restart()
  node.properties['gd:asignaciones'] = 'new attended revision'
  node.properties['gd:estado'] = 'ATENDIDO'
  node.modifiedAt = '2026-11-19T00:00:00Z'
  assert.equal((await f.service.issue(f.session(), f.input())).emittedEntry.properties['gd:numero'], '1')
})
