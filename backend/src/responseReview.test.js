import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReviewEvent, validateReviewProcesses, reviewHash, proposalMetadataHash, verifyProposalPdf } from './responseReview.js'
import { parseAssignments, maxAssignmentBytes } from './alfrescoDispatchRepository.js'
import { createResponseProposalOperations } from './responseProposalOperations.js'
import { createDocumentQueue } from './documentQueue.js'

export const pdf = Buffer.from('%PDF-1.7 test')
export const metadata = { properties: { 'cm:title': 'Propuesta' } }
export const snapshot = { versionId: '1.0', contentSha256: reviewHash(pdf), metadataSha256: proposalMetadataHash(metadata) }
export const initial = () => ({ schemaVersion: 1, id: 'process', originalDocumentId: 'original', proposalDocumentId: 'proposal',
  authorUserId: 'author', authorRole: 'direccion', dependency: 'dsa', assignmentId: null,
  revision: 0, state: 'BORRADOR', snapshot: null, events: [], approval: null, emissionDocumentId: null })
export const event = (action, expectedRevision, overrides = {}) => ({ id: `event-${expectedRevision}`, requestKey: `key-${expectedRevision}`, action,
  actorUserId: 'author', actorRole: 'direccion', dependency: 'dsa', at: '2026-11-19T15:00:00Z', expectedRevision,
  snapshot: action === 'CREATE' || action === 'REVISE' ? snapshot : null, reason: '', emissionDocumentId: null, ...overrides })
export const authority = { verified: true, supervisorVerified: true, emissionVerified: true }
export const draft = () => applyReviewEvent(initial(), event('CREATE', 0), authority)
export const envelope = (processes) => ({ schemaVersion: 1, revision: 0, documentId: 'original', dispatches: [], history: [], ...(processes ? { reviewProcesses: processes } : {}) })

test('legacy envelope and absent review processes stay compatible; strict processes replay history', () => {
  assert.deepEqual(parseAssignments(JSON.stringify(envelope()), 'original'), envelope())
  assert.deepEqual(parseAssignments(undefined, 'original'), envelope())
  assert.doesNotThrow(() => parseAssignments(JSON.stringify(envelope([draft()])), 'original'))
  for (const change of [{ unknown: true }, { state: 'APROBADA' }, { revision: 5 }, { originalDocumentId: 'foreign' }, { events: [] }, { authorRole: 'especialista' }]) {
    assert.throws(() => validateReviewProcesses([{ ...draft(), ...change }], 'original', new Map()))
  }
  assert.throws(() => parseAssignments(JSON.stringify({ ...envelope(), padding: 'x'.repeat(maxAssignmentBytes) }), 'original'))
})

test('expected revisions, idempotency, authority, history and global attention invariants', () => {
  const p = draft(); const raw = structuredClone(p)
  assert.equal(applyReviewEvent(p, event('CREATE', 0), authority), p)
  assert.equal(applyReviewEvent(p, Object.fromEntries(Object.entries(event('CREATE', 0)).reverse()), authority), p)
  assert.throws(() => applyReviewEvent(p, event('CREATE', 0, { reason: 'changed' }), authority), /IDEMPOTENCY/)
  assert.throws(() => applyReviewEvent(p, event('SUBMIT', 0, { id: 'stale', requestKey: 'stale' }), authority), /STALE/)
  assert.throws(() => applyReviewEvent(p, event('SUBMIT', 1), {}), /AUTHORITY/)
  assert.deepEqual(p, raw)
  const original = { properties: { 'gd:estado': 'PENDIENTE' }, assignments: [{ status: 'ASIGNADO' }] }
  const before = JSON.stringify(original)
  const submitted = applyReviewEvent(p, event('SUBMIT', 1), authority)
  assert.throws(() => applyReviewEvent(submitted, event('APPROVE', 2), authority), /SELF_APPROVAL/)
  const approved = applyReviewEvent(submitted, event('APPROVE', 2, { actorUserId: 'director-reviewer' }), authority)
  assert.equal(approved.approval.contentSha256, snapshot.contentSha256)
  const revised = applyReviewEvent(approved, event('REVISE', 3, { snapshot: { ...snapshot, versionId: '2.0' } }), authority)
  assert.equal(revised.approval, null); assert.equal(revised.events.length, 4)
  assert.equal(revised.state, 'BORRADOR'); assert.equal(JSON.stringify(original), before)
  assert.throws(() => applyReviewEvent(approved, event('REVISE', 3), authority), /VERSION_ALREADY/)
  assert.doesNotThrow(() => validateReviewProcesses([revised], 'original', new Map()))
  const emitted = applyReviewEvent(approved, event('EMIT', 3, { actorUserId: 'director-reviewer', emissionDocumentId: 'official' }), authority)
  assert.equal(emitted.state, 'EMITIDA')
  assert.throws(() => applyReviewEvent(emitted, event('REVISE', 4), authority), /TRANSITION/)
})

test('specialist review requires supervisor evidence; observation, resubmission, elevation and return', () => {
  const p = { ...initial(), authorRole: 'especialista', assignmentId: 'assignment' }
  const actor = { actorRole: 'especialista' }
  let next = applyReviewEvent(p, event('CREATE', 0, actor), authority)
  assert.throws(() => applyReviewEvent(next, event('SUBMIT', 1, actor), { verified: true }), /HIERARCHY_PENDING/)
  next = applyReviewEvent(next, event('SUBMIT', 1, actor), authority)
  next = applyReviewEvent(next, event('OBSERVE', 2, { actorRole: 'jefe-unidad', actorUserId: 'head', reason: 'Corregir' }), authority)
  assert.equal(next.state, 'OBSERVADA')
  next = applyReviewEvent(next, event('REVISE', 3, { ...actor, snapshot: { ...snapshot, versionId: '2.0' } }), authority)
  next = applyReviewEvent(next, event('SUBMIT', 4, actor), authority)
  next = applyReviewEvent(next, event('ELEVATE', 5, { actorRole: 'jefe-unidad', actorUserId: 'head' }), authority)
  next = applyReviewEvent(next, event('RETURN', 6, { actorRole: 'direccion', actorUserId: 'direction', reason: 'Completar' }), authority)
  assert.equal(next.state, 'OBSERVADA')
})

test('PDF must be nonempty, signed and match the exact content hash', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('not PDF'), Buffer.from('%PDF-altered')]) assert.throws(() => verifyProposalPdf(bytes, snapshot.contentSha256))
  assert.doesNotThrow(() => verifyProposalPdf(pdf, snapshot.contentSha256))
})

test('production writes are disabled; simulation queue serializes, retries, restart and uncertain writes reconcile', async () => {
  await assert.rejects(createResponseProposalOperations().execute(initial(), event('CREATE', 0), authority), /WRITES_DISABLED/)
  let stored
  const adapter = { simulationOnly: true, read: async () => stored, save: async (p) => { stored = structuredClone(p) } }
  const make = () => createResponseProposalOperations({ withDocument: createDocumentQueue(), simulationAdapter: adapter })
  const service = make()
  await Promise.all([service.execute(initial(), event('CREATE', 0), authority), service.execute(initial(), event('CREATE', 0), authority)])
  assert.equal(stored.events.length, 1)
  await make().execute(initial(), event('CREATE', 0), authority)
  const results = await Promise.allSettled([service.execute(initial(), event('SUBMIT', 1), authority), service.execute(initial(), event('SUBMIT', 1, { id: 'other', requestKey: 'other' }), authority)])
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1)
  adapter.save = async (p) => { stored = structuredClone(p); throw new Error('timeout') }
  const approval = event('APPROVE', 2, { actorUserId: 'reviewer' })
  await assert.rejects(service.execute(initial(), approval, authority), /timeout/)
  assert.equal((await service.execute(initial(), approval, authority)).state, 'APROBADA')
})
