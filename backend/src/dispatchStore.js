import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'

function storePath() {
  return config.dispatchStorePath
}

function readRecords() {
  try {
    if (!fs.existsSync(storePath())) return []
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    throw new Error('DISPATCH_STORE_UNAVAILABLE')
  }
}

function writeRecords(records) {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    const temporaryPath = `${storePath()}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(records, null, 2), 'utf8')
    fs.renameSync(temporaryPath, storePath())
  } catch {
    throw new Error('DISPATCH_STORE_UNAVAILABLE')
  }
}

export function findDispatch(senderUserId, requestKey) {
  return readRecords().find((record) => record.senderUserId === senderUserId && record.requestKey === requestKey) || null
}

export function createDispatch(input) {
  const records = readRecords()
  const existing = records.find((record) => record.senderUserId === input.senderUserId && record.requestKey === input.requestKey)
  if (existing) return existing
  const record = {
    id: randomUUID(),
    requestKey: input.requestKey,
    documentId: input.documentId,
    senderUserId: input.senderUserId,
    senderDependency: input.senderDependency,
    recipients: input.recipients.map((recipient) => ({
      userId: recipient.id,
      displayName: recipient.displayName,
      dependency: recipient.dependency,
      unit: recipient.unit || null,
      inboxNodeId: recipient.inboxNodeId,
      status: 'PENDIENTE',
    })),
    instruction: input.instruction,
    priority: input.priority,
    createdAt: new Date().toISOString(),
    status: 'EN_PROCESO',
  }
  writeRecords([...records, record])
  return record
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

function unitKey(unit) {
  return String(unit?.code || unit?.id || unit?.acronym || unit?.name || '').trim().toLowerCase()
}

export function listDispatchesForUser(userId, role, unit) {
  const records = readRecords()
  if (role === 'direccion') return records.filter((record) => record.senderUserId === userId)
  const requestedUnit = unitKey(unit)
  return records.filter((record) => record.recipients.some((recipient) =>
    recipient.userId === userId &&
    ['ASIGNADO', 'DESPACHADO'].includes(recipient.status) &&
    (!requestedUnit || unitKey(recipient.unit) === requestedUnit)))
}
