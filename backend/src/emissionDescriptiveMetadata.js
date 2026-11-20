export const descriptiveProperties = ['gd:dependenciaOrigen', 'gd:dependenciaDestino', 'gd:remitente', 'gd:destinatario', 'gd:fechaDocumento']
export function assertDescriptiveModel(identification, classification) {
  for (const name of [...descriptiveProperties, 'gd:tipoDocumental']) {
    const p = (name === 'gd:tipoDocumental' ? classification : identification)?.properties?.[name]
    if (!p || p.dataType !== 'd:text' || p.multiValued !== false || p.protected === true) {
      throw Object.assign(new Error('OFFICIAL_DESCRIPTIVE_MODEL_REQUIRED'), { status: 503 })
    }
  }
}
export function emissionDate(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export function descriptiveMetadata({ code, actorId, recipientDependency, documentType }, date) {
  return { 'gd:dependenciaOrigen': code, 'gd:dependenciaDestino': recipientDependency, 'gd:remitente': actorId,
    'gd:destinatario': recipientDependency, 'gd:tipoDocumental': documentType, 'gd:fechaDocumento': date }
}
export function verifyDescriptiveMetadata(node, expected) {
  if (Object.entries(expected).some(([name, value]) => node.properties?.[name] !== value) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(node.properties?.['gd:fechaDocumento'] || '')) {
    throw Object.assign(new Error('OFFICIAL_DESCRIPTIVE_METADATA_MISMATCH'), { status: 409 })
  }
}
