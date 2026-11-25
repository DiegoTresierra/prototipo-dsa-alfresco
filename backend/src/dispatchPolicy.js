const allowedPriorities = new Set(['Normal', 'Alta', 'Urgente'])
const unitIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hierarchyRevisionPattern = /^[0-9a-f]{64}$/
const fail = (code, status) => Object.assign(new Error(code), { status })

export const isDispatchUnitId = (id) => typeof id === 'string' && unitIdPattern.test(id)
export const isDispatchHierarchyRevision = (revision) => typeof revision === 'string' && hierarchyRevisionPattern.test(revision)

export const dispatchRecipientRoles = {
  direccion: ['jefe-unidad', 'especialista'],
  'jefe-unidad': ['especialista'],
  especialista: [],
}

export function allowedRecipientRoles(session) {
  if (session?.authorizationStatus !== 'active' || !session.capabilities?.includes('documents:write') ||
      !['dsa', 'dti'].includes(String(session.dependency || '').toLowerCase())) return []
  return dispatchRecipientRoles[session.functionalRole] || []
}

export function isValidDispatchUnit(unit, dependency) {
  return Boolean(unit && typeof unit.code === 'string' && unit.code.trim() &&
    typeof unit.name === 'string' && unit.name.trim() &&
    typeof unit.dependency === 'string' && unit.dependency.trim().toLowerCase() === String(dependency || '').toLowerCase())
}

export function canDispatch(session) {
  return allowedRecipientRoles(session).length > 0
}

export function requiresDispatchUnit(session, persistence) {
  return persistence === 'alfresco' && session?.functionalRole === 'direccion' &&
    String(session.dependency).toLowerCase() === 'dsa'
}

export function parseDispatchRequest(input = {}, session, { requireUnit = false } = {}) {
  if (!canDispatch(session)) {
    const error = new Error('HIERARCHICAL_DISPATCH_REQUIRED')
    error.status = 403
    throw error
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_DISPATCH_REQUEST', 400)

  const documentId = String(input.documentId || '').trim()
  const instruction = String(input.instruction || '').trim()
  const priority = String(input.priority || '').trim()
  const requestKey = String(input.requestKey || '').trim()
  const originAssignmentId = String(input.originAssignmentId || '').trim() || null
  const recipientUserIds = [...new Set(Array.isArray(input.recipientUserIds)
    ? input.recipientUserIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [])]

  if (!/^[a-zA-Z0-9-]+$/.test(documentId) || !requestKey || requestKey.length > 200) {
    const error = new Error('INVALID_DISPATCH_REQUEST')
    error.status = 400
    throw error
  }
  if (!instruction || instruction.length > 2000 || !allowedPriorities.has(priority) || recipientUserIds.length === 0) {
    const error = new Error('INVALID_DISPATCH_REQUEST')
    error.status = 400
    throw error
  }

  const senderDependency = String(session.dependency || '').toLowerCase()
  if (session.functionalRole === 'jefe-unidad' && !originAssignmentId) {
    throw Object.assign(new Error('DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED'), { status: 403 })
  }
  if ((originAssignmentId && !/^[A-Za-z0-9:_-]{1,250}$/.test(originAssignmentId)) ||
      (session.functionalRole === 'direccion' && originAssignmentId)) {
    throw Object.assign(new Error('INVALID_DISPATCH_ORIGIN'), { status: 400 })
  }
  const unitId = typeof input.unitId === 'string' ? input.unitId.trim().toLowerCase() : ''
  if (requireUnit) {
    if (!isDispatchUnitId(unitId)) throw fail('DISPATCH_UNIT_REQUIRED', 400)
    if (!isDispatchHierarchyRevision(input.hierarchyRevision)) throw fail('DISPATCH_HIERARCHY_REVISION_REQUIRED', 400)
  } else if (Object.hasOwn(input, 'unitId') || Object.hasOwn(input, 'hierarchyRevision')) {
    throw fail('DISPATCH_UNIT_NOT_APPLICABLE', 400)
  }

  return {
    documentId, instruction, priority, requestKey, senderDependency, senderRole: session.functionalRole,
    originAssignmentId, recipientUserIds,
    ...(requireUnit ? { unitId, hierarchyRevision: input.hierarchyRevision } : {}),
  }
}

export function selectDispatchRecipients(input, recipients) {
  const roles = dispatchRecipientRoles[input.senderRole] || []
  const allowedRecipients = new Map(recipients
    .filter((recipient) => roles.includes(recipient.functionalRole) &&
      recipient.dependency === input.senderDependency)
    .map((recipient) => [recipient.id, recipient]))
  const selectedRecipients = input.recipientUserIds.map((userId) => allowedRecipients.get(userId))
  if (selectedRecipients.some((recipient) => !recipient)) {
    throw fail(input.unitId ? 'DISPATCH_UNIT_RECIPIENT_NOT_ALLOWED' : 'DISPATCH_RECIPIENT_NOT_ALLOWED', 403)
  }
  return selectedRecipients
}

export function validateDispatchRequest(input, session, recipients = []) {
  const parsed = parseDispatchRequest(input, session)
  return { ...parsed, recipients: selectDispatchRecipients(parsed, recipients) }
}

export function dispatchRequestMatches(record, input) {
  if (record.documentId !== input.documentId || record.instruction !== input.instruction ||
      record.priority !== input.priority || record.senderRole !== input.senderRole ||
      record.senderDependency !== input.senderDependency ||
      (record.originAssignmentId || null) !== (input.originAssignmentId || null) ||
      (record.unitId || null) !== (input.unitId || null)) return false
  // A verified replay compares the stored destination, even if the live hierarchy has since changed.
  const recorded = record.recipients.map((r) => input.recipients ? [r.userId, r.functionalRole] : r.userId)
  const requested = input.recipients ? input.recipients.map((r) => [r.id, r.functionalRole]) : [...input.recipientUserIds]
  return JSON.stringify(recorded.sort()) === JSON.stringify(requested.sort())
}

export function dispatchIdentity(session, requestKey) {
  return `${session?.alfresco?.id || session?.user?.id || ''}:${requestKey}`
}
