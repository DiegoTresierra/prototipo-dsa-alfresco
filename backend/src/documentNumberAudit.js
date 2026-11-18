import { enumerateIssuedRecords } from './alfrescoNumbering.js'
import { parseOfficialNumber } from './officialEmissionContract.js'

// GET-only inventory; never parses a numeric suffix into an official sequence.
export async function auditDocumentNumbers({ rootIds, get }) {
  const values = []
  let documents = 0
  await enumerateIssuedRecords({ rootIds, get, decode(node) {
    documents++
    const value = node.properties?.['gd:numero']
    if (value !== undefined && value !== null) {
      let compatible = true
      try { parseOfficialNumber(value) } catch { compatible = false }
      values.push({ documentId: node.id, value, compatible, classification: typeof value !== 'string' ? 'unexpected-type'
        : /^[0-9]+$/.test(value) ? 'numeric-text' : value.length ? 'textual-identifier' : 'empty-text' })
    }
    return null
  } })
  return { uniqueDocuments: documents, withNumero: values.length, withoutNumero: documents - values.length, values,
    reconciliationRequired: documents !== values.length || values.some((item) => !item.compatible),
    scope: 'configured institutional folders accessible to the configured reader; not a repository-wide proof' }
}
