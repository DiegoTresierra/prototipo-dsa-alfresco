import test from 'node:test'
import assert from 'node:assert/strict'
import { planHierarchyMigration } from './hierarchyMigrationPlanner.js'

const baseOrganization = {
  hierarchies: { dsa: { assignments: [
    { laneId: 'jefes', userId: 'head-1', dependency: 'dsa' },
    { laneId: 'especialistas', userId: 'staff-1', dependency: 'dsa', unitHeadUserId: 'head-1' },
  ] } },
  audit: [],
}
const confirmedUnit = { name: 'Unidad confirmada', code: 'U-01', dependency: 'dsa', institutionallyConfirmed: true, alfrescoUnitId: 'unit-uuid' }
const validDirectory = {
  'head-1|dsa|jefe-unidad': { valid: true },
  'staff-1|dsa|especialista': { valid: true },
}

test('reports assignments with valid users, a confirmed unit and a valid head link', () => {
  const plan = planHierarchyMigration({
    organization: baseOrganization, sourceSha256: 'abc', directoryChecks: validDirectory,
    userUnitAssignments: { 'head-1': confirmedUnit },
  })
  assert.deepEqual(plan.summary, { valid: 2, ambiguous: 0, invalid: 0, pending: 0, unitsNeedingConfirmation: 0 })
  assert.equal(plan.assignments[1].unitHeadUserId, 'head-1')
  assert.equal(plan.source.sha256, 'abc')
})

test('classifies nonexistent, disabled and incompatible users as invalid', () => {
  for (const code of ['HIERARCHY_USER_NOT_FOUND', 'HIERARCHY_USER_DISABLED', 'HIERARCHY_USER_DEPENDENCY_MISMATCH', 'HIERARCHY_USER_FUNCTION_MISMATCH']) {
    const plan = planHierarchyMigration({
      organization: { hierarchies: { dsa: { assignments: [{ laneId: 'jefes', userId: 'head-1', dependency: 'dsa' }] } } },
      directoryChecks: { 'head-1|dsa|jefe-unidad': { valid: false, code } },
    })
    assert.equal(plan.assignments[0].category, 'invalid', code)
  }
})

test('flags ambiguous memberships, dangling head references, and duplicate assignments', () => {
  const organization = { hierarchies: { dsa: { assignments: [
    { laneId: 'jefes', userId: 'head-1', dependency: 'dsa' },
    { laneId: 'jefes', userId: 'head-1', dependency: 'dsa' },
    { laneId: 'especialistas', userId: 'staff-1', dependency: 'dsa', unitHeadUserId: 'missing-head' },
  ] } } }
  const plan = planHierarchyMigration({
    organization,
    directoryChecks: {
      'head-1|dsa|jefe-unidad': { valid: false, code: 'HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS' },
      'staff-1|dsa|especialista': { valid: true },
    },
  })
  assert.equal(plan.assignments[0].category, 'ambiguous')
  assert.ok(plan.assignments[0].issues.includes('DUPLICATE_SOURCE_ASSIGNMENT'))
  assert.equal(plan.assignments[2].category, 'invalid')
  assert.ok(plan.assignments[2].issues.includes('UNIT_HEAD_REFERENCE_NOT_FOUND_IN_DEPENDENCY'))
})

test('does not invent institutional unit names or codes and reports the head for confirmation', () => {
  const plan = planHierarchyMigration({ organization: baseOrganization, directoryChecks: validDirectory })
  assert.equal(plan.assignments[0].category, 'pending')
  assert.deepEqual(plan.unitsNeedingConfirmation, [{
    dependency: 'dsa', headUserId: 'head-1', alfrescoUnitId: null, nameConfirmed: false, codeConfirmed: false,
  }])
})

test('flags existing Alfresco conflicts and treats repository read failures as pending', () => {
  const conflict = planHierarchyMigration({
    organization: { hierarchies: { dsa: { assignments: [{ laneId: 'jefes', userId: 'head-1', dependency: 'dsa' }] } } },
    directoryChecks: validDirectory,
    userUnitAssignments: { 'head-1': confirmedUnit },
    existingUnits: [{ id: 'unit-uuid', dependency: 'dsa', code: 'U-01', name: 'Unidad confirmada', status: 'ACTIVA' }],
    existingAssignments: [
      { dependency: 'dsa', userId: 'head-1', role: 'jefe-unidad', status: 'ACTIVA', unitId: 'other-unit' },
      { dependency: 'dsa', userId: 'head-1', role: 'jefe-unidad', status: 'ACTIVA', unitId: 'other-unit-2' },
    ],
  })
  assert.equal(conflict.assignments[0].category, 'ambiguous')
  assert.ok(conflict.assignments[0].issues.includes('DUPLICATE_ACTIVE_ALFRESCO_ASSIGNMENT'))

  const failedRead = planHierarchyMigration({ organization: baseOrganization, alfrescoReadError: 'HIERARCHY_ALFRESCO_HTTP_403' })
  assert.equal(failedRead.alfresco.readSucceeded, false)
  assert.equal(failedRead.assignments.every((item) => item.category === 'pending'), true)
  assert.equal(failedRead.assignments[0].issues.includes('ALFRESCO_READ_UNAVAILABLE'), true)
})
