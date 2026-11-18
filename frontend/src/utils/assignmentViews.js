export function assignmentRows(records, userId, mode = 'received') {
  return records.flatMap((dispatch) => (dispatch.recipients || [])
    .filter((assignment) => mode === 'sent' ? dispatch.senderUserId === userId :
      assignment.userId === userId && ['ASIGNADO', 'DESPACHADO', 'ATENDIDO'].includes(assignment.status))
    .map((assignment) => ({ dispatch, assignment })))
}

export function canDeriveAssignment(sessionRoles, assignment, userId) {
  return Boolean(sessionRoles?.includes('especialista') && assignment?.userId === userId &&
    assignment.functionalRole === 'jefe-unidad' && ['ASIGNADO', 'DESPACHADO'].includes(assignment.status))
}
