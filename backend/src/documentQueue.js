// Process-local only. This does not serialize another process or external writer.
export function createDocumentQueue() {
  const tails = new Map()
  return async (documentId, operation) => {
    const previous = tails.get(documentId) || Promise.resolve()
    let release
    const next = new Promise((resolve) => { release = resolve })
    tails.set(documentId, next)
    await previous
    try { return await operation() } finally {
      release()
      if (tails.get(documentId) === next) tails.delete(documentId)
    }
  }
}
