const deadlineStatuses = new Set(['EN_PLAZO', 'POR_VENCER', 'VENCIDO', 'ATENDIDO', 'SIN_PLAZO_REGISTRADO'])

export function deliveryDeadline(assignment) {
  const dueAt = assignment?.deadlineSnapshot?.dueAt || assignment?.deadline?.dueAt || null
  const calculatedStatus = assignment?.deadline?.status
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) {
    return { dueAt: null, status: calculatedStatus || 'SIN_PLAZO_REGISTRADO' }
  }
  return {
    dueAt,
    status: deadlineStatuses.has(calculatedStatus) ? calculatedStatus : 'ESTADO_NO_DISPONIBLE',
  }
}

export function formatDeliveryDeadline(value) {
  const timestamp = Date.parse(value || '')
  if (!Number.isFinite(timestamp)) return 'No definida'
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short',
  }).format(timestamp)
}
