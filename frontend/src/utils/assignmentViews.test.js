import test from 'node:test'
import assert from 'node:assert/strict'
import { assignmentRows, canDeriveAssignment } from './assignmentViews.js'
import { loadAssignmentInbox } from './assignmentInbox.js'

const assignment = (id, userId, functionalRole) => ({ id, userId, functionalRole, status: 'ASIGNADO', unit: null })
const records = [
  { id: 'root', documentId: 'same-uuid', senderUserId: 'director', recipients: [assignment('head-assignment', 'head', 'jefe-unidad'), assignment('direct-specialist', 'specialist', 'especialista')] },
  { id: 'child', documentId: 'same-uuid', senderUserId: 'head', originAssignmentId: 'head-assignment', recipients: [assignment('chained-specialist', 'specialist', 'especialista')] },
]

test('specialist rows preserve separate direct and chained assignments over one original document', () => {
  const rows = assignmentRows(records, 'specialist')
  assert.deepEqual(rows.map(({ assignment }) => assignment.id), ['direct-specialist', 'chained-specialist'])
  assert.equal(new Set(rows.map(({ dispatch }) => dispatch.documentId)).size, 1)
  assert.ok(rows.every(({ assignment }) => !canDeriveAssignment([], assignment, 'specialist')))
})

test('only a received attention assignment owned by Jefatura exposes the derive action; sent items stay separate', () => {
  const incoming = assignmentRows(records, 'head')
  assert.equal(incoming.length, 1)
  assert.equal(canDeriveAssignment(['especialista'], incoming[0].assignment, 'head'), true)
  assert.equal(canDeriveAssignment(['especialista'], incoming[0].assignment, 'another-head'), false)
  assert.equal(canDeriveAssignment(['especialista'], { ...incoming[0].assignment, status: 'ATENDIDO' }, 'head'), false)
  assert.deepEqual(assignmentRows(records, 'head', 'sent').map(({ dispatch }) => dispatch.id), ['child'])
})

test('each refresh requests assignments and original metadata together, without any personal folder configuration', async () => {
  const calls = []
  const fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ persistence: 'alfresco', dispatches: records, sentDispatches: [], documents: [{ id: 'same-uuid' }], documentErrors: [] }) }
  }
  const first = await loadAssignmentInbox(fetch, (node) => node)
  const second = await loadAssignmentInbox(fetch, (node) => node)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(({ url }) => url === '/api/documents/dispatches?include=documents'))
  assert.equal(first.documents[0].id, second.dispatchRecords[0].documentId)
})

test('an assignment read failure rejects the snapshot; a PDF denial retains the assignment and an explicit document error', async () => {
  await assert.rejects(loadAssignmentInbox(async () => Response.json({ error: 'DISPATCH_STORE_UNAVAILABLE' }, { status: 503 }), (node) => node), /No se pudieron consultar/)
  const snapshot = await loadAssignmentInbox(async () => ({ ok: true, json: async () => ({ persistence: 'alfresco', dispatches: records, sentDispatches: [], documents: [], documentErrors: [{ documentId: 'same-uuid', error: 'DOCUMENT_READ_NOT_ALLOWED' }] }) }), (node) => node)
  assert.equal(snapshot.dispatchRecords.length, 2)
  assert.equal(snapshot.documentErrors.length, 1)
})
