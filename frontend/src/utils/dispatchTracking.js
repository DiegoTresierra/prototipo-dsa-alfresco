const activeStatuses = new Set(['ASIGNADO', 'DESPACHADO'])
const labels = { ASIGNADO: 'Asignado', DESPACHADO: 'Despachado', ATENDIDO: 'Atendido', ANULADO: 'Anulado' }

export function dispatchUnitLabel(assignment) {
  return assignment.unitId && assignment.unit?.id === assignment.unitId && assignment.unit.name
    ? assignment.unit.name
    : 'Unidad no registrada'
}

export function dispatchTrackingRows(records, documents = []) {
  const names = new Map(documents.map((document) => [document.id, document.subject || document.attachmentName]))
  return records.filter((record) => record.persistence === 'alfresco').flatMap((record) => record.recipients.map((assignment) => ({
    id: assignment.id,
    documentId: record.documentId,
    documentName: names.get(record.documentId) || 'Documento ' + record.documentId,
    unitId: assignment.unitId || '',
    unitName: dispatchUnitLabel(assignment),
    responsible: assignment.displayName || assignment.userId,
    status: labels[assignment.status] || assignment.status,
    active: activeStatuses.has(assignment.status),
    date: record.createdAt || assignment.assignedAt,
  }))).sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
}
