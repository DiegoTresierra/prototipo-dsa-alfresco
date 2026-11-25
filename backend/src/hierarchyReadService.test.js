import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertHierarchyReadConfiguration,
  createHierarchyReadService,
  hierarchyStorageMode,
  safeHierarchyReadError,
} from './hierarchyReadService.js'

test('missing reader configuration is explicit and never presented as an Alfresco outage', () => {
  assert.throws(() => assertHierarchyReadConfiguration({}), error => {
    const safe = safeHierarchyReadError(error)
    assert.equal(safe.error, 'HIERARCHY_ALFRESCO_CONFIGURATION_REQUIRED')
    assert.equal(safe.status, 503)
    assert.deepEqual(safe.missingConfiguration, ['ALFRESCO_HIERARCHY_STORAGE', 'ALFRESCO_HIERARCHY_SERVICE_USERNAME',
      'ALFRESCO_HIERARCHY_SERVICE_PASSWORD', 'ALFRESCO_HIERARCHY_CONTAINER_NODE_ID', 'ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID'])
    return true
  })
  const config = { hierarchyService: { storage: 'alfresco', username: 'reader-fixture', password: 'fixture-only',
    containerNodeId: '11111111-1111-4111-8111-111111111111', auditContainerNodeId: '22222222-2222-4222-8222-222222222222' } }
  assert.doesNotThrow(() => assertHierarchyReadConfiguration(config), 'read access does not require lab folders or write flags')
  config.hierarchyService.auditContainerNodeId = config.hierarchyService.containerNodeId
  assert.throws(() => assertHierarchyReadConfiguration(config), error =>
    error.missingConfiguration.length === 1 && error.missingConfiguration[0] === 'ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID')
  const safe = safeHierarchyReadError({ code: 'HIERARCHY_ALFRESCO_CONFIGURATION_REQUIRED', missingConfiguration: ['fixture-private-value'] })
  assert.deepEqual(safe.missingConfiguration, [], 'diagnostics expose only parameter names from the allowlist')
})

const dsaUnitId = '11111111-1111-4111-8111-111111111111'
const dtiUnitId = '22222222-2222-4222-8222-222222222222'

function fixture({ empty = false, failRead = false } = {}) {
  const calls = []
  const repository = {
    async listUnits(options) {
      calls.push(['units', options])
      if (failRead) throw Object.assign(new Error('HIERARCHY_ALFRESCO_HTTP_503'), { code: 'HIERARCHY_ALFRESCO_HTTP_503', status: 503 })
      return { units: empty ? [] : [
        { id: dsaUnitId, name: 'DSA unidad', code: 'DSA-01', dependency: 'DSA', status: 'ACTIVA' },
        { id: dtiUnitId, name: 'DTI unidad', code: 'DTI-01', dependency: 'DTI', status: 'ACTIVA' },
      ] }
    },
    async listAssignments(options) {
      calls.push(['assignments', options])
      if (failRead) throw Object.assign(new Error('HIERARCHY_ALFRESCO_HTTP_503'), { code: 'HIERARCHY_ALFRESCO_HTTP_503', status: 503 })
      return { assignments: empty ? [] : [
        { id: 'a-head', userId: 'head-dsa', unitId: dsaUnitId, dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA', assignedBy: 'service', modifiedAt: '2026-01-01' },
        { id: 'a-staff', userId: 'staff-dsa', unitId: dsaUnitId, dependency: 'DSA', role: 'especialista', status: 'ACTIVA', assignedBy: 'director' },
        { id: 'a-other', userId: 'staff-dti', unitId: dtiUnitId, dependency: 'DTI', role: 'especialista', status: 'ACTIVA', assignedBy: 'director-dti' },
      ] }
    },
  }
  const directory = {
    async listCandidates({ dependency, role }) {
      calls.push(['candidates', dependency, role])
      return dependency === 'DSA'
        ? [{ id: role === 'jefe-unidad' ? 'head-dsa' : 'staff-dsa', displayName: 'Usuario', dependency: 'DSA', role, enabled: true }]
        : []
    },
  }
  return {
    service: createHierarchyReadService({ repository, directory, groupMappings: { dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' } } }),
    calls, repository, directory,
  }
}

test('adapts Alfresco units and assignments into the BFF contract and isolates dependencies', async () => {
  const { service, calls } = fixture()
  const result = await service.readDependency('dsa')
  assert.deepEqual(result.units, [{ id: dsaUnitId, name: 'DSA unidad', code: 'DSA-01', description: '', dependency: 'dsa', status: 'ACTIVA' }])
  assert.deepEqual(result.assignments.map(({ laneId, userId }) => ({ laneId, userId })), [
    { laneId: 'jefes', userId: 'head-dsa' },
    { laneId: 'especialistas', userId: 'staff-dsa' },
  ])
  assert.equal(result.assignments[1].unitHeadUserId, 'head-dsa')
  assert.equal(result.assignments[1].unitId, dsaUnitId)
  assert.equal(result.assignments[0].updatedBy, 'service')
  assert.ok(result.recipients.every((recipient) => recipient.dependency === 'dsa'))
  assert.ok(calls.some(([, dependency]) => dependency === 'DSA'))
})

test('returns an empty Alfresco container without adding JSON assignments', async () => {
  const { service } = fixture({ empty: true })
  const result = await service.readDependency('DSA')
  assert.deepEqual(result.units, [])
  assert.deepEqual(result.assignments, [])
  assert.deepEqual(result.recipients.map((candidate) => candidate.id), ['head-dsa', 'staff-dsa'])
})

test('surfaces an Alfresco read error instead of using a fallback source', async () => {
  const { service } = fixture({ failRead: true })
  await assert.rejects(service.readDependency('DSA'), /HIERARCHY_ALFRESCO_HTTP_503/)
  assert.deepEqual(safeHierarchyReadError(Object.assign(new Error(), { code: 'HIERARCHY_ALFRESCO_HTTP_403' })), {
    status: 503, error: 'HIERARCHY_ALFRESCO_ACCESS_DENIED',
  })
})

test('defaults to Alfresco and rejects local organization data even if configured', () => {
  assert.equal(hierarchyStorageMode({}), 'alfresco')
  assert.equal(hierarchyStorageMode({ hierarchyReadStorage: 'alfresco' }), 'alfresco')
  assert.throws(() => hierarchyStorageMode({ hierarchyReadStorage: 'json' }), /HIERARCHY_READ_STORAGE_INVALID/)
  assert.throws(() => hierarchyStorageMode({ hierarchyReadStorage: 'unexpected' }), /HIERARCHY_READ_STORAGE_INVALID/)
})

test('a hierarchy changed during its read cannot be presented as a coherent snapshot', async () => {
  const { service, repository } = fixture()
  let reads = 0
  repository.getRevision = async () => (++reads === 1 ? 'a' : 'b').repeat(64)
  await assert.rejects(service.readDependency('dsa'), /HIERARCHY_REVISION_CONFLICT/)
})

test('an assignment whose live membership is absent or revoked is explicitly invalid, not an authorized relation', async () => {
  const { service, directory } = fixture()
  directory.listCandidates = async () => []
  await assert.rejects(service.readDependency('dsa'), /HIERARCHY_ASSIGNMENT_MEMBERSHIP_INVALID/)
})
