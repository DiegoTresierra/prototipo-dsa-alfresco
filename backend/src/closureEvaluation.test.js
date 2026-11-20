import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateClosure } from './closureEvaluation.js'

const assignment = (id, status, dependency = 'dsa', originAssignmentId = null) => ({ id, status, dependency, originAssignmentId })
const evaluate = (assignments, extra = {}) => evaluateClosure({
  envelope: { documentId: 'original', revision: 2, dispatches: [{ recipients: assignments }], ...extra.envelope },
  scope: extra.scope || { type: 'dependency', dependency: 'dsa' },
  evidence: { originalRead: true, institutionalScope: true, projections: true, ...extra.evidence }, evaluatedAt: '2026-11-20T15:00:00Z' })

test('one attended obligation meets only preliminary requirements and never grants formal closure', () => {
  const result = evaluate([assignment('a', 'ATENDIDO')])
  assert.equal(result.preliminaryCompliance, 'MET')
  assert.equal(result.formalClosureAllowed, false)
  assert.equal(result.canRequestFormalClosure, false)
  assert.equal(result.writesEnabled, false)
})
for (const status of ['ASIGNADO', 'DESPACHADO']) test(`pending ${status} blocks multiple equivalent recipients`, () => {
  assert.equal(evaluate([assignment('a', 'ATENDIDO'), assignment('b', status)]).preliminaryCompliance, 'BLOCKED')
})
test('same UUID has independent dependency summaries and an integral view', () => {
  const a = [assignment('a', 'ATENDIDO'), assignment('b', 'ASIGNADO', 'dti')]
  assert.equal(evaluate(a).summary.total, 1)
  assert.equal(evaluate(a).preliminaryCompliance, 'MET')
  assert.equal(evaluate(a, { scope: { type: 'document' } }).preliminaryCompliance, 'BLOCKED')
  assert.equal(evaluate(a, { scope: { type: 'dependency', dependency: 'dti' } }).summary.pending, 1)
})
test('cancellation state without evidence is indeterminate and remains exigible', () => {
  const r = evaluate([assignment('a', 'ANULADO')])
  assert.equal(r.preliminaryCompliance, 'INDETERMINATE')
  assert.equal(r.summary.exigible, 1)
  assert.ok(r.blockingReasons.includes('CANCELLATION_EVIDENCE_MISSING'))
})
test('attended child never completes its pending origin', () => {
  assert.equal(evaluate([assignment('parent', 'ASIGNADO'), assignment('child', 'ATENDIDO', 'dsa', 'parent')]).summary.pending, 1)
  assert.ok(evaluate([assignment('child', 'ATENDIDO', 'dsa', 'missing')]).blockingReasons.includes('ORIGIN_ASSIGNMENT_INCONSISTENT'))
})
test('empty historical envelope and knowledge-only documents are indeterminate', () => {
  for (const evidence of [{}, { knowledgeOnly: true }]) assert.equal(evaluate([], { evidence }).preliminaryCompliance, 'INDETERMINATE')
})
for (const state of ['BORRADOR', 'OBSERVADA', 'EN_REVISION_JEFATURA', 'EN_REVISION_DIRECCION', 'APROBADA', 'EMITIDA']) {
  test(`verified optional proposal ${state} does not imply satisfaction or require universal emission`, () => {
    const result = evaluate([assignment('a', 'ATENDIDO')], { envelope: { reviewProcesses: [{ id: 'p', state, dependency: 'dsa' }] }, evidence: { proposals: { p: true } } })
    assert.equal(result.preliminaryCompliance, 'MET')
    assert.equal(evaluate([assignment('a', 'ASIGNADO')], { envelope: { reviewProcesses: [{ id: 'p', state, dependency: 'dsa' }] } }).summary.pending, 1)
  })
}
test('a verified optional reference does not create a universal response requirement', () => {
  const r = evaluate([assignment('a', 'ATENDIDO')], { envelope: { responses: [{ emitterDependency: 'dsa' }] }, evidence: { responsesVerified: true } })
  assert.equal(r.preliminaryCompliance, 'MET')
  assert.equal(r.formalClosureAllowed, false)
})

// Synthetic server attestations, not client payloads or real institutional authorizations.
const attest = (reference) => ({ verified: true, source: 'alfresco', reference })
const cancellation = (id = 'a', dependency = 'dsa') => ({ schemaVersion: 1, ...attest('cancellation-record'),
  documentId: 'original', assignmentId: id, envelopeRevision: 2, dependency, reason: 'Obligación duplicada', at: '2026-11-20T14:00:00Z',
  authorization: { ...attest('institutional-authority'), actorUserId: 'direction-fixture', functionalRole: 'direccion', dependency, checkedAt: '2026-11-20T15:00:00Z' } })
const knowledge = (confirmed = ['recipient-a', 'recipient-b'], exclusive = true) => ({ schemaVersion: 1,
  documentId: 'original', dependency: 'dsa', envelopeRevision: 2,
  classification: { ...attest('classification-record'), exclusive },
  recipients: { ...attest('recipient-register'), userIds: ['recipient-a', 'recipient-b'] },
  confirmations: confirmed.map(userId => ({ ...attest(`confirmation-${userId}`), documentId: 'original', dependency: 'dsa', userId, at: '2026-11-20T14:00:00Z' })) })

test('mixed attended and validly cancelled assignments satisfy preliminary obligations', () => {
  const r = evaluate([assignment('a', 'ANULADO'), assignment('b', 'ATENDIDO')], { evidence: { cancellations: { a: cancellation() } } })
  assert.equal(r.preliminaryCompliance, 'MET')
  assert.equal(r.summary.exigible, 1)
  assert.equal(r.summary.validCancelled, 1)
  assert.equal(r.formalClosureAllowed, false)
})
test('all validly cancelled assignments may meet preliminary requirements without automatic closure', () => {
  const r = evaluate([assignment('a', 'ANULADO'), assignment('b', 'ANULADO')], { evidence: { cancellations: { a: cancellation(), b: cancellation('b') } } })
  assert.equal(r.preliminaryCompliance, 'MET')
  assert.equal(r.summary.exigible, 0)
  assert.ok(r.fulfilledRequirements.includes('ALL_ASSIGNMENTS_VALIDLY_CANCELLED'))
  assert.equal(r.canRequestFormalClosure, false)
})
for (const field of ['reason', 'authorization']) test(`cancellation without ${field} remains indeterminate`, () => {
  const c = cancellation(); delete c[field]
  assert.equal(evaluate([assignment('a', 'ANULADO')], { evidence: { cancellations: { a: c } } }).preliminaryCompliance, 'INDETERMINATE')
})
for (const change of [{ functionalRole: 'jefe-unidad' }, { dependency: 'dti' }]) test(`unauthorized cancellation ${JSON.stringify(change)} is blocked`, () => {
  const c = cancellation(); Object.assign(c.authorization, change)
  assert.equal(evaluate([assignment('a', 'ANULADO')], { evidence: { cancellations: { a: c } } }).preliminaryCompliance, 'BLOCKED')
})
test('unverified authority, stale revision and wrong document cannot release cancellation', () => {
  for (const change of [c => { c.authorization.verified = false }, c => { c.envelopeRevision = 1 }, c => { c.documentId = 'other' },
    c => { c.assignmentId = 'other' }, c => { c.authorization.source = 'organization.json' }]) {
    const c = cancellation(); change(c)
    assert.equal(evaluate([assignment('a', 'ANULADO')], { evidence: { cancellations: { a: c } } }).preliminaryCompliance, 'INDETERMINATE')
  }
})
test('exclusive knowledge can meet preliminary requirements only with classified recipients and confirmations', () => {
  const r = evaluate([], { evidence: { knowledge: knowledge() } })
  assert.equal(r.preliminaryCompliance, 'MET')
  assert.deepEqual(r.knowledgeSummary, { required: 2, confirmed: 2, pending: 0, exclusivelyKnowledge: true })
  assert.equal(r.formalClosureAllowed, false)
  assert.equal(evaluate([], { evidence: { knowledge: knowledge(['recipient-a']) } }).preliminaryCompliance, 'BLOCKED')
})
test('mixed knowledge and attention remain independent', () => {
  assert.equal(evaluate([assignment('a', 'ASIGNADO')], { evidence: { knowledge: knowledge(undefined, false) } }).summary.pending, 1)
  assert.equal(evaluate([assignment('a', 'ATENDIDO')], { evidence: { knowledge: knowledge([], false) } }).preliminaryCompliance, 'BLOCKED')
  assert.equal(evaluate([assignment('a', 'ATENDIDO')], { evidence: { knowledge: knowledge(undefined, false) } }).preliminaryCompliance, 'MET')
  assert.equal(evaluate([assignment('a', 'ATENDIDO')], { evidence: { knowledge: knowledge() } }).preliminaryCompliance, 'BLOCKED')
})
test('knowledge folder, unverified roster and foreign confirmation never prove completion', () => {
  assert.equal(evaluate([], { evidence: { knowledgeOnly: true } }).preliminaryCompliance, 'INDETERMINATE')
  const k = knowledge(); k.recipients.verified = false
  assert.equal(evaluate([], { evidence: { knowledge: k } }).preliminaryCompliance, 'INDETERMINATE')
  const foreign = knowledge(); foreign.confirmations[0].dependency = 'dti'
  assert.equal(evaluate([], { evidence: { knowledge: foreign } }).preliminaryCompliance, 'BLOCKED')
})
test('integral view stays blocked even with all assignments attended; ordinary policy is direct but disabled', () => {
  const r = evaluate([assignment('a', 'ATENDIDO'), assignment('b', 'ATENDIDO', 'dti')], { scope: { type: 'document' } })
  assert.equal(r.preliminaryCompliance, 'BLOCKED')
  assert.ok(r.blockingReasons.includes('INTEGRAL_CLOSURE_DISABLED'))
  assert.equal(r.policy.priorRequestRequired, false)
  assert.equal(r.policy.ordinaryDecision, 'DIRECT_BY_COMPETENT_DIRECTION')
  assert.equal(r.policy.institutionalApproval, 'PENDING')
  assert.equal(r.policy.reopeningEnabled, false)
})
test('inaccessible review evidence blocks a favorable result even when response is optional', () => {
  const r = evaluate([assignment('a', 'ATENDIDO')], { envelope: { reviewProcesses: [{ id: 'p', dependency: 'dsa', state: 'APROBADA' }] } })
  assert.equal(r.preliminaryCompliance, 'INDETERMINATE')
  assert.ok(r.blockingReasons.includes('PROPOSAL_EVIDENCE_INCOMPLETE'))
})
test('missing evidence, projection mismatch, pending operations and unknown dependency cannot pass', () => {
  assert.equal(evaluate([assignment('a', 'ATENDIDO')], { evidence: { originalRead: undefined } }).preliminaryCompliance, 'INDETERMINATE')
  assert.equal(evaluate([assignment('a', 'ATENDIDO')], { evidence: { projections: false } }).preliminaryCompliance, 'BLOCKED')
  assert.equal(evaluate([assignment('a', 'ATENDIDO')], { envelope: { reviewOperations: [{ dependency: 'dsa', phase: 'UNCERTAIN' }] } }).preliminaryCompliance, 'BLOCKED')
  assert.equal(evaluate([assignment('a', 'ATENDIDO', null)]).preliminaryCompliance, 'INDETERMINATE')
})
test('explicit scopes are strict, input is immutable and other-dependency proposals are not disclosed', () => {
  assert.throws(() => evaluate([], { scope: { type: 'dependency', dependency: 'DSA' } }), /CLOSURE_INVALID_INPUT/)
  const a = [assignment('a', 'ATENDIDO')], before = structuredClone(a)
  const result = evaluate(a, { envelope: { reviewProcesses: [{ id: 'private-other', dependency: 'dti', state: 'OBSERVADA' }] } })
  assert.deepEqual(a, before)
  assert.equal(result.preliminaryCompliance, 'MET')
  assert.ok(!JSON.stringify(result).includes('private-other'))
})
