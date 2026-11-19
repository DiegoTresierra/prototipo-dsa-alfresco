import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocumentQueue } from './documentQueue.js'

test('per-UUID queue waits through verification, releases on rejection and does not block another UUID', async () => {
  const queue = createDocumentQueue()
  const events = []
  let releaseFirst
  const gate = new Promise((resolve) => { releaseFirst = resolve })
  const first = queue('pdf-a', async () => { events.push('read-a'); await gate; events.push('verify-a'); throw new Error('failure') })
  const second = queue('pdf-a', async () => { events.push('read-a2') })
  await queue('pdf-b', async () => { events.push('read-b') })
  assert.deepEqual(events, ['read-a', 'read-b'])
  releaseFirst()
  await assert.rejects(first, /failure/)
  await second
  assert.deepEqual(events, ['read-a', 'read-b', 'verify-a', 'read-a2'])
})
