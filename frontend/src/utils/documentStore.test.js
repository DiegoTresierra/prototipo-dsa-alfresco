import test from 'node:test'
import assert from 'node:assert/strict'
import { recordAlfrescoConfirmedDocument, loadAlfrescoConfirmedDocuments, CONFIRMED_STORAGE_KEY } from './documentStore.js'

test('local confirmation cache never allocates or changes a repository number, including retries and legacy cache', () => {
  const previousWindow = globalThis.window
  const storage = new Map()
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } }
  try {
    const legacy = JSON.stringify({ documents: [{ id: 'legacy', originalConsecutive: '9999', documentNumber: 'invented' }] })
    storage.set(CONFIRMED_STORAGE_KEY, legacy)
    assert.equal(loadAlfrescoConfirmedDocuments()[0].originalConsecutive, '')
    assert.equal(storage.get(CONFIRMED_STORAGE_KEY), legacy, 'read does not destroy legacy cache evidence')
    const data = { issuerCode: 'fake-code', originalConsecutive: '555', documentYear: 2030 }
    const entry = { id: 'confirmed', properties: { 'gd:numero': '2', 'gd:codigoDocumental': 'DTI-UPSI', 'gd:cicloDocumental': 2026 } }
    const first = recordAlfrescoConfirmedDocument(data, entry)
    assert.equal(first.document.originalConsecutive, '2')
    assert.equal(first.document.issuerCode, 'DTI-UPSI')
    assert.equal(first.document.documentYear, 2026)
    assert.equal(first.document.documentNumber, '')
    const repeat = recordAlfrescoConfirmedDocument({ ...data, originalConsecutive: '888' }, entry)
    assert.equal(repeat.duplicate, true)
    assert.equal(repeat.document.originalConsecutive, '2')
    const unnumbered = recordAlfrescoConfirmedDocument(data, { id: 'unnumbered', properties: {} })
    assert.equal(unnumbered.document.originalConsecutive, '')
    assert.equal(unnumbered.document.numberingSource, 'unregistered')
    assert.throws(() => recordAlfrescoConfirmedDocument(data, { ...entry, properties: { 'gd:numero': 'TEST-MF-001' } }), /RECONCILIATION_REQUIRED/)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
