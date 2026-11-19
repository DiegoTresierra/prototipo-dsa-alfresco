export function isDirectorRole(roleId) {
  return roleId === 'director' || String(roleId || '').startsWith('director-')
}

export function getDocumentSubmissionError({ fields, issuer, dependency, unit, position, recipient, counter, counterError, counterPending = false, mainDocument }) {
  const labels = { documentType: 'tipo documental', documentPeriod: 'periodo', priority: 'prioridad', subject: 'asunto', description: 'descripción' }
  const missing = Object.entries(labels).filter(([name]) => !String(fields[name] || '').trim()).map(([, label]) => label)
  if (missing.length) return `Completa: ${missing.join(', ')}.`
  if (!dependency?.available) return 'Selecciona una dependencia destinataria disponible en la lista.'
  if (!unit) return 'Selecciona la unidad organizacional del destinatario.'
  if (!position || !position.available) return 'Selecciona un puesto destinatario disponible.'
  if (isDirectorRole(issuer.roleId)) {
    if (String(dependency.id).toLowerCase() === String(issuer.dependencyId || '').toLowerCase()) return 'Selecciona una dependencia distinta de la emisora para enviar a otro director.'
    if (!position.id.endsWith('puesto-direccion')) return 'Selecciona el puesto de Dirección de la dependencia destinataria.'
  } else if (!recipient?.inboxNodeId) return 'El puesto seleccionado no tiene una cuenta destinataria con bandeja configurada en el servidor.'
  if (!issuer.issuerCode) return 'La sesión no tiene un código de emisor configurado. Revisa la dependencia y unidad asignadas a tu cuenta.'
  if (counterError) return counterError
  if (!counter.next && !counterPending) return 'No se pudo obtener el correlativo del documento para el emisor actual.'
  if (!mainDocument) return 'Selecciona el PDF principal y espera a que termine su validación.'
  return ''
}
