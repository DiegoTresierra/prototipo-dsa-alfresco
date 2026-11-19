import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReconciliation, legacyFingerprint, sha256 } from './emissionReconciliation.js'

const settings = { alfrescoTarget: 'https://dev.invalid', officeInboxNodeIds: { DTI: { emitidos: 'dti' }, DSA: { emitidos: 'dsa' } } }
const bytes = Buffer.from('unchanged legacy content')
const node = { id: 'old-test', nodeType: 'cm:content', parentId: 'dti', createdAt: '2026-01-01', createdByUser: { id: 'creator' }, properties: { 'gd:numero': 'TEST-MF-001' } }
const approved = () => ({ version: 2, fingerprintVersion: 2, target: settings.alfrescoTarget, emitidos: { DTI: 'dti', DSA: 'dsa' },
  approvedBy: 'operator', approvedAt: '2026-11-18T12:00:00Z', decisionReference: 'institutional-decision',
  exclusions: [{ documentId: node.id, contentSha256: sha256(bytes), fingerprint: legacyFingerprint(node, sha256(bytes)), reason: 'verified test document' }] })
test('v2 exclusion requires approval, exact target/roots, stable identity and content bytes', async () => {
  const filter = validateReconciliation(approved(), settings, async () => bytes)
  assert.equal(await filter(node), true)
  assert.equal(await filter({ ...node, id: 'unapproved' }), false)
  assert.throws(() => validateReconciliation({ ...approved(), approvedBy: '' }, settings), /APPROVAL_REQUIRED/)
  assert.throws(() => validateReconciliation({ ...approved(), version: 1 }, settings), /APPROVAL_REQUIRED/)
  assert.throws(() => validateReconciliation({ ...approved(), target: 'https://other.invalid' }, settings), /APPROVAL_REQUIRED/)
  for (const change of [{ properties: { 'gd:numero': 'changed' } }, { parentId: 'other' }, { createdByUser: { id: 'replacement' } }, { nodeType: 'other' }]) {
    await assert.rejects(filter({ ...node, ...change }), /RECONCILIATION_CHANGED/)
  }
  await assert.rejects(validateReconciliation(approved(), settings, async () => Buffer.from('replacement same metadata'))(node), /RECONCILIATION_CHANGED/)
  await assert.rejects(validateReconciliation(approved(), settings, async () => { throw new Error('GET403') })(node), /GET403/)
})
test('assignment, responsible users and attention state changes preserve administrative classification', async () => {
  const changed = { ...node, modifiedAt: '2026-11-18T13:00:00Z', modifiedByUser: { id: 'head' }, aspectNames: ['gd:tramite'], properties: {
    ...node.properties, 'gd:asignaciones': '{"revision":2}', 'gd:estado': 'ATENDIDO', 'gd:responsablesActuales': ['head'],
    'gd:dependenciasResponsablesActuales': ['DSA'], 'gd:responsableActual': 'head', 'cm:title': 'Updated description',
  } }
  assert.equal(await validateReconciliation(approved(), settings, async () => bytes)(changed), true)
})
test('approved historical UUID can never hide new official metadata', async () => {
  for (const key of ['gd:codigoDocumental', 'gd:cicloDocumental', 'gd:identidadEmision']) {
    const official = { ...node, properties: { ...node.properties, [key]: 'present' } }
    const manifest = approved()
    manifest.exclusions[0].fingerprint = legacyFingerprint(official, sha256(bytes))
    await assert.rejects(validateReconciliation(manifest, settings, async () => bytes)(official), /RECONCILIATION_CHANGED/)
  }
})
