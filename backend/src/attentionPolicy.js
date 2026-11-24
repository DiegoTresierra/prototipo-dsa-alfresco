export const assignmentIsActive = (assignment) => ['ASIGNADO', 'DESPACHADO'].includes(assignment.status)
export function canAttendSession(session) {
  return session?.authorizationStatus === 'active' && ['direccion', 'jefe-unidad', 'especialista'].includes(session.functionalRole) &&
    ['dsa', 'dti'].includes(String(session.dependency || '').toLowerCase()) &&
    session.capabilities?.includes('documents:read') && session.capabilities?.includes('documents:write')
}
// The institutional issuance endpoint currently authorizes Dirección only.
export const canIssueResponse = (session) => canAttendSession(session) && session.functionalRole === 'direccion'
// Reusing an already official document is distinct from generating a new response.
export const canLinkResponse = session => canAttendSession(session)
export function ownsAssignment(assignment, session) {
  return assignment.userId === (session.alfresco?.id || session.user?.id) && assignment.functionalRole === session.functionalRole &&
    assignment.dependency === String(session.dependency || '').toLowerCase()
}
export function validateAttentionInput(body = {}, allowDocumentResponse = false) {
  if (body.relationType !== undefined && body.relationType !== 'response') {
    throw Object.assign(new Error('DOCUMENT_RELATION_TYPE_NOT_SUPPORTED'), { status: 400 })
  }
  const { documentId, assignmentId, requestKey } = body
  if (![documentId, requestKey].every((value) => typeof value === 'string' && value.trim() && value.length <= 250) ||
      !/^[A-Za-z0-9-]+$/.test(documentId) ||
      !(allowDocumentResponse && assignmentId == null) && (typeof assignmentId !== 'string' || !/^[A-Za-z0-9:_-]{1,250}$/.test(assignmentId)) ||
      body.responseDocumentId != null && (typeof body.responseDocumentId !== 'string' || !/^[A-Za-z0-9-]{1,250}$/.test(body.responseDocumentId))) {
    throw Object.assign(new Error('INVALID_ATTENTION_REQUEST'), { status: 400 })
  }
  return { documentId, assignmentId: assignmentId || null, requestKey, responseDocumentId: body.responseDocumentId || null }
}
export function attentionSummary(envelope) {
  const assignments = envelope.dispatches.flatMap((record) => record.recipients)
  const pending = assignments.filter(assignmentIsActive).length
  const cancelled = assignments.filter((assignment) => assignment.status === 'ANULADO').length
  return { total: assignments.length, attended: assignments.filter((assignment) => assignment.status === 'ATENDIDO').length,
    pending, cancelled, readyForClosureReview: assignments.length > 0 && pending === 0 && cancelled === 0,
    formalClosureAllowed: false } // Authority and cancellation rules require an institutional decision.
}
