import { isAttentionAssignment } from '../attentionPolicy.js'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { config } from '../config.js'

function storePath() {
  return config.dispatchStorePath
}

function readRecords() {
  try {
    if (!fs.existsSync(storePath())) return []
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('DISPATCH_STORE_UNAVAILABLE')
    return parsed.map(normalizeDispatch)
  } catch (cause) {
    throw Object.assign(new Error('DISPATCH_STORE_UNAVAILABLE', { cause }), { code: 'DISPATCH_STORE_UNAVAILABLE', storagePhase: 'read' })
  }
}

// Previous records only supported Dirección -> Jefatura. Stable legacy IDs allow
// linking them without rewriting the store during a GET or migrating existing data.
function normalizeDispatch(record) {
  return {
    ...record,
    senderRole: record.senderRole || 'direccion',
    originAssignmentId: record.originAssignmentId || null,
    recipients: record.recipients.map((recipient) => ({
      ...recipient,
      id: recipient.id || `legacy:${record.id}:${createHash('sha256').update(recipient.userId).digest('hex').slice(0, 32)}`,
      dispatchId: record.id,
      documentId: record.documentId,
      functionalRole: recipient.functionalRole || 'jefe-unidad',
      senderUserId: record.senderUserId,
      senderRole: record.senderRole || 'direccion',
      senderDependency: record.senderDependency,
      createdAt: recipient.createdAt || record.createdAt,
      instruction: record.instruction,
      originAssignmentId: record.originAssignmentId || null,
    })),
  }
}

export function findAttentionAssignment(userId, documentId, dependency, assignmentId) {
  return readRecords().filter((record) => record.documentId === documentId)
    .flatMap((record) => record.recipients)
    .find((recipient) => recipient.id === assignmentId && isAttentionAssignment(recipient, userId, 'jefe-unidad', dependency)) || null
}

function writeRecords(records) {
  let storagePhase = 'mkdir'
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    const temporaryPath = `${storePath()}.${process.pid}.tmp`
    storagePhase = 'write-temporary'
    fs.writeFileSync(temporaryPath, JSON.stringify(records, null, 2), 'utf8')
    storagePhase = 'rename'
    fs.renameSync(temporaryPath, storePath())
  } catch (cause) {
    throw Object.assign(new Error('DISPATCH_STORE_UNAVAILABLE', { cause }), { code: 'DISPATCH_STORE_UNAVAILABLE', storagePhase })
  }
}

export function findDispatch(senderUserId, requestKey) {
  return readRecords().find((record) => record.senderUserId === senderUserId && record.requestKey === requestKey) || null
}

export function createDispatch(input) {
  const records = readRecords()
  const existing = records.find((record) => record.senderUserId === input.senderUserId && record.requestKey === input.requestKey)
  if (existing) {
    const storedRecipients = existing.recipients.map((recipient) => `${recipient.userId}:${recipient.functionalRole}`).sort()
    const requestedRecipients = input.recipients.map((recipient) => `${recipient.id}:${recipient.functionalRole || 'jefe-unidad'}`).sort()
    if (existing.documentId !== input.documentId || existing.instruction !== input.instruction || existing.priority !== input.priority ||
        existing.senderRole !== (input.senderRole || 'direccion') || (existing.originAssignmentId || null) !== (input.originAssignmentId || null) ||
        JSON.stringify(storedRecipients) !== JSON.stringify(requestedRecipients)) {
      throw Object.assign(new Error('DISPATCH_REQUEST_CONFLICT'), { status: 409 })
    }
    return existing
  }
  const record = {
    id: randomUUID(),
    requestKey: input.requestKey,
    documentId: input.documentId,
    senderUserId: input.senderUserId,
    senderDependency: input.senderDependency,
    senderRole: input.senderRole || 'direccion',
    originAssignmentId: input.originAssignmentId || null,
    recipients: input.recipients.map((recipient) => ({
      id: randomUUID(),
      userId: recipient.id,
      displayName: recipient.displayName,
      dependency: recipient.dependency,
      functionalRole: recipient.functionalRole || 'jefe-unidad',
      unit: recipient.unit || null,
      inboxNodeId: recipient.inboxNodeId,
      status: 'PENDIENTE',
    })),
    instruction: input.instruction,
    priority: input.priority,
    createdAt: new Date().toISOString(),
    status: 'EN_PROCESO',
  }
  const normalized = normalizeDispatch(record)
  writeRecords([...records, normalized])
  return normalized
}

export function updateDispatch(id, updater) {
  const records = readRecords()
  const index = records.findIndex((record) => record.id === id)
  if (index === -1) throw new Error('DISPATCH_NOT_FOUND')
  const next = updater(records[index])
  records[index] = next
  writeRecords(records)
  return next
}

export function listDispatchesForUser(userId, role, dependency) {
  const records = readRecords()
  if (role === 'direccion') return records.filter((record) => record.senderUserId === userId &&
    (typeof dependency !== 'string' || record.senderDependency === dependency.toLowerCase()))
  const dependencyId = typeof dependency === 'string' ? dependency : null
  return records.filter((record) => record.recipients.some((recipient) =>
    isAttentionAssignment(recipient, userId, role, dependencyId)))
}

export function listSentDispatches(userId, dependency) {
  return readRecords().filter((record) => record.senderUserId === userId &&
    record.senderDependency === String(dependency).toLowerCase())
}
