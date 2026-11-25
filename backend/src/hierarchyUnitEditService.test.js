import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyUnitEditService } from './hierarchyUnitEditService.js'

const unitId = '77777777-0000-4000-8000-000000000011'
const baseUnit = { id: unitId, name: 'Unidad original', code: 'DSA-01', description: 'Descripción original', dependency: 'DSA', status: 'ACTIVA', parentId: 'authorized-container' }

function fixture({ writesEnabled = true, updateFailure = null, auditFailureAt = '' } = {}) {
  const state = { unit: structuredClone(baseUnit), audit: [], calls: [], revision: 'a'.repeat(64), assignments: [{ id: 'head-1' }, { id: 'specialist-1' }] }
  const repository = {
    async getUnit(id) {
      state.calls.push(['getUnit', id])
      if (id !== unitId) throw Object.assign(new Error('HIERARCHY_UNIT_NOT_FOUND'), { code: 'HIERARCHY_UNIT_NOT_FOUND', status: 404 })
      return structuredClone(state.unit)
    },
    async listUnits() { state.calls.push(['listUnits']); return { units: [structuredClone(state.unit)] } },
    async getRevision() { state.calls.push(['getRevision']); return state.revision },
    async updateUnit({ unitId: id, changes, dependency }) {
      state.calls.push(['updateUnit', id, structuredClone(changes)])
      if (updateFailure) throw updateFailure
      if (dependency !== state.unit.dependency) throw Object.assign(new Error('HIERARCHY_DEPENDENCY_MISMATCH'), { code: 'HIERARCHY_DEPENDENCY_MISMATCH', status: 403 })
      state.unit = { ...state.unit, ...changes }
      return structuredClone(state.unit)
    },
  }
  const auditRepository = {
    async listEvents({ dependency, operationId }) {
      return { events: state.audit.filter((event) => event.dependenciaEvento.toLowerCase() === dependency.toLowerCase() && event.idOperacionEvento === operationId) }
    },
    async createEvent(input) {
      state.calls.push(['audit', input.phase, input.action])
      if (auditFailureAt === input.phase) throw Object.assign(new Error('audit failed'), { code: 'HIERARCHY_AUDIT_RECORD_FAILED', status: 503 })
      const existing = state.audit.find((event) => event.idOperacionEvento === input.operationId && event.faseEvento === input.phase && event.accionEvento === input.action)
      if (existing) return existing
      const event = {
        id: `audit-${state.audit.length + 1}`, idOperacionEvento: input.operationId, faseEvento: input.phase,
        accionEvento: input.action, dependenciaEvento: input.dependency, actorEvento: input.actorId,
        idUnidadEvento: input.unitId, datosAntesEvento: JSON.stringify(input.beforeData), datosDespuesEvento: JSON.stringify(input.afterData),
      }
      state.audit.push(event)
      return event
    },
  }
  return { service: createHierarchyUnitEditService({ repository, auditRepository, writesEnabled }), state }
}

const request = { unitId, name: 'Unidad actualizada', code: 'DSA-02', description: 'Nueva descripción', operationId: 'unit-edit-op-01', dependency: 'DSA', actorId: 'fixture_director_a', expectedRevision: 'a'.repeat(64) }

test('edits the allowed fields, verifies the same unit and records INICIADA then COMPLETADA', async () => {
  const { service, state } = fixture()
  const result = await service.editUnit(request)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(result.unit.id, unitId)
  assert.equal(result.unit.parentId, 'authorized-container')
  assert.deepEqual(state.calls.filter((call) => call[0] === 'audit').map((call) => call[1]), ['INICIADA', 'COMPLETADA'])
  assert.deepEqual(state.calls.filter((call) => call[0] === 'updateUnit').length, 1)
  assert.deepEqual(state.assignments, [{ id: 'head-1' }, { id: 'specialist-1' }])
  assert.deepEqual(JSON.parse(state.audit[0].datosAntesEvento), { entity: 'unidad', kind: 'edicion-unidad', name: 'Unidad original', code: 'DSA-01', description: 'Descripción original', status: 'ACTIVA' })
  assert.deepEqual(JSON.parse(state.audit[1].datosDespuesEvento), { entity: 'unidad', kind: 'edicion-unidad', name: 'Unidad actualizada', code: 'DSA-02', description: 'Nueva descripción', status: 'ACTIVA' })
})

test('detects a no-op without updating Alfresco or writing audit events', async () => {
  const { service, state } = fixture()
  const result = await service.editUnit({ ...request, name: baseUnit.name, code: baseUnit.code, description: baseUnit.description })
  assert.equal(result.status, 'SIN_CAMBIOS')
  assert.equal(state.calls.some((call) => call[0] === 'updateUnit'), false)
  assert.equal(state.audit.length, 0)
})

test('edits the name, code and description independently without changing the other values', async () => {
  for (const [field, value] of [['name', 'Solo nombre'], ['code', 'DSA-ONLY'], ['description', 'Solo descripción']]) {
    const { service, state } = fixture()
    const result = await service.editUnit({ ...request, ...baseUnit, unitId, operationId: `unit-edit-${field}`, dependency: 'DSA', actorId: 'fixture_director_a', expectedRevision: 'a'.repeat(64), [field]: value })
    assert.equal(result.status, 'COMPLETADA')
    assert.equal(result.unit[field], value)
    for (const other of ['name', 'code', 'description'].filter((key) => key !== field)) {
      assert.equal(result.unit[other], baseUnit[other])
    }
    assert.equal(state.audit.length, 2)
  }
})

test('replays a completed operation without a second update', async () => {
  const { service, state } = fixture()
  await service.editUnit(request)
  const replay = await service.editUnit(request)
  assert.equal(replay.status, 'COMPLETADA')
  assert.equal(replay.reused, true)
  assert.equal(state.calls.filter((call) => call[0] === 'updateUnit').length, 1)
})

test('rejects empty names, unauthorized fields, invalid UUIDs, disabled writes and inactive or foreign units', async () => {
  for (const [overrides, code] of [
    [{ name: '   ' }, 'HIERARCHY_UNIT_NAME_REQUIRED'],
    [{ unitId: 'not-a-uuid' }, 'HIERARCHY_UNIT_ID_INVALID'],
    [{ unitId: '77777777-0000-4000-8000-000000000012' }, 'HIERARCHY_UNIT_NOT_FOUND'],
    [{ dependency: 'DTI' }, 'HIERARCHY_DEPENDENCY_MISMATCH'],
  ]) {
    const { service } = fixture()
    await assert.rejects(service.editUnit({ ...request, ...overrides }), (error) => error.code === code)
  }
  const inactive = fixture()
  inactive.state.unit.status = 'INACTIVA'
  await assert.rejects(inactive.service.editUnit(request), /HIERARCHY_UNIT_INACTIVE/)
  const disabled = fixture({ writesEnabled: false })
  await assert.rejects(disabled.service.editUnit(request), /HIERARCHY_UNIT_EDITS_DISABLED/)
})

test('rejects duplicate institutional codes within the dependency', async () => {
  const other = { ...baseUnit, id: '77777777-0000-4000-8000-000000000012', name: 'Otra unidad', code: 'DSA-02' }
  // Make the repository return a second unit for this focused duplicate check.
  const duplicateFixture = fixture()
  const repository = {
    async getUnit() { return structuredClone(duplicateFixture.state.unit) },
    async listUnits() { return { units: [duplicateFixture.state.unit, other] } },
    async getRevision() { return duplicateFixture.state.revision },
    async updateUnit() { throw new Error('must not update') },
  }
  const service = createHierarchyUnitEditService({ repository, auditRepository: {
    async listEvents() { return { events: [] } }, async createEvent() { throw new Error('must not audit') },
  }, writesEnabled: true })
  await assert.rejects(service.editUnit(request), /HIERARCHY_UNIT_CODE_DUPLICATE/)
})

test('records a partial result after a repository failure and reconciles a retry without double writes', async () => {
  const { service, state } = fixture({ updateFailure: Object.assign(new Error('unknown'), { code: 'HIERARCHY_UNIT_UPDATE_OUTCOME_UNKNOWN', status: 503 }) })
  await assert.rejects(service.editUnit(request), (error) => error.operationStatus === 'PARCIAL' && error.operationId === request.operationId)
  assert.deepEqual(state.audit.map((event) => event.faseEvento), ['INICIADA', 'PARCIAL'])
  const noLongerFailingRepository = {
    async getUnit() { return structuredClone(state.unit) },
    async listUnits() { return { units: [structuredClone(state.unit)] } },
    async getRevision() { return state.revision },
    async updateUnit({ changes }) { state.calls.push(['retry-update']); state.unit = { ...state.unit, ...changes }; return structuredClone(state.unit) },
  }
  const retryService = createHierarchyUnitEditService({ repository: noLongerFailingRepository, auditRepository: {
    listEvents: async ({ operationId }) => ({ events: state.audit.filter((event) => event.idOperacionEvento === operationId) }),
    createEvent: async (input) => {
      const event = { id: `audit-${state.audit.length + 1}`, idOperacionEvento: input.operationId, faseEvento: input.phase, accionEvento: input.action,
        dependenciaEvento: input.dependency, actorEvento: input.actorId, idUnidadEvento: input.unitId,
        datosAntesEvento: JSON.stringify(input.beforeData), datosDespuesEvento: JSON.stringify(input.afterData) }
      state.audit.push(event); return event
    },
  }, writesEnabled: true })
  const result = await retryService.editUnit(request)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(state.calls.filter((call) => call[0] === 'retry-update').length, 1)
  assert.deepEqual(state.audit.slice(-1)[0].faseEvento, 'COMPLETADA')
})

test('fails before mutation if initiation audit fails or the expected revision is stale', async () => {
  const auditFailure = fixture({ auditFailureAt: 'INICIADA' })
  await assert.rejects(auditFailure.service.editUnit(request), /HIERARCHY_AUDIT_INITIATION_FAILED/)
  assert.equal(auditFailure.state.calls.some((call) => call[0] === 'updateUnit'), false)
  const stale = fixture()
  await assert.rejects(stale.service.editUnit({ ...request, expectedRevision: 'b'.repeat(64) }), /HIERARCHY_REVISION_CONFLICT/)
  assert.equal(stale.state.audit.length, 0)
  assert.equal(stale.state.calls.some((call) => call[0] === 'updateUnit'), false)
})

test('reports a partial operation when the final audit record cannot be confirmed', async () => {
  const state = fixture({ auditFailureAt: 'COMPLETADA' })
  await assert.rejects(state.service.editUnit(request), (error) => error.operationStatus === 'PARCIAL' && error.operationId === request.operationId)
  assert.equal(state.state.unit.name, request.name, 'the unit update was verified even though completion audit failed')
  assert.deepEqual(state.state.audit.map((event) => event.faseEvento), ['INICIADA', 'PARCIAL'])
})

test('does not write any property outside the three editable unit fields', async () => {
  const { service, state } = fixture()
  await service.editUnit(request)
  const call = state.calls.find((entry) => entry[0] === 'updateUnit')
  assert.deepEqual(Object.keys(call[2]).sort(), ['code', 'description', 'name'])
  assert.equal(state.unit.dependency, 'DSA')
  assert.equal(state.unit.id, unitId)
  assert.equal(state.unit.status, 'ACTIVA')
})
