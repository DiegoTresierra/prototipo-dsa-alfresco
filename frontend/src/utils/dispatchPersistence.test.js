import test from 'node:test'
import assert from 'node:assert/strict'
import { documentResponsibilities, dispatchPersistenceError, withDispatchPersistence } from './dispatchPersistence.js'
import { loadAssignmentInbox } from './assignmentInbox.js'

test('shows all equivalent responsibilities from successive dispatches, without selecting a principal', () => {
  const records = [
    { documentId: 'pdf', recipients: [{ userId: 'head', status: 'ASIGNADO' }] },
    { documentId: 'pdf', recipients: [{ userId: 'staff', status: 'ASIGNADO' }, { userId: 'head', status: 'ASIGNADO' }] },
    { documentId: 'other', recipients: [{ userId: 'foreign', status: 'ASIGNADO' }] },
  ]
  assert.deepEqual(documentResponsibilities(records, 'pdf').map((recipient) => recipient.userId), ['head', 'staff'])
})

test('missing model produces a visible error, not an empty inbox', async () => {
  await assert.rejects(loadAssignmentInbox(async () => Response.json({ error: 'DISPATCH_ALFRESCO_MODEL_NOT_READY' }, { status: 503 }), (value) => value), /falta desplegar/)
  assert.match(dispatchPersistenceError('DISPATCH_WRITE_OUTCOME_UNKNOWN'), /Verifica el resultado/)
})

test('official responsibilities require Alfresco provenance from the response, never a provisional record flag', () => {
  const records = [{ documentId: 'pdf', persistence: 'alfresco', recipients: [{ userId: 'head', status: 'ASIGNADO' }] }]
  assert.equal(documentResponsibilities(withDispatchPersistence(records, 'local'), 'pdf', true).length, 0)
  assert.equal(documentResponsibilities(withDispatchPersistence(records, undefined), 'pdf', true).length, 0)
  assert.equal(documentResponsibilities(withDispatchPersistence(records, 'alfresco'), 'pdf', true).length, 1)
})
