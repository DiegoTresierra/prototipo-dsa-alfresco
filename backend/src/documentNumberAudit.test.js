import test from 'node:test'
import assert from 'node:assert/strict'
import { auditDocumentNumbers } from './documentNumberAudit.js'

test('audit deduplicates secondary links and separates numeric text from actual DEV identifiers without interpreting suffixes', async () => {
  const nodes = {
    a: { 'gd:numero': 'TEST-MF-001' }, b: { 'gd:numero': 'TEST-SERVICIO-001' },
    c: {}, d: { 'gd:numero': '0001' },
  }
  const result = await auditDocumentNumbers({ rootIds: ['folder', 'a'], get: async (path) => {
    if (path.includes('/children?')) return { list: { entries: Object.keys(nodes).map((id) => ({ entry: { id, association: { assocType: 'cm:contains' } } })),
      pagination: { skipCount: 0, count: 4, totalItems: 4, hasMoreItems: false } } }
    const id = path.split('/')[2].split('?')[0]
    return { entry: id === 'folder' ? { id, isFolder: true } : { id, isFile: true, properties: nodes[id] } }
  } })
  assert.equal(result.uniqueDocuments, 4)
  assert.equal(result.withoutNumero, 1)
  assert.deepEqual(result.values.map((item) => item.classification), ['textual-identifier', 'textual-identifier', 'numeric-text'])
  assert.deepEqual(result.values.map((item) => item.value), ['TEST-MF-001', 'TEST-SERVICIO-001', '0001'])
})
