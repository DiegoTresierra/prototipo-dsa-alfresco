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
