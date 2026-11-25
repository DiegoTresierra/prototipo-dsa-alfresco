import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from './config.js'
import { createDispatch, findAttentionAssignment, findDispatch, listDispatchesForUser, updateDispatch } from './testFixtures/legacyDispatchStore.js'

test('failed local atomic replacement preserves the previous record and exposes only a safe diagnostic phase', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-fault-'))
  const previousPath = config.dispatchStorePath
  const originalRename = fs.renameSync
  config.dispatchStorePath = path.join(directory, 'dispatches.json')
  const input = { requestKey: 'fault', documentId: 'pdf-fixture', senderUserId: 'director-fixture', senderDependency: 'dsa',
    instruction: 'Fixture', priority: 'Normal', recipients: [{ id: 'head-fixture', displayName: 'Fixture', dependency: 'dsa' }] }
  try {
    const first = createDispatch(input)
    const before = fs.readFileSync(config.dispatchStorePath, 'utf8')
    let attempts = 0
    fs.renameSync = () => { attempts++; throw Object.assign(new Error('private path deliberately omitted'), { code: 'EPERM' }) }
    assert.throws(() => updateDispatch(first.id, record => ({ ...record, status: 'ASIGNADO' })), error =>
      error.code === 'DISPATCH_STORE_UNAVAILABLE' && error.storagePhase === 'rename' && error.cause.code === 'EPERM')
    assert.equal(attempts, 1, 'there is no blind mutation retry')
    assert.equal(fs.readFileSync(config.dispatchStorePath, 'utf8'), before)
    fs.renameSync = originalRename
    assert.equal(createDispatch(input).id, first.id, 'the original idempotent identity survives the failure')
  } finally {
    fs.renameSync = originalRename
    config.dispatchStorePath = previousPath
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('persists dispatches and returns the same record for an idempotent request', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-dispatch-'))
  const previousPath = config.dispatchStorePath
  config.dispatchStorePath = path.join(directory, 'dispatches.json')
  try {
    const input = {
      requestKey: 'request-1',
      documentId: 'pdf-1',
      senderUserId: 'director-dsa',
      senderDependency: 'dsa',
      instruction: 'Atender.',
      priority: 'Normal',
      recipients: [{ id: 'head-dsa', displayName: 'Head', dependency: 'dsa', unit: { code: 'DSA-01' }, inboxNodeId: 'inbox-1' }],
    }
    const first = createDispatch(input)
    const second = createDispatch(input)
    assert.equal(second.id, first.id)
    assert.throws(() => createDispatch({ ...input, instruction: 'Otro encargo' }), /DISPATCH_REQUEST_CONFLICT/)
    assert.equal(findDispatch('director-dsa', 'request-1').documentId, 'pdf-1')
    const updated = updateDispatch(first.id, (record) => ({ ...record, status: 'DESPACHADO' }))
    assert.equal(updated.status, 'DESPACHADO')
    updateDispatch(first.id, (record) => ({
      ...record,
      recipients: record.recipients.map((recipient) => ({ ...recipient, status: 'DESPACHADO' })),
    }))
    assert.equal(listDispatchesForUser('head-dsa', 'jefe-unidad').length, 1)
  } finally {
    config.dispatchStorePath = previousPath
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('malformed storage is an explicit error and is never replaced by an empty dispatch list', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-dispatch-invalid-'))
  const previousPath = config.dispatchStorePath
  config.dispatchStorePath = path.join(directory, 'dispatches.json')
  try {
    fs.writeFileSync(config.dispatchStorePath, '{}', 'utf8')
    assert.throws(() => listDispatchesForUser('head', 'jefe-unidad'), /DISPATCH_STORE_UNAVAILABLE/)
    assert.equal(fs.readFileSync(config.dispatchStorePath, 'utf8'), '{}')
  } finally {
    config.dispatchStorePath = previousPath
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy head assignments have stable origin IDs without mutating existing data on reads', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-dispatch-legacy-'))
  const previousPath = config.dispatchStorePath
  config.dispatchStorePath = path.join(directory, 'dispatches.json')
  try {
    const original = JSON.stringify([{ id: 'old-dispatch', documentId: 'original-uuid', senderUserId: 'director', senderDependency: 'dsa', instruction: 'Atender', createdAt: '2026-11-17T00:00:00Z', recipients: [{ userId: 'head', dependency: 'dsa', status: 'ASIGNADO', unit: null }] }])
    fs.writeFileSync(config.dispatchStorePath, original, 'utf8')
    const first = listDispatchesForUser('head', 'jefe-unidad', 'DSA')[0].recipients[0]
    const second = listDispatchesForUser('head', 'jefe-unidad', 'DSA')[0].recipients[0]
    assert.equal(first.id, second.id)
    assert.equal(findAttentionAssignment('head', 'original-uuid', 'dsa', first.id).id, first.id)
    assert.equal(findAttentionAssignment('another-head', 'original-uuid', 'dsa', first.id), null)
    assert.equal(findAttentionAssignment('head', 'original-uuid', 'dti', first.id), null)
    assert.equal(fs.readFileSync(config.dispatchStorePath, 'utf8'), original)
  } finally {
    config.dispatchStorePath = previousPath
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
