import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyUnitCreationService } from './hierarchyUnitCreationService.js'

function fixture({ writesEnabled = true, repositoryError = null, auditErrorAt = '' } = {}) {
  const events = []
  const unitCalls = []
  const unit = {
    id: '77777777-0000-4000-8000-000000000011',
    name: 'Unidad ficticia', code: 'TEST-01', description: '', dependency: 'DSA', status: 'ACTIVA',
  }
  const repository = {
    async createUnit(input) {
      unitCalls.push(input)
      if (repositoryError) throw repositoryError
      return unit
    },
  }
  const auditRepository = {
    async createEvent(input) {
      events.push(input)
      if (auditErrorAt === input.phase) throw Object.assign(new Error('audit failed'), { code: 'HIERARCHY_AUDIT_RECORD_FAILED', status: 503 })
      return { id: `event-${input.phase}`, ...input }
    },
  }
  const service = createHierarchyUnitCreationService({ repository, auditRepository, writesEnabled })
  return { service, events, unitCalls, unit }
}

const input = {
  operationId: 'unit-operation-2026-01',
  name: 'Unidad ficticia',
  code: 'TEST-01',
  description: '',
  dependency: 'DSA',
  actorId: 'director-test',
}

test('audits initiation and completion and returns the verified unit and operation id', async () => {
  const state = fixture()
  const result = await state.service.createUnit(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(result.unit.id, state.unit.id)
  assert.equal(result.operationId, input.operationId)
  assert.deepEqual(state.events.map(({ phase }) => phase), ['INICIADA', 'COMPLETADA'])
  assert.ok(state.events.every((event) => event.actorId === input.actorId && event.dependency === input.dependency))
  assert.equal(state.unitCalls[0].dependency, 'DSA')
  assert.equal(state.unitCalls[0].actorId, 'director-test')
})

test('does not call Alfresco repository when writes are disabled', async () => {
  const state = fixture({ writesEnabled: false })
  await assert.rejects(state.service.createUnit(input), (error) => error.code === 'HIERARCHY_UNIT_WRITES_DISABLED' && error.status === 403)
  assert.equal(state.unitCalls.length, 0)
  assert.equal(state.events.length, 0)
})

test('validates the request before creating audit or unit nodes', async () => {
  const state = fixture()
  await assert.rejects(state.service.createUnit({ ...input, operationId: 'bad id' }), /HIERARCHY_OPERATION_ID_INVALID/)
  await assert.rejects(state.service.createUnit({ ...input, name: '   ' }), /HIERARCHY_UNIT_NAME_REQUIRED/)
  await assert.rejects(state.service.createUnit({ ...input, dependency: 'DSA/DTI' }), /HIERARCHY_DEPENDENCY_INVALID/)
  assert.equal(state.unitCalls.length, 0)
  assert.equal(state.events.length, 0)
})

test('records partial outcome and operation identifier when Alfresco unit creation fails', async () => {
  const state = fixture({ repositoryError: Object.assign(new Error('write failed'), { code: 'HIERARCHY_ALFRESCO_HTTP_503', status: 503 }) })
  await assert.rejects(state.service.createUnit(input), (error) =>
    error.code === 'HIERARCHY_ALFRESCO_HTTP_503' && error.operationId === input.operationId && error.operationStatus === 'PARCIAL' && error.status === 503)
  assert.deepEqual(state.events.map(({ phase }) => phase), ['INICIADA', 'PARCIAL'])
})

test('does not claim completion if the final audit event fails and attempts a partial event', async () => {
  const state = fixture({ auditErrorAt: 'COMPLETADA' })
  await assert.rejects(state.service.createUnit(input), (error) =>
    error.code === 'HIERARCHY_AUDIT_RECORD_FAILED' && error.operationId === input.operationId && error.operationStatus === 'PARCIAL' && error.status === 503)
  assert.deepEqual(state.events.map(({ phase }) => phase), ['INICIADA', 'COMPLETADA', 'PARCIAL'])
})

test('does not create a unit if the initial audit record cannot be written', async () => {
  const state = fixture({ auditErrorAt: 'INICIADA' })
  await assert.rejects(state.service.createUnit(input), (error) => error.code === 'HIERARCHY_AUDIT_INITIATION_FAILED' && error.status === 503 && error.operationId === input.operationId)
  assert.equal(state.unitCalls.length, 0)
  assert.deepEqual(state.events.map(({ phase }) => phase), ['INICIADA'])
})
