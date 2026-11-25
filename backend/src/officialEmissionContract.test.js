import test from 'node:test'
import assert from 'node:assert/strict'
import { assertEmissionModel, encodeEmissionMetadata, decodeEmissionMetadata, proposedEmissionProperties } from './officialEmissionContract.js'
import { createInstitutionalEmissionReader, createAlfrescoNumberedIssuer } from './alfrescoNumbering.js'
import { isForbiddenRetentionMutation } from './emittedRetentionPolicy.js'

const record = { documentId: 'pdf', documentCode: 'DTI-UNIT', cycle: 2026, number: 12, actorId: 'issuer', requestKey: 'request', payloadHash: 'a'.repeat(64) }
const node = (value) => ({ id: value.documentId, nodeType: 'cm:content', isFile: true, content: { mimeType: 'application/pdf' }, properties: {
  ...encodeEmissionMetadata(value), 'gd:estado': 'ANULADO',
} })
const modelProperties = Object.fromEntries(Object.entries(proposedEmissionProperties).map(([key, id]) => [id, {
  dataType: key === 'cycle' ? 'd:int' : 'd:text', multiValued: false,
}]))

test('proposed contract is round-trippable, stores canonical decimal text, includes cancelled number', () => {
  assert.deepEqual(decodeEmissionMetadata(node(record)), record)
  assert.equal(encodeEmissionMetadata(record)['gd:numero'], '12')
  assert.throws(() => decodeEmissionMetadata({ ...node(record), properties: { 'gd:numero': 'DTI-12' } }), /RECONCILIATION_REQUIRED/)
  assert.throws(() => encodeEmissionMetadata({ ...record, number: '12' }), /METADATA_REQUIRED/)
  assert.throws(() => encodeEmissionMetadata({ ...record, payloadHash: '' }), /METADATA_REQUIRED/)
})

test('missing or incompatible proposed model blocks read adapter before issuing', async () => {
  assert.throws(() => assertEmissionModel({}), /METADATA_REQUIRED/)
  assertEmissionModel(modelProperties)
  const reader = createInstitutionalEmissionReader({ folderId: 'emitted', modelProperties: {}, get: () => { throw new Error('must not call') } })
  await assert.rejects(reader.list(record), /METADATA_REQUIRED/)
})

test('incompatible DEV numbers block reconciliation without parsing suffixes or coercing types', () => {
  for (const value of ['TEST-MF-001', 'TEST-SERVICIO-001', '0001', '1x', '1.5', '1e2', ' 1', '0', '-1', '9007199254740992', 1, null]) {
    const existing = { ...node(record), properties: { ...node(record).properties, 'gd:numero': value } }
    assert.throws(() => decodeEmissionMetadata(existing), /RECONCILIATION_REQUIRED/)
    assert.equal(existing.properties['gd:numero'], value)
  }
  assert.equal(decodeEmissionMetadata({ ...node(record), properties: { ...node(record).properties, 'gd:numero': '15' } }).number, 15)
})

test('institutional reader filters exact full code and cycle, verifies metadata and membership by GET', async () => {
  const others = [{ ...record, documentId: 'another-code', documentCode: 'DTI', number: 100 },
    { ...record, documentId: 'another-cycle', cycle: 2025, number: 200 }]
  const documents = [record, ...others]
  const reader = createInstitutionalEmissionReader({ folderId: 'emitted', modelProperties, get: async (path) => {
    if (path.includes('/children?')) return { list: { entries: documents.map((r) => ({ entry: { id: r.documentId, association: { assocType: 'cm:contains' } } })),
      pagination: { totalItems: 3, skipCount: 0, count: 3, hasMoreItems: false } } }
    if (path.startsWith('/nodes/emitted?')) return { entry: { id: 'emitted', isFolder: true } }
    return { entry: node(documents.find((r) => path.startsWith(`/nodes/${r.documentId}?`))) }
  } })
  assert.deepEqual(await reader.list(record), [record])
  assert.deepEqual(await reader.verify(record), record)
  await assert.rejects(reader.verify({ ...record, number: 13 }), /EMISSION_MISMATCH/)
})

test('proxy prohibits delete, metadata mutation, move, copy and association removal; preserves read and distribution additions', () => {
  const base = '/api/-default-/public/alfresco/versions/1/nodes/pdf'
  for (const [method, path] of [['DELETE', base], ['DELETE', `${base}/children/child`], ['DELETE', `${base}/secondary-children/child`],
    ['PUT', base], ['PATCH', base], ['POST', `${base}/move`], ['POST', `${base}/copy`]]) {
    assert.equal(isForbiddenRetentionMutation({ method, path }), true)
  }
  assert.equal(isForbiddenRetentionMutation({ method: 'GET', path: base }), false)
  assert.equal(isForbiddenRetentionMutation({ method: 'POST', path: `${base}/secondary-children` }), false)
})

test('full reader/issuer path computes numeric maximum from text gd:numero and stores only canonical text', async () => {
  const documents = [9, 10, 2].map((number) => ({ ...record, documentId: `pdf-${number}`, number }))
  const reader = createInstitutionalEmissionReader({ folderId: 'emitted', modelProperties, get: async (path) => {
    if (path.includes('/children?')) return { list: { entries: documents.map((r) => ({ entry: { id: r.documentId, association: { assocType: 'cm:contains' } } })),
      pagination: { totalItems: documents.length, skipCount: 0, count: documents.length, hasMoreItems: false } } }
    if (path.startsWith('/nodes/emitted?')) return { entry: { id: 'emitted', isFolder: true } }
    return { entry: node(documents.find((r) => path.startsWith(`/nodes/${r.documentId}?`))) }
  } })
  const issue = createAlfrescoNumberedIssuer({ ...reader, assertReady: async () => {},
    reconcile: async () => ({ state: 'absent' }),
    emit: async (allocation) => {
      const emitted = { ...record, ...allocation, documentId: 'next-pdf' }
      const properties = encodeEmissionMetadata(emitted)
      assert.equal(properties['gd:numero'], '11')
      assert.equal(Object.keys(properties).length, 4)
      documents.push(emitted)
      return emitted
    },
  })
  assert.equal((await issue({ documentCode: record.documentCode, requestKey: 'new', now: new Date('2026-11-18T12:00:00Z') })).number, 11)
})

test('known other code/cycle records cannot block a valid sequence; unclassified or same-scope invalid records do', async () => {
  const documents = [node(record),
    { ...node({ ...record, documentId: 'other-code', documentCode: 'DTI-OTHER' }), properties: { 'gd:codigoDocumental': 'DTI-OTHER', 'gd:cicloDocumental': 2026, 'gd:numero': 'LEGACY' } },
    { ...node({ ...record, documentId: 'other-cycle' }), properties: { 'gd:codigoDocumental': record.documentCode, 'gd:cicloDocumental': 2025, 'gd:numero': 'LEGACY' } }]
  const reader = createInstitutionalEmissionReader({ folderId: 'emitted', modelProperties, get: async (path) => {
    if (path.includes('/children?')) return { list: { entries: documents.map((n) => ({ entry: { id: n.id, association: { assocType: 'cm:contains' } } })),
      pagination: { totalItems: documents.length, skipCount: 0, count: documents.length, hasMoreItems: false } } }
    if (path.startsWith('/nodes/emitted?')) return { entry: { id: 'emitted', isFolder: true } }
    return { entry: documents.find((n) => path.startsWith(`/nodes/${n.id}?`)) }
  } })
  assert.deepEqual(await reader.list(record), [record])
  documents.push({ id: 'unknown', isFile: true, properties: { 'gd:numero': 'TEST' } })
  await assert.rejects(reader.list(record), /RECONCILIATION_REQUIRED/)
  documents[3].properties['gd:codigoDocumental'] = record.documentCode
  documents[3].properties['gd:cicloDocumental'] = record.cycle
  await assert.rejects(reader.list(record), /RECONCILIATION_REQUIRED/)
})
