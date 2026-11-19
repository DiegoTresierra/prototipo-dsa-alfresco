export const CONFIRMED_STORAGE_KEY = 'gestion-documental-dsa.alfresco-confirmed-documents.v1'

function keepAlfrescoFields(document) {
  return {
    id: document.id,
    source: 'alfresco',
    recipientUserId: document.recipientUserId,
    recipientName: document.recipientName,
    recipientRole: document.recipientRole,
    recipientUnit: document.recipientUnit,
    recipientPositionId: document.recipientPositionId,
    recipientDependencyId: document.recipientDependencyId,
    recipientInboxNodeId: document.recipientInboxNodeId,
    recipientNodeId: document.recipientNodeId,
    receiptCategory: document.receiptCategory,
    senderUserId: document.senderUserId,
    sender: document.sender,
    subject: document.subject,
    description: document.description,
    documentType: document.documentType,
    documentPeriod: document.documentPeriod,
    originalConsecutive: document.numberingSource === 'alfresco-metadata' ? document.originalConsecutive : '',
    documentNumber: '',
    numberingSource: document.numberingSource || 'unregistered',
    documentYear: document.documentYear,
    issuerCode: document.issuerCode,
    issuingAcronym: document.issuingAcronym,
    issuerUnitAcronym: document.issuerUnitAcronym,
    senderPosition: document.senderPosition,
    originatingDependency: document.originatingDependency,
    originatingUnit: document.originatingUnit,
    priority: document.priority,
    attachmentName: document.attachmentName,
    attachmentType: document.attachmentType,
    attachmentSize: document.attachmentSize,
    status: 'Creado en Alfresco',
    emissionDate: document.emissionDate,
    createdAt: document.createdAt,
  }
}

function readConfirmedStore() {
  const storedValue = window.localStorage.getItem(CONFIRMED_STORAGE_KEY)
  if (storedValue === null) return { documents: [] }

  const parsed = JSON.parse(storedValue)
  if (!parsed || !Array.isArray(parsed.documents)) {
    throw new Error('El registro local de confirmaciones de Alfresco no tiene un formato válido.')
  }
  const documents = parsed.documents.filter((document) => document?.id).map(keepAlfrescoFields)
  const normalized = { documents }
  return normalized
}

export function loadAlfrescoConfirmedDocuments() {
  return readConfirmedStore().documents
}

export function recordAlfrescoConfirmedDocument(documentData, entry) {
  if (!entry?.id) throw new Error('Se requiere el identificador confirmado por Alfresco.')

  const store = readConfirmedStore()
  const existingDocument = store.documents.find((document) => document.id === entry.id)

  const properties = entry.properties || {}
  const rawNumber = properties['gd:numero']
  if (rawNumber !== undefined && (typeof rawNumber !== 'string' || !/^[1-9][0-9]*$/.test(rawNumber) || !Number.isSafeInteger(Number(rawNumber)))) {
    throw new Error('OFFICIAL_NUMBER_RECONCILIATION_REQUIRED')
  }
  // This is a cache of confirmed repository metadata, never a number allocator.
  const originalConsecutive = rawNumber || ''
  const issuerCode = properties['gd:codigoDocumental'] || ''
  const documentYear = properties['gd:cicloDocumental'] || ''
  // Display format remains pending institutional approval; no composite property.
  const documentNumber = ''
  const document = {
    ...documentData,
    id: entry.id,
    source: 'alfresco',
    issuerCode,
    originalConsecutive,
    documentYear,
    numberingSource: rawNumber ? 'alfresco-metadata' : 'unregistered',
    documentNumber,
    recipientUserId: documentData.recipientUserId,
    recipientName: documentData.recipientName,
    recipientInboxNodeId: documentData.recipientInboxNodeId,
    recipientNodeId: documentData.recipientNodeId,
    receiptCategory: documentData.receiptCategory,
    senderUserId: entry.createdByUser?.id || '',
    sender: entry.createdByUser?.displayName || entry.createdByUser?.id || '',
    subject: properties['cm:title'] || entry.name || '',
    description: properties['cm:description'] || '',
    attachmentName: entry.name || documentData.attachmentName,
    attachmentType: entry.content?.mimeType || 'application/pdf',
    attachmentSize: entry.content?.sizeInBytes ?? documentData.attachmentSize,
    status: 'Creado en Alfresco',
    emissionDate: entry.createdAt || documentData.emissionDate,
    createdAt: entry.createdAt || documentData.emissionDate,
  }
  const nextStore = { documents: [document, ...store.documents.filter((item) => item.id !== entry.id)] }
  window.localStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(nextStore))
  return { document, documents: nextStore.documents, duplicate: Boolean(existingDocument) }
}
