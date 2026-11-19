const priorities = {
  normal: { label: 'Normal', className: 'normal' },
  alta: { label: 'Alta', className: 'high' },
  urgente: { label: 'Urgente', className: 'urgent' },
}

export function documentPriority(value) {
  const key = String(value || '').trim().toLocaleLowerCase('es')
  return Object.hasOwn(priorities, key) ? priorities[key] : { label: 'No registrada', className: 'unknown' }
}

export function ownSentDocuments(documents, userId) {
  return userId ? documents.filter((document) => document.senderUserId === userId) : []
}

// Enrich only nodes already returned by the authorized inbox query. Browser records
// neither grant access nor add documents to another user's inbox.
export function withKnownPriorities(documents, confirmations) {
  const known = new Map(confirmations.map((document) => [document.id, document]))
  return documents.map((document) => {
    if (documentPriority(document.priority).className !== 'unknown') return document
    const local = known.get(document.id)
    if (!document.senderUserId || local?.senderUserId !== document.senderUserId || documentPriority(local.priority).className === 'unknown') return document
    return { ...document, priority: local.priority, prioritySource: 'browser' }
  })
}

export function personalAttentionKey(userId, dependency) {
  return `uac.personal-attention.v1.${encodeURIComponent(userId)}.${encodeURIComponent(dependency)}`
}

export function loadPersonalAttention(storage, key) {
  const value = storage.getItem(key)
  if (value === null) return []
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string' || !id)) throw new Error('Selección personal no válida.')
  return [...new Set(parsed)]
}

export function personalAttentionDocuments(documents, selectedIds) {
  const selected = new Set(selectedIds)
  return documents.filter((document) => selected.has(document.id))
}
