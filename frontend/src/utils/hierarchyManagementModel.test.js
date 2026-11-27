import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyManagementModel, listAvailableHierarchyCandidates } from './hierarchyManagementModel.js'

test('recognizes an empty Alfresco hierarchy and still returns live role candidates', () => {
  const model = createHierarchyManagementModel({
    dependency: 'dsa',
    director: { id: 'fixture_director_a', displayName: 'Dirección DSA' },
    units: [],
    assignments: [],
    recipients: [{ id: 'head', functionalRole: 'jefe-unidad' }, { id: 'staff', functionalRole: 'especialista' }],
  })
  assert.deepEqual(model.units, [])
  assert.equal(model.alfrescoReadOnly, true)
  assert.deepEqual(model.assignments, [])
  assert.deepEqual(model.members.jefes, [])
  assert.deepEqual(model.recipients.map((recipient) => recipient.id), ['head', 'staff'])
})

test('uses Alfresco unitId as the specialist reference and keeps persisted assignments without current candidates visible', () => {
  const model = createHierarchyManagementModel({
    units: [{ id: 'unit-uuid', name: 'Unidad' }],
    recipients: [{ id: 'head' }, { id: 'staff' }],
    assignments: [
      { laneId: 'jefes', userId: 'head', unitId: 'unit-uuid' },
      { laneId: 'especialistas', userId: 'staff', unitId: 'unit-uuid', unitHeadUserId: 'legacy-head' },
      { laneId: 'especialistas', userId: 'disabled-user', unitId: 'unit-uuid' },
    ],
  })
  assert.equal(model.specialistUnits.staff, 'unit-uuid')
  assert.equal(model.alfrescoReadOnly, true)
  assert.deepEqual(model.units, [{ id: 'unit-uuid', name: 'Unidad' }])
  assert.deepEqual(model.members.especialistas, ['staff', 'disabled-user'])
  assert.equal(model.staleCount, 1)
})

test('keeps legacy member responses separate from the Alfresco unit-management mode', () => {
  for (const result of [{}, { recipients: [], assignments: [] }, { units: [], recipients: [] }]) {
    const model = createHierarchyManagementModel(result)
    assert.equal(model.alfrescoReadOnly, Array.isArray(result.units))
    assert.deepEqual(model.units, Array.isArray(result.units) ? result.units : [])
  }
})

test('keeps the active DSA specialist candidate visible but does not offer an already assigned specialist again', () => {
  const model = createHierarchyManagementModel({
    units: [{ id: 'unit-dsa', name: 'Unidad DSA' }],
    recipients: [
      { id: 'admin-specialist', displayName: 'Especialista DSA', dependency: 'dsa', functionalRole: 'especialista' },
      { id: 'dti-specialist', displayName: 'Especialista DTI', dependency: 'dti', functionalRole: 'especialista' },
    ],
    assignments: [{ laneId: 'especialistas', userId: 'admin-specialist', unitId: 'unit-dsa' }],
  })
  assert.equal(model.recipients.some(person => person.id === 'admin-specialist'), true)
  assert.deepEqual(listAvailableHierarchyCandidates(model.recipients, {
    role: 'especialista', dependency: 'dsa', assignedIds: new Set(model.members.especialistas),
  }), [])
  assert.deepEqual(listAvailableHierarchyCandidates([
    ...model.recipients,
    { id: 'unassigned-admin-specialist', displayName: 'Admin Especialista', dependency: 'dsa', functionalRole: 'especialista', isAdmin: true },
  ], { role: 'especialista', dependency: 'dsa', assignedIds: new Set(model.members.especialistas) }).map(person => person.id), ['unassigned-admin-specialist'])
})
