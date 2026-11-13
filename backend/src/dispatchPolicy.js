const allowedPriorities = new Set(['Normal', 'Alta', 'Urgente'])

export function canDispatch(session) {
  return session?.authorizationStatus === 'active' &&
    session.functionalRole === 'direccion' &&
    session.capabilities?.includes('documents:write')
}

export function validateDispatchRequest(input = {}, session, recipients = []) {
  if (!canDispatch(session)) {
    const error = new Error('DIRECTOR_DISPATCH_REQUIRED')
    error.status = 403
    throw error
  }

  const documentId = String(input.documentId || '').trim()
  const instruction = String(input.instruction || '').trim()
  const priority = String(input.priority || '').trim()
  const requestKey = String(input.requestKey || '').trim()
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
  const allowedRecipients = new Map(recipients
    .filter((recipient) => recipient.functionalRole === 'jefe-unidad' &&
      recipient.dependency === senderDependency &&
      (recipient.unit?.code || recipient.unit?.id || recipient.unit?.name))
    .map((recipient) => [recipient.id, recipient]))
  const selectedRecipients = recipientUserIds.map((userId) => allowedRecipients.get(userId))
  if (selectedRecipients.some((recipient) => !recipient)) {
    const error = new Error('DISPATCH_RECIPIENT_NOT_ALLOWED')
    error.status = 403
    throw error
  }

  return {
    documentId,
    instruction,
    priority,
    requestKey,
    senderDependency,
    recipients: selectedRecipients,
  }
}

export function dispatchIdentity(session, requestKey) {
  return `${session?.alfresco?.id || session?.user?.id || ''}:${requestKey}`
}
