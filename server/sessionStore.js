import crypto from 'node:crypto'

const sessions = new Map()
const transactions = new Map()

const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const TRANSACTION_TTL_MS = 10 * 60 * 1000

function randomId() {
  return crypto.randomBytes(32).toString('base64url')
}

export function createSession(data) {
  const id = randomId()
  const session = {
    ...data,
    id,
    csrfToken: randomId(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  sessions.set(id, session)
  return session
}

export function getSession(id) {
  if (!id) return null
  const session = sessions.get(id)
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id)
    return null
  }
  return session
}

export function deleteSession(id) {
  if (id) sessions.delete(id)
}

export function createOidcTransaction(data) {
  const id = randomId()
  transactions.set(id, { ...data, expiresAt: Date.now() + TRANSACTION_TTL_MS })
  return id
}

export function consumeOidcTransaction(id) {
  if (!id) return null
  const transaction = transactions.get(id)
  transactions.delete(id)
  if (!transaction || transaction.expiresAt <= Date.now()) return null
  return transaction
}

setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id)
  }
  for (const [id, transaction] of transactions) {
    if (transaction.expiresAt <= now) transactions.delete(id)
  }
}, 60_000).unref()
