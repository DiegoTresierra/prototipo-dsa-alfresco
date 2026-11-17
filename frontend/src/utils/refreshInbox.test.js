import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshInboxSources } from './refreshInbox.js'
import { collectInboxPages } from './inboxPages.js'

test('every inbox refresh queries documents and dispatches, including new assignments', async () => {
  let documentCalls = 0
  let dispatchCalls = 0
  let dispatches = []
  const refresh = () => refreshInboxSources(async () => { documentCalls++; return ['same-uuid'] }, async () => { dispatchCalls++; dispatches = ['new-dispatch'] })
  await refresh()
  await refresh()
  assert.equal(documentCalls, 2)
  assert.equal(dispatchCalls, 2)
  assert.deepEqual(dispatches, ['new-dispatch'])
})

test('assignment failures reject refresh instead of reporting an empty inbox; both sources still run', async () => {
  let documentCalls = 0
  await assert.rejects(refreshInboxSources(async () => { documentCalls++; return [] }, async () => { throw new Error('assignment read failed') }), /assignment read failed/)
  assert.equal(documentCalls, 1)
})

test('inbox collects later authorized pages so a new assignment is not hidden after page one', async () => {
  const offsets = []
  const entries = await collectInboxPages(async (skipCount) => {
    offsets.push(skipCount)
    return { list: { entries: [{ entry: { id: skipCount ? 'new-assigned-uuid' : 'existing-uuid' } }], pagination: { hasMoreItems: skipCount === 0 } } }
  }, true)
  assert.deepEqual(offsets, [0, 1])
  assert.deepEqual(entries.map(({ entry }) => entry.id), ['existing-uuid', 'new-assigned-uuid'])
  await assert.rejects(collectInboxPages(async () => ({ list: { entries: [], pagination: { hasMoreItems: true } } }), true), /ALFRESCO_INVALID_LIST_RESPONSE/)
})
