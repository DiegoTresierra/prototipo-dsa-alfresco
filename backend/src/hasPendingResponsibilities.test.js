import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hasPendingResponsibilities } from './hasPendingResponsibilities.js'
import { applyReviewEvent } from './responseReview.js'

const at = '2026-11-23T15:00:00.000Z'
const stamp = reference => ({ verified: true, source: 'alfresco', reference })
const scope = { unitId: 'unit-fixture', headUserId: 'head-fixture', dependency: 'dsa' }
const snapshot = { versionId: '1.0', contentSha256: 'a'.repeat(64), metadataSha256: 'b'.repeat(64) }
function envelope() { return { schemaVersion: 1, documentId: 'original-fixture', revision: 3, dispatches: [], history: [] } }
function assign(e, status = 'ASIGNADO', userId = scope.headUserId, role = 'jefe-unidad', origin = null) {
  const id = `dispatch-${e.dispatches.length}`
  const r = { id, documentId: e.documentId, requestKey: id, senderUserId: origin ? scope.headUserId : 'director-fixture',
    senderRole: origin ? 'jefe-unidad' : 'direccion', senderDependency: 'dsa', originAssignmentId: origin,
    instruction: 'Fixture', priority: 'Normal', createdAt: at, status: 'ASIGNADO', recipients: [] }
  const a = { id: `assignment-${id}`, documentId: e.documentId, dispatchId: id, userId, functionalRole: role,
    dependency: 'dsa', senderUserId: r.senderUserId, senderRole: r.senderRole, senderDependency: 'dsa',
    originAssignmentId: origin, instruction: r.instruction, createdAt: at, status }
  r.recipients.push(a); e.dispatches.push(r)
  e.history.push({ id: `created-${id}`, action: 'DISPATCH_CREATED', actorUserId: r.senderUserId, at, dispatchId: id, assignmentIds: [a.id] })
  if (status === 'ATENDIDO') {
    a.attendedAt = at; a.attendedByUserId = userId
    e.history.push({ id: `attended-${id}`, action: 'ASSIGNMENT_ATTENDED', actorUserId: userId, at,
      requestKey: `attend-${id}`, dispatchId: id, assignmentIds: [a.id] })
  }
  return a
}
function input(e = envelope()) {
  const hierarchy = { ...stamp('institutional-relation'), ...scope, complete: true, revision: 5, specialistUserIds: ['specialist-fixture'] }
  const rawAssignments = JSON.stringify(e)
  return { scope: { ...scope }, evaluatedAt: at, hierarchy, finalHierarchy: structuredClone(hierarchy),
    coverage: { ...stamp('inventory'), ...scope, complete: true, scopesComplete: true,
      method: 'DIRECT_CHILDREN_AND_RELATIONS', hierarchyRevision: 5, documentIds: [e.documentId] },
    documents: [{ documentId: e.documentId, rawAssignments, currentAssignments: rawAssignments, expectedRevision: e.revision,
      originalRead: { ...stamp('actor-get'), documentId: e.documentId },
      institutionalScope: { ...stamp('institutional-membership'), ...scope, documentId: e.documentId } }] }
}
const run = e => hasPendingResponsibilities(input(e))
const reason = (r, code) => assert.ok(r.blockingReasons.some(v => v.code === code), code)
function process(e, authorRole = 'especialista') {
  const authorUserId = authorRole === 'jefe-unidad' ? scope.headUserId : 'specialist-fixture'
  const a = assign(e, 'ATENDIDO', authorUserId, authorRole)
  const p = { schemaVersion: 1, id: 'process-fixture', originalDocumentId: e.documentId, proposalDocumentId: 'proposal-fixture',
    authorUserId, authorRole, dependency: 'dsa', assignmentId: a.id, revision: 0, state: 'BORRADOR', snapshot: null,
    events: [], approval: null, emissionDocumentId: null }
  return step(p, 'CREATE')
}
function step(p, action, actor = {}, recipient) {
  const event = { id: `event-${p.revision}`, requestKey: `request-${p.revision}`, action, actorUserId: p.authorUserId,
    actorRole: p.authorRole, dependency: p.dependency, at, expectedRevision: p.revision,
    snapshot: action === 'CREATE' ? snapshot : null, reason: action === 'OBSERVE' ? 'Corregir' : '', emissionDocumentId: null, ...actor }
  if (recipient !== undefined) event.review = { schemaVersion: 1, processId: p.id, affectedRevision: p.revision, snapshot: p.snapshot, recipient }
  return applyReviewEvent(p, event, { verified: true, reviewerVerified: true, supervisorVerified: true })
}

test('complete attested inventory without pending obligations yields NO_PENDING, never permission', () => {
  const e = envelope(); assign(e, 'ATENDIDO')
  const i = input(e), before = structuredClone(i), r = hasPendingResponsibilities(i)
  assert.equal(r.status, 'NO_PENDING'); assert.equal(r.hasPendingResponsibilities, false)
  assert.equal(r.headChangeAllowed, false); assert.equal(r.writesEnabled, false)
  assert.equal(r.hierarchyRevision, 5); assert.equal(r.documentRevisions[0].revision, 3)
  assert.ok(r.evidence[2].reference); assert.deepEqual(i, before)
})
test('pending assignment overrides incomplete coverage and relationships', () => {
  const e = envelope(); const a = assign(e); const i = input(e)
  i.coverage.complete = false; i.hierarchy.complete = false
  const r = hasPendingResponsibilities(i)
  assert.equal(r.status, 'HAS_PENDING'); assert.equal(r.hasPendingResponsibilities, true)
  assert.equal(r.pendingResponsibilities[0].assignmentId, a.id)
  reason(r, 'DOCUMENT_COVERAGE_INCOMPLETE')
})
test('shared responsibilities are evaluated individually', () => {
  const e = envelope(); assign(e, 'ATENDIDO', 'other-head-fixture'); assign(e, 'DESPACHADO')
  assert.equal(run(e).status, 'HAS_PENDING')
})
test('attended chained specialist never completes pending parent head assignment', () => {
  const e = envelope(); const parent = assign(e)
  assign(e, 'ATENDIDO', 'specialist-fixture', 'especialista', parent.id)
  const r = run(e); assert.equal(r.status, 'HAS_PENDING')
  assert.equal(r.specialistResponsibilities[0].attributedToHead, false)
})
test('specialist pending duties are separate from own head responsibilities', () => {
  const e = envelope(); assign(e, 'ASIGNADO', 'specialist-fixture', 'especialista')
  const r = run(e); assert.equal(r.status, 'NO_PENDING')
  assert.equal(r.specialistResponsibilities[0].pending, true)
})
test('current review routed to head blocks; old unrouted review cannot establish clearance', () => {
  for (const routed of [true, false]) {
    const e = envelope(); let p = process(e)
    p = step(p, 'SUBMIT', {}, routed ? { userId: scope.headUserId, functionalRole: 'jefe-unidad', dependency: 'dsa' } : undefined)
    e.reviewProcesses = [p]
    const r = run(e); assert.equal(r.status, routed ? 'HAS_PENDING' : 'INDETERMINATE')
    reason(r, routed ? 'HEAD_REVIEW_PENDING' : 'REVIEW_RECIPIENT_UNVERIFIED')
  }
})
test('observed proposal authored by head remains a current duty', () => {
  const e = envelope(); let p = process(e, 'jefe-unidad')
  p = step(p, 'SUBMIT', {}, { userId: 'director-fixture', functionalRole: 'direccion', dependency: 'dsa' })
  p = step(p, 'RETURN', { actorUserId: 'director-fixture', actorRole: 'direccion', reason: 'Corregir' },
    { userId: scope.headUserId, functionalRole: 'jefe-unidad', dependency: 'dsa' })
  e.reviewProcesses = [p]; const r = run(e)
  assert.equal(r.status, 'HAS_PENDING'); reason(r, 'HEAD_PROPOSAL_ACTION_PENDING')
})
test('approval pending with Direction does not invent a pending head review', () => {
  const e = envelope(); let p = process(e)
  p = step(p, 'SUBMIT', {}, { userId: scope.headUserId, functionalRole: 'jefe-unidad', dependency: 'dsa' })
  p = step(p, 'ELEVATE', { actorUserId: scope.headUserId, actorRole: 'jefe-unidad' },
    { userId: 'director-fixture', functionalRole: 'direccion', dependency: 'dsa' })
  e.reviewProcesses = [p]; assert.equal(run(e).status, 'NO_PENDING')
})
test('uncertain proposal operation by head requires reconciliation', () => {
  const e = envelope(); const requestKey = 'uncertain-fixture'
  e.reviewOperations = [{ schemaVersion: 1, id: createHash('sha256').update(JSON.stringify([e.documentId, scope.headUserId, requestKey])).digest('hex'),
    requestKey, actorUserId: scope.headUserId, dependency: 'dsa', action: 'CREATE', payloadHash: 'c'.repeat(64), expectedRevision: 0,
    processId: 'process-fixture', proposalDocumentId: null, previousVersionIds: [], phase: 'UNCERTAIN', at, snapshot: null }]
  const r = run(e); assert.equal(r.status, 'HAS_PENDING'); reason(r, 'HEAD_OPERATION_RECONCILIATION_REQUIRED')
})
test('cancelled state without verified authority is indeterminate', () => {
  const e = envelope(); assign(e, 'ANULADO'); const r = run(e)
  assert.equal(r.status, 'INDETERMINATE'); reason(r, 'CANCELLATION_AUTHORIZATION_UNVERIFIED')
})
test('existing trusted cancellation evidence can release an obligation', () => {
  const e = envelope(); const a = assign(e, 'ANULADO'); const i = input(e)
  i.documents[0].closureEvidence = { cancellations: { [a.id]: { schemaVersion: 1, ...stamp('cancel-event'), documentId: e.documentId,
    assignmentId: a.id, dependency: 'dsa', envelopeRevision: 3, reason: 'Duplicada', at,
    authorization: { ...stamp('competent-direction'), actorUserId: 'director-fixture', functionalRole: 'direccion', dependency: 'dsa', checkedAt: at } } } }
  assert.equal(hasPendingResponsibilities(i).status, 'NO_PENDING')
  i.documents[0].closureEvidence.cancellations[a.id].authorization.source = 'organization.json'
  assert.equal(hasPendingResponsibilities(i).status, 'INDETERMINATE')
})
test('foreign origin with verified secondary institutional membership retains attributable obligation', () => {
  const e = envelope(); assign(e); const i = input(e)
  i.documents[0].institutionalScope.reference = 'secondary-cm-contains-from-other-dependency'
  assert.equal(hasPendingResponsibilities(i).status, 'HAS_PENDING')
})
for (const [name, change, code] of [
  ['incomplete coverage', i => { i.coverage.complete = false }, 'DOCUMENT_COVERAGE_INCOMPLETE'],
  ['search without results', i => { i.documents = []; i.coverage.documentIds = []; i.coverage.method = 'SEARCH' }, 'DOCUMENT_COVERAGE_INCOMPLETE'],
  ['ambiguous relationships', i => { i.hierarchy.complete = false }, 'INSTITUTIONAL_RELATIONSHIPS_UNVERIFIED'],
  ['provisional hierarchy', i => { i.hierarchy.source = 'organization.json' }, 'INSTITUTIONAL_RELATIONSHIPS_UNVERIFIED'],
  ['head changed', i => { i.finalHierarchy.headUserId = 'replacement-fixture' }, 'HIERARCHY_CHANGED_OR_UNCONFIRMED'],
  ['hierarchy revision changed', i => { i.finalHierarchy.revision++ }, 'HIERARCHY_CHANGED_OR_UNCONFIRMED'],
  ['document revision stale', i => { i.documents[0].expectedRevision-- }, 'DOCUMENT_REVISION_STALE'],
  ['external edit same revision', i => { i.documents[0].currentAssignments += ' ' }, 'DOCUMENT_REVISION_STALE'],
  ['final GET absent', i => { delete i.documents[0].currentAssignments }, 'DOCUMENT_REVISION_STALE'],
  ['missing document', i => { i.documents = [] }, 'DOCUMENT_INVENTORY_MISMATCH'],
  ['ACL inaccessible', i => { i.documents[0].originalRead.verified = false }, 'DOCUMENT_ACCESS_OR_SCOPE_UNVERIFIED'],
  ['wrong UUID evidence', i => { i.documents[0].originalRead.documentId = 'different-fixture' }, 'DOCUMENT_ACCESS_OR_SCOPE_UNVERIFIED'],
  ['malformed envelope', i => { i.documents[0].rawAssignments = '{' }, 'DOCUMENT_ENVELOPE_INVALID'],
  ['unknown contract', i => { const e = envelope(); e.schemaVersion = 9; i.documents[0].rawAssignments = JSON.stringify(e) }, 'DOCUMENT_ENVELOPE_INVALID'],
]) test(`${name} cannot produce NO_PENDING`, () => {
  const i = input(); change(i); const r = hasPendingResponsibilities(i)
  assert.equal(r.status, 'INDETERMINATE'); reason(r, code)
})
test('empty complete direct inventory is distinct from empty search', () => {
  const i = input(); i.documents = []; i.coverage.documentIds = []
  assert.equal(hasPendingResponsibilities(i).status, 'NO_PENDING')
})
test('historical attendance without its completion trace is indeterminate', () => {
  const e = envelope(); assign(e, 'ATENDIDO'); e.history = e.history.filter(e => e.action !== 'ASSIGNMENT_ATTENDED')
  reason(run(e), 'ATTENDANCE_EVIDENCE_INCOMPLETE'); assert.equal(run(e).status, 'INDETERMINATE')
})
test('envelope extensions and unknown data remain untouched', () => {
  const e = envelope(); e.futureExtension = { opaque: ['fixture'] }
  const before = JSON.stringify(e); assert.equal(run(e).status, 'NO_PENDING'); assert.equal(JSON.stringify(e), before)
})
test('stale pending snapshot is indeterminate; another fresh pending document still takes precedence', () => {
  const e = envelope(); assign(e); const i = input(e)
  i.documents[0].expectedRevision--
  assert.equal(hasPendingResponsibilities(i).status, 'INDETERMINATE')
  const other = envelope(); other.documentId = 'second-original-fixture'; assign(other)
  i.documents.push(input(other).documents[0]); i.coverage.documentIds.push(other.documentId)
  const r = hasPendingResponsibilities(i)
  assert.equal(r.status, 'HAS_PENDING'); reason(r, 'DOCUMENT_REVISION_STALE')
})
test('full envelope size limit and malformed known extensions cannot establish clearance', () => {
  for (const extension of [{ future: 'x'.repeat(256 * 1024) }, { reviewProcesses: {} }, { closureEvidence: {} }]) {
    const e = { ...envelope(), ...extension }; const r = run(e)
    assert.equal(r.status, 'INDETERMINATE'); reason(r, 'DOCUMENT_ENVELOPE_INVALID')
  }
})
