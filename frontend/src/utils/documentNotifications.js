const notificationEventType = 'document-received'

export function documentNotificationStorageKey(userId, dependency) {
  return `uac.document-notifications.v1.${encodeURIComponent(userId || 'unknown')}.${encodeURIComponent(dependency || 'unknown')}`
}

function emptyState() {
  return { initialized: false, knownDocumentIds: [], notifications: [] }
}

export function loadDocumentNotificationState(storage, key) {
  try {
    const value = storage.getItem(key)
    if (!value) return emptyState()
    const parsed = JSON.parse(value)
    if (!parsed || !Array.isArray(parsed.knownDocumentIds) || !Array.isArray(parsed.notifications)) return emptyState()

    const notifications = parsed.notifications
      .filter((notification) => [notificationEventType, 'assignment-created', 'deadline-near', 'deadline-overdue', 'assignment-attended'].includes(notification?.type) && typeof notification.id === 'string' && typeof notification.documentId === 'string')
      .map((notification) => ({
        id: notification.id,
        type: notification.type,
        documentId: notification.documentId,
        detectedAt: typeof notification.detectedAt === 'string' ? notification.detectedAt : '',
        isRead: notification.isRead === true,
      }))

    return {
      initialized: parsed.initialized === true,
      knownDocumentIds: [...new Set(parsed.knownDocumentIds.filter((id) => typeof id === 'string' && id))],
      notifications,
    }
  } catch {
    return emptyState()
  }
}

export function saveDocumentNotificationState(storage, key, state) {
  try {
    storage.setItem(key, JSON.stringify({
      initialized: state.initialized,
      knownDocumentIds: state.knownDocumentIds,
      notifications: state.notifications.map(({ id, type, documentId, detectedAt, isRead }) => ({
        id, type, documentId, detectedAt, isRead,
      })),
    }))
    return true
  } catch {
    return false
  }
}

export function authorizedNotifications(notifications, documents) {
  const current = new Map(documents.map((document) => [document.id, document]))
  return notifications.filter((notice) => current.has(notice.documentId)).map((notice) => {
    const document = current.get(notice.documentId)
    return { ...notice, title: document.subject || document.attachmentName || '', sender: document.sender || '',
      priority: document.priority || '', inboxKinds: document.inboxKinds || [], source: 'browser-detection' }
  })
}

// The current Alfresco inbox and persisted gd:asignaciones are the only event
// sources. Browser state can mark an event read, but can never create one.
export function persistedDocumentNotifications(documents, dispatches, userId, readState = []) {
  const readIds = new Set(readState.filter(item => item.isRead).map(item => item.id))
  const events = new Map()
  for (const document of documents || []) {
    if (!document?.id) continue
    const id = JSON.stringify([document.id, '', userId, 'DOCUMENT_IN_INBOX'])
    events.set(id, {
      id, type: 'document-received', documentId: document.id,
      detectedAt: document.createdAt || document.modifiedAt || '',
      title: document.subject || document.attachmentName || '',
      sender: document.sender || '', priority: document.priority || '',
      isRead: readIds.has(id), source: 'alfresco-inbox',
    })
  }
  const available = new Set((documents || []).map(document => document.id))
  for (const dispatch of dispatches || []) {
    if (!available.has(dispatch.documentId)) continue
    const document = documents.find(item => item.id === dispatch.documentId)
    for (const assignment of dispatch.recipients || []) {
      if (!assignment.id || assignment.userId !== userId ||
          !['ASIGNADO', 'DESPACHADO', 'ATENDIDO'].includes(assignment.status)) continue
      const id = JSON.stringify([dispatch.documentId, assignment.id, userId, 'ASSIGNMENT_CREATED'])
      events.set(id, {
        id, type: 'assignment-created', documentId: dispatch.documentId,
        assignmentId: assignment.id,
        detectedAt: assignment.createdAt || dispatch.createdAt || '',
        title: document?.subject || document?.attachmentName || '',
        sender: document?.sender || dispatch.senderUserId || '',
        priority: dispatch.priority || document?.priority || '',
        deadline: assignment.deadline,
        isRead: readIds.has(id), source: 'alfresco-assignment',
      })
      const deadline = assignment.deadline
      const addAssignmentEvent = (type, detectedAt) => {
        const eventId = JSON.stringify([dispatch.documentId, assignment.id, userId, type])
        events.set(eventId, {
          id: eventId, type, documentId: dispatch.documentId, assignmentId: assignment.id,
          detectedAt, title: document?.subject || document?.attachmentName || '',
          sender: document?.sender || dispatch.senderUserId || '', priority: dispatch.priority || document?.priority || '',
          deadline, isRead: readIds.has(eventId), source: 'alfresco-assignment',
        })
      }
      if (assignment.status === 'ATENDIDO') addAssignmentEvent('assignment-attended', assignment.attendedAt || assignment.createdAt || dispatch.createdAt || '')
      else if (['POR_VENCER', 'VENCIDO'].includes(deadline?.status)) {
        const nearAt = Date.parse(deadline.dueAt) - deadline.initialDurationMs * 0.2
        addAssignmentEvent('deadline-near', Number.isFinite(nearAt) ? new Date(nearAt).toISOString() : deadline.dueAt)
        if (deadline.status === 'VENCIDO') addAssignmentEvent('deadline-overdue', deadline.dueAt || new Date().toISOString())
      }
    }
  }
  return [...events.values()]
}
