const CONFIRMED_STORAGE_KEY = 'gestion-documental-dsa.alfresco-confirmed-documents.v1'

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
    originalConsecutive: document.originalConsecutive,
    documentNumber: document.documentNumber,
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
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    window.localStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(normalized))
  }
  return normalized
}

export function loadAlfrescoConfirmedDocuments() {
  return readConfirmedStore().documents
}

function consecutiveFor(document, issuerCode, documentType, documentYear) {
  if (document.issuerCode !== issuerCode || document.documentType !== documentType || String(document.documentYear) !== String(documentYear)) return 0
  const number = Number.parseInt(document.originalConsecutive, 10)
  return Number.isFinite(number) ? number : 0
}

function formatConsecutive(number) {
  return String(number).padStart(4, '0')
}

export function getCorrelativeStatus(issuerCode, documentType, documentYear) {
  if (!issuerCode || !documentType || !documentYear) return { last: '', next: '' }
  const lastNumber = readConfirmedStore().documents.reduce((maximum, document) => Math.max(maximum, consecutiveFor(document, issuerCode, documentType, documentYear)), 0)
  return { last: formatConsecutive(lastNumber), next: formatConsecutive(lastNumber + 1) }
}

export function recordAlfrescoConfirmedDocument(documentData, entry) {
  if (!entry?.id) throw new Error('Se requiere el identificador confirmado por Alfresco.')

  const store = readConfirmedStore()
  const existingDocument = store.documents.find((document) => document.id === entry.id)
  if (existingDocument) return { document: existingDocument, documents: store.documents, duplicate: true }

  const issuerCode = documentData.issuerCode || documentData.issuingAcronym
  const lastNumber = store.documents.reduce((maximum, document) => Math.max(maximum, consecutiveFor(document, issuerCode, documentData.documentType, documentData.documentYear)), 0)
  const requestedNumber = Number.parseInt(documentData.originalConsecutive, 10)
  const originalConsecutive = formatConsecutive(Math.max(lastNumber + 1, Number.isFinite(requestedNumber) ? requestedNumber : 0))
  const documentNumber = `${String(documentData.documentType || '').toLocaleUpperCase('es')} N.° ${originalConsecutive}-${documentData.documentYear}-${issuerCode}`
  const properties = entry.properties || {}
  const document = {
    ...documentData,
    id: entry.id,
    source: 'alfresco',
    issuerCode,
    originalConsecutive,
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
  const nextStore = { documents: [document, ...store.documents] }
  window.localStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(nextStore))
  return { document, documents: nextStore.documents, duplicate: false }
}
