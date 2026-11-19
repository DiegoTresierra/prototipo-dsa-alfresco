import test from 'node:test'
import assert from 'node:assert/strict'
import { responsibleColor } from './responsibleColors.js'
import { loadAssignmentInbox } from './assignmentInbox.js'
import { documentResponsibilities } from './dispatchPersistence.js'

test('real DSA IDs have stable distinguishable colors, independent of role, document and session', () => {
  const ids = ['JEFE_UNIDAD_DSA_1', 'JEFE_UNIDAD_DSA_2', '021200931d@uandina.edu.pe']
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
  const payload = { persistence: 'alfresco', dispatches: [{ documentId: '18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097', recipients: [
    { userId: 'JEFE_UNIDAD_DSA_1', status: 'ASIGNADO' }, { userId: 'JEFE_UNIDAD_DSA_2', status: 'ANULADO' },
  ] }], sentDispatches: [], documents: [], documentErrors: [] }
  const result = await loadAssignmentInbox(async () => Response.json(payload), (node) => node)
  assert.deepEqual(documentResponsibilities(result.dispatchRecords, payload.dispatches[0].documentId, true).map((item) => item.userId), ['JEFE_UNIDAD_DSA_1'])
  await assert.rejects(loadAssignmentInbox(async () => Response.json({ ...payload, persistence: undefined }), (node) => node), /backend no informa/)
})
