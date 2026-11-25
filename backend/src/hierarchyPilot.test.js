import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { acquireHierarchyPilotLease, hierarchyPilotConfigurationReady, hierarchyPilotLeaseIsHeld,
  hierarchyOperationReady, hierarchyPilotPendingOperation, setHierarchyPilotPendingOperation,
  HIERARCHY_PILOT_ACKNOWLEDGEMENT } from './hierarchyPilot.js'

function fixture(leasePath) {
  return {
    alfrescoTarget: 'https://alfresco.example.invalid',
    hierarchyReadStorage: 'alfresco',
    hierarchyService: {
      storage: 'alfresco', username: 'service-fixture', password: 'fixture-only',
      containerNodeId: '10000000-0000-4000-8000-000000000001',
      auditContainerNodeId: '10000000-0000-4000-8000-000000000002',
      labContainerNodeId: '10000000-0000-4000-8000-000000000003',
      unitWritesEnabled: true,
    },
    hierarchyPilot: {
      expectedContainers: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'],
      enabled: true, dependency: 'DSA', expectedTarget: 'https://alfresco.example.invalid',
      acknowledgement: HIERARCHY_PILOT_ACKNOWLEDGEMENT, externalWritersDisabled: true,
      leasePath,
    },
  }
}

test('hierarchy pilot requires explicit exact target, DSA and production containers', () => {
  const settings = fixture(path.join(os.tmpdir(), 'fixture-hierarchy-pilot.lock'))
  assert.equal(hierarchyPilotConfigurationReady(settings), true)
  for (const mutate of [
    x => { x.hierarchyPilot.enabled = false },
    x => { x.hierarchyPilot.externalWritersDisabled = false },
    x => { x.hierarchyPilot.expectedTarget = 'https://other.example.invalid' },
    x => { x.hierarchyPilot.dependency = 'DTI' },
    x => { x.hierarchyService.containerNodeId = x.hierarchyService.labContainerNodeId },
    x => { x.hierarchyService.auditContainerNodeId = x.hierarchyService.containerNodeId },
    x => { x.hierarchyReadStorage = 'json' },
  ]) {
    const invalid = structuredClone(settings)
    mutate(invalid)
    assert.equal(hierarchyPilotConfigurationReady(invalid), false)
  }
})

test('hierarchy pilot lease allows one local writer and fails closed when ownership changes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hierarchy-pilot-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const settings = fixture(path.join(directory, 'pilot.lock'))
  const release = acquireHierarchyPilotLease(settings)
  assert.equal(hierarchyPilotLeaseIsHeld(settings), true)
  assert.throws(() => acquireHierarchyPilotLease(settings), /HIERARCHY_PILOT_LEASE_UNAVAILABLE/)
  const original = fs.readFileSync(settings.hierarchyPilot.leasePath, 'utf8')
  fs.writeFileSync(settings.hierarchyPilot.leasePath, JSON.stringify({ ...JSON.parse(original), token: 'other' }))
  assert.equal(hierarchyPilotLeaseIsHeld(settings), false)
  release()
  assert.equal(fs.existsSync(settings.hierarchyPilot.leasePath), true)
})

test('an uncertain operation retains its lease after a normal shutdown', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hierarchy-pilot-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const settings = fixture(path.join(directory, 'pilot.lock'))
  const release = acquireHierarchyPilotLease(settings)
  setHierarchyPilotPendingOperation(settings, { operationId: 'operation-fixture-1' })
  assert.equal(hierarchyPilotPendingOperation(settings).operationId, 'operation-fixture-1')
  release()
  assert.equal(fs.existsSync(settings.hierarchyPilot.leasePath), true)
  assert.throws(() => acquireHierarchyPilotLease(settings), /HIERARCHY_PILOT_LEASE_UNAVAILABLE/)
})

test('only the four initial DSA operations can become ready', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hierarchy-pilot-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const settings = fixture(path.join(directory, 'pilot.lock'))
  const release = acquireHierarchyPilotLease(settings)
  t.after(release)
  for (const operation of ['createUnits', 'editUnits', 'assignHeads', 'assignSpecialists']) {
    assert.equal(hierarchyOperationReady(settings, operation, 'DSA'), true)
  }
  assert.equal(hierarchyOperationReady(settings, 'changeHeads', 'DSA'), false)
  assert.equal(hierarchyOperationReady(settings, 'reassignSpecialists', 'DSA'), false)
  assert.equal(hierarchyOperationReady(settings, 'createUnits', 'DTI'), false)
})
