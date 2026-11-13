import test from 'node:test'
import assert from 'node:assert/strict'
import { canDispatch, validateDispatchRequest } from './dispatchPolicy.js'

const session = {
  authorizationStatus: 'active',
  functionalRole: 'direccion',
  capabilities: ['documents:write'],
  dependency: 'DSA',
}
const recipients = [
  { id: 'jefe-dsa', functionalRole: 'jefe-unidad', dependency: 'dsa', unit: { code: 'DSA-01', name: 'Unidad DSA' }, inboxNodeId: 'inbox-dsa', displayName: 'Jefatura DSA' },
  { id: 'jefe-dti', functionalRole: 'jefe-unidad', dependency: 'dti', unit: { code: 'DTI-01', name: 'Unidad DTI' }, inboxNodeId: 'inbox-dti', displayName: 'Jefatura DTI' },
  { id: 'specialist-dsa', functionalRole: 'especialista', dependency: 'dsa', inboxNodeId: 'inbox-specialist', displayName: 'Especialista DSA' },
]

test('allows only an active Dirección with write capability', () => {
  assert.equal(canDispatch(session), true)
  assert.equal(canDispatch({ ...session, functionalRole: 'jefe-unidad' }), false)
  assert.equal(canDispatch({ ...session, authorizationStatus: 'incomplete' }), false)
})

test('accepts multiple jefaturas from the sender dependency only', () => {
  const result = validateDispatchRequest({
    documentId: 'pdf-1',
    recipientUserIds: ['jefe-dsa'],
    instruction: 'Revisar y atender.',
    priority: 'Alta',
    requestKey: 'request-1',
  }, session, recipients)
  assert.deepEqual(result.recipients.map((recipient) => recipient.id), ['jefe-dsa'])
})

test('allows the equivalent DTI direction and keeps all selected recipients', () => {
  const dtiSession = { ...session, dependency: 'DTI' }
  const dtiRecipients = [
    { id: 'jefe-dti-1', functionalRole: 'jefe-unidad', dependency: 'dti', unit: { code: 'DTI-01', name: 'Unidad 1' }, inboxNodeId: 'inbox-1', displayName: 'Jefatura 1' },
    { id: 'jefe-dti-2', functionalRole: 'jefe-unidad', dependency: 'dti', unit: { code: 'DTI-02', name: 'Unidad 2' }, inboxNodeId: 'inbox-2', displayName: 'Jefatura 2' },
  ]
  const result = validateDispatchRequest({
    documentId: 'pdf-1',
    recipientUserIds: ['jefe-dti-1', 'jefe-dti-2'],
    instruction: 'Atender según corresponda.',
    priority: 'Normal',
    requestKey: 'request-dti',
  }, dtiSession, dtiRecipients)
  assert.deepEqual(result.recipients.map((recipient) => recipient.id), ['jefe-dti-1', 'jefe-dti-2'])
})

test('rejects other dependencies and non-jefatura recipients', () => {
  for (const recipientUserIds of [['jefe-dti'], ['specialist-dsa']]) {
    assert.throws(() => validateDispatchRequest({
      documentId: 'pdf-1',
      recipientUserIds,
      instruction: 'Revisar.',
      priority: 'Normal',
      requestKey: 'request-2',
    }, session, recipients), { message: 'DISPATCH_RECIPIENT_NOT_ALLOWED' })
  }
})
