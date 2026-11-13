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
    documentDate: document.documentDate,
    originatingDependency: document.originatingDependency,
    currentResponsible: document.currentResponsible,
    currentResponsibleDependency: document.currentResponsibleDependency,
    senderUserId: document.senderUserId,
    sender: document.sender,
    subject: document.subject,
    description: document.description,
    documentPeriod: document.documentPeriod,
    originalConsecutive: document.originalConsecutive,
    documentNumber: document.documentNumber,
    documentYear: document.documentYear,
    issuerCode: document.issuerCode,
    issuingAcronym: document.issuingAcronym,
    issuerUnitAcronym: document.issuerUnitAcronym,
    senderPosition: document.senderPosition,
    originatingUnit: document.originatingUnit,
    priority: document.priority,
    attachmentName: document.attachmentName,
    attachmentType: document.attachmentType,
    attachmentSize: document.attachmentSize,
    status: document.status || 'Creado en Alfresco',
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

export function recordAlfrescoConfirmedDocument(documentData, entry) {
  if (!entry?.id) throw new Error('Se requiere el identificador confirmado por Alfresco.')

  const store = readConfirmedStore()
  const existingDocument = store.documents.find((document) => document.id === entry.id)
  if (existingDocument) return { document: existingDocument, documents: store.documents, duplicate: true }

  const properties = entry.properties || {}
  const document = {
    ...documentData,
    id: entry.id,
    source: 'alfresco',
    issuerCode: documentData.issuerCode || documentData.issuingAcronym,
    documentNumber: properties['gd:numero'] || documentData.documentNumber || '',
    documentDate: properties['gd:fechaDocumento'] || documentData.documentDate || '',
    originatingDependency: properties['gd:dependenciaOrigen'] || documentData.originatingDependency || '',
    recipientDependencyId: properties['gd:dependenciaDestino'] || documentData.recipientDependencyId || '',
    recipientName: properties['gd:destinatario'] || documentData.recipientName || '',
    documentType: properties['gd:tipoDocumental'] || documentData.documentType || '',
    currentResponsible: properties['gd:responsableActual'] || documentData.currentResponsible || '',
    currentResponsibleDependency: properties['gd:dependenciaResponsableActual'] || documentData.currentResponsibleDependency || '',
    recipientUserId: documentData.recipientUserId,
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
    status: properties['gd:estado'] || 'Creado en Alfresco',
    emissionDate: entry.createdAt || documentData.emissionDate,
    createdAt: entry.createdAt || documentData.emissionDate,
  }
  const nextStore = { documents: [document, ...store.documents] }
  window.localStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(nextStore))
  return { document, documents: nextStore.documents, duplicate: false }
}
