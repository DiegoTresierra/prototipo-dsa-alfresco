export function isDirectorRole(roleId) {
  return roleId === 'director' || String(roleId || '').startsWith('director-')
}

export function getDocumentSubmissionError({ fields, issuer, dependency, recipient, counter, counterError, counterPending = false, mainDocument, officialEmission = false }) {
  const labels = { documentType: 'tipo documental', documentPeriod: 'periodo', priority: 'prioridad', subject: 'asunto', description: 'descripción' }
  const missing = Object.entries(labels).filter(([name]) =>
    (officialEmission || isDirectorRole(issuer.roleId) || !['documentPeriod', 'priority'].includes(name)) && !String(fields[name] || '').trim()).map(([, label]) => label)
  if (missing.length) return `Completa: ${missing.join(', ')}.`
  if (dependency && !dependency.available || !dependency && !officialEmission) return 'Selecciona una dependencia destinataria disponible en la lista.'
  if (officialEmission && !isDirectorRole(issuer.roleId) && dependency) return 'La distribución de documentos propios requiere un circuito institucional autorizado. Puedes emitir sin destinatario; no se creará una recepción ficticia.'
  if (isDirectorRole(issuer.roleId) && dependency) {
    if (String(dependency.id).toLowerCase() === String(issuer.dependencyId || '').toLowerCase()) return 'Selecciona una dependencia distinta de la emisora para enviar a otro director.'
  } else if (!officialEmission && !recipient?.inboxNodeId) return 'El puesto seleccionado no tiene una cuenta destinataria con bandeja configurada en el servidor.'
  if (isDirectorRole(issuer.roleId) && !issuer.issuerCode) return 'La sesión no tiene un código de emisor configurado. Revisa la dependencia y unidad asignadas a tu cuenta.'
  if (counterError) return counterError
  if (!counter.next && !counterPending) return 'No se pudo obtener el correlativo del documento para el emisor actual.'
  if (!mainDocument) return 'Selecciona el PDF principal y espera a que termine su validación.'
  return ''
}
