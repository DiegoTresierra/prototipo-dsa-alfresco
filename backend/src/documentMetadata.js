const aspectNames = ['gd:identificacion', 'gd:clasificacion', 'gd:tramite']
const allowedStates = new Set(['POR_CONOCIMIENTO', 'POR_ATENDER'])

function requiredText(value, field) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`DOCUMENT_METADATA_${field.toUpperCase()}_REQUIRED`)
  return normalized
}

export function buildInstitutionalMetadata(input = {}) {
  const state = requiredText(input.state, 'estado').toLocaleUpperCase('es')
  if (!allowedStates.has(state)) throw new Error('DOCUMENT_METADATA_ESTADO_INVALID')

  const metadata = {
    'gd:numero': requiredText(input.number, 'numero'),
    'gd:fechaDocumento': requiredText(input.documentDate, 'fechaDocumento'),
    'gd:dependenciaOrigen': requiredText(input.originDependency, 'dependenciaOrigen'),
    'gd:dependenciaDestino': requiredText(input.destinationDependency, 'dependenciaDestino'),
    'gd:remitente': requiredText(input.sender, 'remitente'),
    'gd:destinatario': requiredText(input.recipient, 'destinatario'),
    'gd:tipoDocumental': requiredText(input.documentType, 'tipoDocumental'),
    'gd:estado': state,
    'gd:responsableActual': requiredText(input.currentResponsible, 'responsableActual'),
    'gd:dependenciaResponsableActual': requiredText(input.currentResponsibleDependency, 'dependenciaResponsableActual'),
  }

  return { aspectNames, properties: metadata }
}

export function parseInstitutionalMetadataHeader(value) {
  try {
    return buildInstitutionalMetadata(JSON.parse(String(value || '')))
  } catch (error) {
    if (error.message.startsWith('DOCUMENT_METADATA_')) throw error
    throw new Error('DOCUMENT_METADATA_INVALID')
  }
}
