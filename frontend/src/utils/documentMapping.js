import { documentIdentity } from './documentIdentity.js'

export function nodeToDocument(node) {
  const properties = node.properties || {}
  const content = node.content || {}
  const rawNumber = properties['gd:numero']
  const validNumber = typeof rawNumber === 'string' && /^[1-9][0-9]*$/.test(rawNumber) && Number.isSafeInteger(Number(rawNumber))
  return {
    id: node.id,
    subject: properties['cm:title'] || node.name,
    description: properties['cm:description'] || '',
    sender: node.createdByUser?.displayName || node.createdByUser?.id || '',
    senderUserId: node.createdByUser?.id || '',
    createdByUserId: node.createdByUser?.id || '',
    createdByName: node.createdByUser?.displayName || node.createdByUser?.id || '',
    formalSender: properties['gd:remitente'] || '',
    originatingDependency: '',
    documentIdentity: documentIdentity(node),
    documentType: properties['gd:tipoDocumental'] || '',
    issuerCode: properties['gd:codigoDocumental'] || '',
    documentYear: properties['gd:cicloDocumental'] || '',
    originalConsecutive: validNumber ? rawNumber : '',
    numberingSource: validNumber ? 'alfresco-metadata' : 'unregistered',
    documentNumber: '',
    priority: '',
    prioritySource: 'not-recorded',
    emittedOrigin: node.emittedOrigin || null,
    contentWarning: node.contentWarning || null,
    recipientName: properties['gd:destinatario'] || '',
    recipientDependencyId: properties['gd:dependenciaDestino'] || '',
    emissionDate: properties['gd:fechaDocumento'] || '',
    unitName: '',
    specialistName: '',
    attachmentName: node.name,
    createdAt: node.createdAt,
    status: properties['gd:estado'] || null,
    nodeType: node.nodeType,
    mimeType: content.mimeType || '',
    sizeInBytes: content.sizeInBytes || 0,
  }
}
