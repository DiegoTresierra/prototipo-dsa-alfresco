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
      .filter((notification) => notification?.type === notificationEventType && typeof notification.id === 'string' && typeof notification.documentId === 'string')
      .map((notification) => ({
        id: notification.id,
        type: notificationEventType,
        documentId: notification.documentId,
        title: typeof notification.title === 'string' ? notification.title : '',
        sender: typeof notification.sender === 'string' ? notification.sender : '',
        priority: typeof notification.priority === 'string' ? notification.priority : '',
        inboxKinds: Array.isArray(notification.inboxKinds) ? notification.inboxKinds.filter((kind) => typeof kind === 'string') : [],
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
      notifications: state.notifications.map(({ id, type, documentId, title, sender, priority, inboxKinds, detectedAt, isRead }) => ({
        id, type, documentId, title, sender, priority, inboxKinds, detectedAt, isRead,
      })),
    }))
    return true
  } catch {
    return false
  }
}
