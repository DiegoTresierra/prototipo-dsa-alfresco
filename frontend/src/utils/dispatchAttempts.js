// Atomically reserve one outstanding intent per actor/document across same-origin tabs.
async function transaction(mode, run) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('document-dispatch-intents', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('pending')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('pending', mode, { durability: 'strict' })
      let result
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(tx.error || new Error('Registro del intento no disponible.'))
      run(tx.objectStore('pending'), value => { result = value })
    })
  } finally { db.close() }
}
export function pendingDispatch(actor, documentId) {
  return transaction('readonly', (store, done) => {
    const read = store.get([actor, documentId])
    read.onsuccess = () => done(read.result)
  })
}
export function reserveDispatch(actor, payload) {
  return transaction('readwrite', store => store.add(payload, [actor, payload.documentId]))
}
export function releaseDispatch(actor, payload) {
  return transaction('readwrite', store => {
    const index = [actor, payload.documentId]
    const read = store.get(index)
    read.onsuccess = () => {
      if (read.result?.requestKey === payload.requestKey) store.delete(index)
    }
  })
}
export function receiptMatches(actor, p, r) {
  return Boolean(r?.id && r.senderUserId === actor && r.documentId === p.documentId &&
    r.requestKey === p.requestKey && r.instruction === p.instruction && r.priority === p.priority &&
    (r.originAssignmentId ?? null) === p.originAssignmentId && (r.unitId ?? null) === (p.unitId ?? null) &&
    Array.isArray(r.recipients) && JSON.stringify(r.recipients.map(a => a.userId).sort()) ===
    JSON.stringify([...p.recipientUserIds].sort()))
}
