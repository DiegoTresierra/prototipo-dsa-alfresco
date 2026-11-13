import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from './config.js'
import { createDispatch, findDispatch, listDispatchesForUser, updateDispatch } from './dispatchStore.js'

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
