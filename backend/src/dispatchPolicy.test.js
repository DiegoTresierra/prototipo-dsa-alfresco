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
  { id: 'jefe-dsa', functionalRole: 'jefe-unidad', dependency: 'dsa', unit: { code: 'DSA-01', name: 'Unidad DSA', dependency: 'DSA' }, inboxNodeId: 'inbox-dsa', displayName: 'Jefatura DSA' },
  { id: 'jefe-dti', functionalRole: 'jefe-unidad', dependency: 'dti', unit: { code: 'DTI-01', name: 'Unidad DTI', dependency: 'DTI' }, inboxNodeId: 'inbox-dti', displayName: 'Jefatura DTI' },
  { id: 'specialist-dsa', functionalRole: 'especialista', dependency: 'dsa', inboxNodeId: 'inbox-specialist', displayName: 'Especialista DSA' },
]

test('allows active Dirección and Jefatura with write capability, never Especialista', () => {
  assert.equal(canDispatch(session), true)
  assert.equal(canDispatch({ ...session, functionalRole: 'jefe-unidad' }), true)
  assert.equal(canDispatch({ ...session, functionalRole: 'especialista' }), false)
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
    { id: 'jefe-dti-1', functionalRole: 'jefe-unidad', dependency: 'dti', unit: { code: 'DTI-01', name: 'Unidad 1', dependency: 'DTI' }, inboxNodeId: 'inbox-1', displayName: 'Jefatura 1' },
    { id: 'jefe-dti-2', functionalRole: 'jefe-unidad', dependency: 'dti', unit: { code: 'DTI-02', name: 'Unidad 2', dependency: 'DTI' }, inboxNodeId: 'inbox-2', displayName: 'Jefatura 2' },
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

test('rejects other dependencies', () => {
  for (const recipientUserIds of [['jefe-dti']]) {
    assert.throws(() => validateDispatchRequest({
      documentId: 'pdf-1',
      recipientUserIds,
      instruction: 'Revisar.',
      priority: 'Normal',
      requestKey: 'request-2',
    }, session, recipients), { message: 'DISPATCH_RECIPIENT_NOT_ALLOWED' })
  }
})

const request = (recipientUserIds, originAssignmentId = null) => ({ documentId: 'original-uuid', recipientUserIds, instruction: 'Atender', priority: 'Normal', requestKey: 'retry', originAssignmentId })

test('both dependencies apply the complete hierarchy without a user-unit mapping', () => {
  for (const dependency of ['DSA', 'DTI']) {
    const sender = { ...session, dependency }
    const candidates = ['direccion', 'jefe-unidad', 'especialista'].map((functionalRole) => ({ id: functionalRole, functionalRole, dependency: dependency.toLowerCase(), unit: null }))
    assert.equal(validateDispatchRequest(request(['jefe-unidad', 'especialista']), sender, candidates).recipients.length, 2)
    const head = { ...sender, functionalRole: 'jefe-unidad' }
    assert.equal(validateDispatchRequest(request(['especialista'], 'own-assignment'), head, candidates).originAssignmentId, 'own-assignment')
    for (const role of ['direccion', 'jefe-unidad']) {
      assert.throws(() => validateDispatchRequest(request([role], 'own-assignment'), head, candidates), /DISPATCH_RECIPIENT_NOT_ALLOWED/)
    }
    assert.throws(() => validateDispatchRequest(request(['especialista']), head, candidates), /DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED/)
    assert.throws(() => validateDispatchRequest(request(['especialista']), { ...sender, functionalRole: 'especialista' }, candidates), /HIERARCHICAL_DISPATCH_REQUIRED/)
    assert.throws(() => validateDispatchRequest(request(['especialista'], 'foreign-assignment'), sender, candidates), /INVALID_DISPATCH_ORIGIN/)
  }
})
