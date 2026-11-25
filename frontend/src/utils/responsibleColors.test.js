import test from 'node:test'
import assert from 'node:assert/strict'
import { responsibleColor } from './responsibleColors.js'
import { loadAssignmentInbox } from './assignmentInbox.js'
import { documentResponsibilities } from './dispatchPersistence.js'

test('synthetic DSA fixture IDs have stable distinguishable colors, independent of role, document and session', () => {
  const ids = ['fixture_head_a', 'fixture_head_b', 'specialist.fixture.1@example.invalid']
  const colors = ids.map(responsibleColor)
  assert.equal(new Set(colors).size, 3)
  const hues = colors.map((color) => Number(color.match(/hsl\((\d+)/)[1]))
  for (let a = 0; a < hues.length; a++) for (let b = a + 1; b < hues.length; b++) {
    const distance = Math.abs(hues[a] - hues[b])
    assert.ok(Math.min(distance, 360 - distance) >= 40)
  }
  assert.deepEqual(ids.map(responsibleColor), colors)
})

test('backend bundle retains persistence through loading into the actual UI responsibility filter', async () => {
  const payload = { persistence: 'alfresco', dispatches: [{ documentId: '11111111-2222-4333-8444-2a29efcb482b', recipients: [
    { userId: 'fixture_head_a', status: 'ASIGNADO' }, { userId: 'fixture_head_b', status: 'ANULADO' },
  ] }], sentDispatches: [], documents: [], documentErrors: [] }
  const result = await loadAssignmentInbox(async () => Response.json(payload), (node) => node)
  assert.deepEqual(documentResponsibilities(result.dispatchRecords, payload.dispatches[0].documentId, true).map((item) => item.userId), ['fixture_head_a'])
  await assert.rejects(loadAssignmentInbox(async () => Response.json({ ...payload, persistence: undefined }), (node) => node), /backend no informa/)
})
