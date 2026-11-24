import test from 'node:test'
import assert from 'node:assert/strict'
import { createAlfrescoDispatchRepository, assignmentProperty } from './alfrescoDispatchRepository.js'
import { attentionFixture, actor, originalId, responseId } from './testFixtures/attention.js'
import { attentionSummary } from './attentionPolicy.js'
import { documentIdentity } from './documentIdentity.js'

test('Jefatura and Especialista attend only their own assignments; other obligations and global state remain independent', async () => {
  const f = attentionFixture()
  const root = await f.seed()
  const input = { documentId: originalId, assignmentId: root.recipients[0].id, requestKey: 'attend-head', responseDocumentId: null }
  const result = await f.repository.attendAssignment(input, actor('head', 'jefe-unidad'))
  assert.equal(result.assignment.status, 'ATENDIDO')
  assert.equal(result.assignment.attendedByUserId, 'head')
  assert.ok(result.assignment.attendedAt)
  assert.equal(result.dispatch.recipients[1].status, 'ASIGNADO')
  assert.equal(result.summary.readyForClosureReview, false)
  assert.equal(f.nodes.get(originalId).properties['gd:estado'], 'unchanged')
  assert.deepEqual(f.nodes.get(originalId).properties['gd:responsablesActuales'], ['staff'])
  const same = await f.repository.attendAssignment(input, actor('head', 'jefe-unidad'))
  assert.equal(same.assignment.attendedAt, result.assignment.attendedAt)
  await assert.rejects(f.repository.attendAssignment({ ...input, responseDocumentId: responseId }, actor('head', 'jefe-unidad')), /REQUEST_CONFLICT/)
  assert.equal(f.envelope().history.filter((event) => event.action === 'ASSIGNMENT_ATTENDED').length, 1)
  const restarted = createAlfrescoDispatchRepository(f.settings, f.fetchImpl)
  assert.equal((await restarted.loadInbox(actor('head', 'jefe-unidad'))).dispatches[0].recipients[0].status, 'ATENDIDO')
  const final = await restarted.attendAssignment({ ...input, assignmentId: root.recipients[1].id, requestKey: 'attend-staff' }, actor('staff', 'especialista'))
  assert.equal(final.summary.readyForClosureReview, true)
  assert.equal(final.summary.formalClosureAllowed, false)
  assert.deepEqual(f.nodes.get(originalId).properties['gd:responsablesActuales'], [])
})

test('wrong owner, wrong role, ACL denial, missing technical update and non-institutional UUIDs are rejected', async () => {
  const f = attentionFixture()
  const root = await f.seed()
  const input = { documentId: originalId, assignmentId: root.recipients[0].id, requestKey: 'denied', responseDocumentId: null }
  await assert.rejects(f.repository.attendAssignment(input, actor('staff', 'especialista')), /NOT_OWNED/)
  await assert.rejects(f.repository.attendAssignment(input, actor('head', 'especialista')), /NOT_OWNED/)
  f.state.denyActor = true
  await assert.rejects(f.repository.attendAssignment(input, actor('head', 'jefe-unidad')), /READ_DENIED/)
  f.state.denyActor = false
  f.nodes.get(originalId).allowableOperations = []
  await assert.rejects(f.repository.attendAssignment(input, actor('head', 'jefe-unidad')), /UPDATE_DENIED/)
  f.nodes.get(originalId).allowableOperations = ['update']
  f.folders.get('dsa-attention').clear()
  await assert.rejects(f.repository.attendAssignment(input, actor('head', 'jefe-unidad')), /DOCUMENT_NOT_ALLOWED/)
  assert.equal(f.envelope().dispatches[0].recipients[0].status, 'ASIGNADO')
})

test('chained specialist attention never completes Jefatura; concurrent own completions preserve all events', async () => {
  const f = attentionFixture()
  const root = await f.seed()
  const child = await f.repository.withDocument(originalId, () => f.repository.createDispatch({ documentId: originalId,
    senderUserId: 'head', senderRole: 'jefe-unidad', senderDependency: 'dsa', originAssignmentId: root.recipients[0].id,
    requestKey: 'child', instruction: 'Parte específica', priority: 'Normal', recipients: [{ id: 'staff', dependency: 'dsa', functionalRole: 'especialista' }],
  }, actor('head', 'jefe-unidad')))
  await f.repository.attendAssignment({ documentId: originalId, assignmentId: child.recipients[0].id, requestKey: 'child-done', responseDocumentId: null }, actor('staff', 'especialista'))
  assert.equal(f.envelope().dispatches[0].recipients[0].status, 'ASIGNADO')
  await Promise.all(root.recipients.map((assignment) => f.repository.attendAssignment({ documentId: originalId, assignmentId: assignment.id,
    requestKey: `complete-${assignment.id}`, responseDocumentId: null }, actor(assignment.userId, assignment.functionalRole))))
  assert.equal(f.envelope().history.filter((event) => event.action === 'ASSIGNMENT_ATTENDED').length, 3)
  assert.equal(attentionSummary(f.envelope()).readyForClosureReview, true)
})

test('Dirección can attend a pre-existing own assignment without introducing Dirección as a dispatch destination', async () => {
  const f = attentionFixture()
  await f.seed()
  const own = f.seedDirectionOwnAssignment()
  await assert.rejects(f.repository.withDocument(originalId, () => f.repository.createDispatch({ documentId: originalId, senderUserId: 'director', senderRole: 'direccion', senderDependency: 'dsa',
    requestKey: 'cannot-dispatch-to-direction', originAssignmentId: null, instruction: 'Forbidden destination', priority: 'Normal',
    recipients: [{ id: 'director', functionalRole: 'direccion', dependency: 'dsa' }],
  }, actor('director', 'direccion'))), /DISPATCH_RECIPIENT_NOT_ALLOWED/)
  assert.equal((await f.repository.attendAssignment({ documentId: originalId, assignmentId: own.id, requestKey: 'own', responseDocumentId: null }, actor('director', 'direccion'))).assignment.status, 'ATENDIDO')
})

test('response has independent UUID, existing cm:references, verified institutional issuer and explicit later attendance', async () => {
  const f = attentionFixture()
  await f.seed()
  const own = f.seedDirectionOwnAssignment()
  f.addResponse()
  const input = { documentId: originalId, assignmentId: own.id, requestKey: 'link', responseDocumentId: responseId }
  const result = await f.repository.linkResponse(input, actor('director', 'direccion'))
  assert.equal(result.assignment.status, 'ASIGNADO')
  assert.notEqual(result.assignment.responses[0].documentId, originalId)
  assert.equal(result.assignment.responses[0].originalDocumentId, originalId)
  assert.equal(result.assignment.responses[0].emitterDependency, 'dsa')
  assert.equal(result.assignment.responses[0].emittedByUserId, 'director')
  assert.ok(f.references.get(responseId).has(originalId))
  await f.repository.linkResponse(input, actor('director', 'direccion'))
  assert.equal(f.state.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/targets')).length, 1)
  const done = await f.repository.attendAssignment({ ...input, requestKey: 'attend-with-response' }, actor('director', 'direccion'))
  assert.equal(done.assignment.status, 'ATENDIDO')
  assert.equal(f.envelope().history.at(-1).mode, 'response')
  assert.equal((await f.repository.relatedResponses(originalId, actor('director', 'direccion'))).responses[0].available, true)
  await assert.rejects(f.repository.linkResponse({ ...input, requestKey: 'staff-cannot-link-foreign-assignment' }, actor('staff', 'especialista')), /NOT_OWNED/)
})

test('write errors preserve state, lost confirmation is idempotent, and partial response linkage can be recovered without emitting again', async () => {
  const f = attentionFixture()
  const root = await f.seed()
  const input = { documentId: originalId, assignmentId: root.recipients[0].id, requestKey: 'error', responseDocumentId: null }
  const raw = f.nodes.get(originalId).properties[assignmentProperty]
  f.state.originalPutStatus = 500
  await assert.rejects(f.repository.attendAssignment(input, actor('head', 'jefe-unidad')), /OUTCOME_UNKNOWN/)
  assert.equal(f.nodes.get(originalId).properties[assignmentProperty], raw)
  f.state.originalPutStatus = 200
  f.state.failAfterCommit = true
  await assert.rejects(f.repository.attendAssignment(input, actor('head', 'jefe-unidad')), /OUTCOME_UNKNOWN/)
  assert.equal((await f.repository.attendAssignment(input, actor('head', 'jefe-unidad'))).assignment.status, 'ATENDIDO')
  const g = attentionFixture(); await g.seed(); const own = g.seedDirectionOwnAssignment(); g.addResponse()
  const link = { documentId: originalId, assignmentId: own.id, requestKey: 'recover-link', responseDocumentId: responseId }
  g.state.originalPutStatus = 500
  await assert.rejects(g.repository.linkResponse(link, actor('director', 'direccion')), /LINK_PARTIAL/)
  assert.ok(g.references.get(responseId).has(originalId))
  assert.equal(g.envelope().dispatches[0].recipients[0].responses, undefined)
  g.state.originalPutStatus = 200
  await g.repository.linkResponse(link, actor('director', 'direccion'))
  assert.equal(g.envelope().dispatches[0].recipients[0].responses.length, 1)
})

test('original metadata DTI, dispatch DSA, repository creator and cm:author are separate; unknown origins are never invented', () => {
  const settings = attentionFixture().settings
  const identity = documentIdentity({ parentId: 'dti-emitted', createdByUser: { id: 'DTI_T' }, properties: { 'gd:dependenciaOrigen': 'DTI', 'cm:author': 'Home' } }, settings)
  assert.equal(identity.originalDependency, 'DTI')
  assert.equal(identity.createdByUserId, 'DTI_T')
  const unknown = documentIdentity({ parentId: 'dti-emitted', createdByUser: { id: 'DTI_T' }, properties: { 'cm:author': 'DSA' } }, settings)
  assert.equal(unknown.originalDependency, null)
  assert.deepEqual(unknown.emittedFolderEvidence, ['DTI'])
})

test('Dirección can respond within its institutional authority without fabricating an own assignment', async () => {
  const f = attentionFixture()
  const original = await f.seed()
  f.addResponse()
  const input = { documentId: originalId, assignmentId: null, requestKey: 'document-response', responseDocumentId: responseId }
  const result = await f.repository.linkResponse(input, actor('director', 'direccion'))
  assert.equal(result.assignment, null)
  assert.equal(result.dispatch, null)
  assert.deepEqual(f.envelope().dispatches[0], original)
  assert.equal(f.envelope().responses[0].originalDocumentId, originalId)
  assert.equal(f.envelope().history.at(-1).action, 'DOCUMENT_RESPONSE_LINKED')
  assert.deepEqual(f.envelope().history.at(-1).assignmentIds, [])
  await f.repository.linkResponse(input, actor('director', 'direccion'))
  assert.equal(f.envelope().responses.length, 1)
  assert.equal((await f.repository.relatedResponses(originalId, actor('director', 'direccion'))).responses[0].documentId, responseId)
  f.references.get(responseId).clear()
  await assert.rejects(f.repository.linkResponse(input, actor('director', 'direccion')), /LINK_PARTIAL/)
})

test('document-level responses work without any assignments and reject foreign, contradictory or forbidden emissions', async () => {
  const f = attentionFixture()
  f.addResponse()
  const input = { documentId: originalId, assignmentId: null, requestKey: 'no-assignments', responseDocumentId: responseId }
  f.nodes.get(responseId).createdByUser.id = 'other-director'
  await assert.rejects(f.repository.linkResponse(input, actor('director', 'direccion')), /NOT_OWN_EMISSION/)
  f.nodes.get(responseId).createdByUser.id = 'director'
  f.nodes.get(responseId).properties['gd:dependenciaOrigen'] = 'DTI'
  await assert.rejects(f.repository.linkResponse(input, actor('director', 'direccion')), /ORIGIN_CONFLICT/)
  f.nodes.get(responseId).properties['gd:dependenciaOrigen'] = 'DSA'
  f.state.associationStatus = 403
  await assert.rejects(f.repository.linkResponse(input, actor('director', 'direccion')), /REFERENCE_DENIED/)
  assert.equal(f.nodes.get(originalId).properties[assignmentProperty], undefined)
  f.state.associationStatus = 201
  const result = await f.repository.linkResponse(input, actor('director', 'direccion'))
  assert.equal(result.summary.total, 0)
  assert.equal(result.summary.readyForClosureReview, false)
  assert.equal(f.envelope().dispatches.length, 0)
  assert.equal(f.envelope().responses.length, 1)
})
