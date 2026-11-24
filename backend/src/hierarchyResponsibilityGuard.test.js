import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyResponsibilityGuard, assertNoDocumentResponsibilities } from './hierarchyResponsibilityGuard.js'

const scope = { unitId: 'unit-fixture', userId: 'head-fixture', dependency: 'DSA' }

test('missing institutional inventory blocks both administrative changes without accepting a client clearance', async () => {
  const guard = createHierarchyResponsibilityGuard()
  for (const check of [guard.checkHead, guard.checkSpecialist, undefined]) {
    await assert.rejects(assertNoDocumentResponsibilities(check, { ...scope, status: 'NO_PENDING' }), /COVERAGE_INCOMPLETE/)
  }
})

test('head guard delegates to the existing pure evaluator and verifies the affected scope', async () => {
  const hierarchy = { verified: true, source: 'alfresco', reference: 'real-relation', complete: true, revision: 3,
    unitId: scope.unitId, headUserId: scope.userId, dependency: 'dsa', specialistUserIds: [] }
  const input = { scope: { unitId: scope.unitId, headUserId: scope.userId, dependency: 'dsa' },
    hierarchy, finalHierarchy: structuredClone(hierarchy), evaluatedAt: '2026-11-24T12:00:00Z', documents: [],
    coverage: { ...hierarchy, reference: 'complete-inventory', method: 'DIRECT_CHILDREN_AND_RELATIONS', scopesComplete: true,
      hierarchyRevision: 3, documentIds: [] } }
  const guard = createHierarchyResponsibilityGuard({ readHeadEvaluation: async () => input })
  assert.equal((await guard.checkHead(scope)).status, 'NO_PENDING')
  input.coverage.complete = false
  assert.equal((await guard.checkHead(scope)).status, 'INDETERMINATE')
  input.scope.headUserId = 'another-head'
  assert.equal((await guard.checkHead(scope)).status, 'INDETERMINATE')
})

test('specialist clearance requires its own verified complete institutional scope', async () => {
  const result = { source: 'alfresco', verified: true, ...scope, dependency: 'dsa', status: 'NO_PENDING',
    coverageComplete: true, relationshipsComplete: true }
  const guard = createHierarchyResponsibilityGuard({ readSpecialistEvaluation: async () => result })
  assert.equal((await guard.checkSpecialist(scope)).status, 'NO_PENDING')
  result.coverageComplete = false
  assert.equal((await guard.checkSpecialist(scope)).status, 'INDETERMINATE')
  result.status = 'HAS_PENDING'
  assert.equal((await guard.checkSpecialist(scope)).status, 'HAS_PENDING')
  result.userId = 'another-specialist'
  assert.equal((await guard.checkSpecialist(scope)).status, 'INDETERMINATE')
})
