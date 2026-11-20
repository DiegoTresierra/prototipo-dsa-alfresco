import test from 'node:test'
import assert from 'node:assert/strict'
import { getAlfrescoGroupMembers } from './alfrescoClient.js'

test('the retained v1 client enumerates every member page and rejects incomplete contracts', async () => {
  const original = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url) => {
      const u = new URL(url)
      assert.equal(u.hostname, 'members.invalid')
      const skip = Number(u.searchParams.get('skipCount'))
      calls.push(skip)
      return Response.json({ list: { entries: [{ entry: { id: skip === 0 ? 'first' : 'second' } }], pagination: { skipCount: skip, hasMoreItems: skip === 0 } } })
    }
    assert.deepEqual((await getAlfrescoGroupMembers('https://members.invalid', 'GROUP_EXACT', 'fixture')).map((person) => person.id), ['first', 'second'])
    assert.deepEqual(calls, [0, 1])
    globalThis.fetch = async () => Response.json({ list: { entries: [] } })
    await assert.rejects(getAlfrescoGroupMembers('https://members.invalid', 'GROUP_EXACT', 'fixture'), /INVALID_RESPONSE/)
  } finally { globalThis.fetch = original }
})
