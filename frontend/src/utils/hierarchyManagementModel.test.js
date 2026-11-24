import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyManagementModel } from './hierarchyManagementModel.js'

test('recognizes an empty Alfresco hierarchy and still returns live role candidates', () => {
  const model = createHierarchyManagementModel({
    dependency: 'dsa',
    director: { id: 'DSA_T', displayName: 'Dirección DSA' },
    units: [],
    assignments: [],
    recipients: [{ id: 'head', functionalRole: 'jefe-unidad' }, { id: 'staff', functionalRole: 'especialista' }],
  })
  assert.equal(model.alfrescoReadOnly, true)
  assert.deepEqual(model.units, [])
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
  assert.deepEqual(model.members.especialistas, ['staff', 'disabled-user'])
  assert.equal(model.staleCount, 1)
})

test('preserves the legacy JSON mode contract and unitHeadUserId mapping', () => {
  const model = createHierarchyManagementModel({
    recipients: [{ id: 'head' }, { id: 'staff' }],
    assignments: [
      { laneId: 'jefes', userId: 'head' },
      { laneId: 'especialistas', userId: 'staff', unitHeadUserId: 'head' },
      { laneId: 'jefes', userId: 'stale' },
    ],
  })
  assert.equal(model.alfrescoReadOnly, false)
  assert.deepEqual(model.units, [])
  assert.deepEqual(model.members.jefes, ['head'])
  assert.equal(model.specialistUnits.staff, 'head')
  assert.equal(model.staleCount, 1)
})
