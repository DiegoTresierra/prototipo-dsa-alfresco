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
      .filter((notification) => [notificationEventType, 'assignment-created'].includes(notification?.type) && typeof notification.id === 'string' && typeof notification.documentId === 'string')
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
          !['ASIGNADO', 'DESPACHADO'].includes(assignment.status)) continue
      const id = JSON.stringify([dispatch.documentId, assignment.id, userId, 'ASSIGNMENT_CREATED'])
      events.set(id, {
        id, type: 'assignment-created', documentId: dispatch.documentId,
        assignmentId: assignment.id,
        detectedAt: assignment.createdAt || dispatch.createdAt || '',
        title: document?.subject || document?.attachmentName || '',
        sender: document?.sender || dispatch.senderUserId || '',
        priority: dispatch.priority || document?.priority || '',
        isRead: readIds.has(id), source: 'alfresco-assignment',
      })
    }
  }
  return [...events.values()]
}
