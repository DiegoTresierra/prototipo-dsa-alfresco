import { nodeToDocument } from './documentMapping.js'

// Legacy key retained only to identify old storage. Institutional summaries are
// no longer read or written there; existing browser evidence is left untouched.
export const CONFIRMED_STORAGE_KEY = 'gestion-documental-dsa.alfresco-confirmed-documents.v1'
export function loadAlfrescoConfirmedDocuments() { return [] }

export function recordAlfrescoConfirmedDocument(_documentData, entry) {
  if (!entry?.id) throw new Error('ALFRESCO_NODE_REQUIRED')
  const raw = entry.properties?.['gd:numero']
  if (raw !== undefined && (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)))) throw new Error('OFFICIAL_NUMBER_RECONCILIATION_REQUIRED')
  const document = nodeToDocument(entry)
  return { document, documents: [document], duplicate: false }
}
