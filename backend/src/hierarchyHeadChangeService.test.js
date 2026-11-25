import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyHeadChangeService } from './hierarchyHeadChangeService.js'

const unitId = '77777777-0000-4000-8000-000000000011'
const oldAssignmentId = '77777777-0000-4000-8000-000000000012'
const specialistAssignmentId = '77777777-0000-4000-8000-000000000013'
const input = { operationId: 'change-head-operation-01', unitId, newHeadUserId: 'head-dsa-2', dependency: 'DSA', actorId: 'fixture_director_a' }

function fixture({ responsibilityCheck = async () => ({ status: 'NO_PENDING' }), writesEnabled = true, unitStatus = 'ACTIVA', unitDependency = 'DSA', candidateError, initialAssignments, repositoryFailure, auditFailure } = {}) {
  const units = new Map([[unitId, { id: unitId, name: 'Unidad DSA', dependency: unitDependency, status: unitStatus }]])
  const assignments = new Map((initialAssignments || [
    { id: oldAssignmentId, unitId, userId: 'head-dsa-1', dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA', assignedBy: 'director' },
    { id: specialistAssignmentId, unitId, userId: 'staff-dsa-1', dependency: 'DSA', role: 'especialista', status: 'ACTIVA', assignedBy: 'director' },
  ]).map((assignment) => [assignment.id, { ...assignment }]))
  const mutationCalls = []
  const auditEvents = new Map()
  const auditCalls = []
  let failRepositoryStage = repositoryFailure
  let failAuditStage = auditFailure
  let failCandidate = candidateError
  let revision = 0
  let nextId = 1
  const repository = {
    async getUnit(id) {
      const unit = units.get(id)
      if (!unit) throw Object.assign(new Error('HIERARCHY_UNIT_OUT_OF_SCOPE'), { code: 'HIERARCHY_UNIT_OUT_OF_SCOPE', status: 404 })
      return { ...unit }
    },
    async getRevision() { return `revision-${revision}` },
    async listAssignments({ dependency, unitId: scopeUnitId, includeInactive = true } = {}) {
      return { assignments: [...assignments.values()].filter((item) =>
        (!dependency || item.dependency === dependency) && (!scopeUnitId || item.unitId === scopeUnitId) && (includeInactive || item.status === 'ACTIVA')).map((item) => ({ ...item })) }
    },
    async deactivateAssignment({ assignmentId }) {
      mutationCalls.push({ action: 'deactivate', assignmentId })
      if (failRepositoryStage === 'deactivate') {
        failRepositoryStage = ''
        throw Object.assign(new Error('deactivation failed'), { code: 'HIERARCHY_ALFRESCO_HTTP_403', status: 403 })
      }
      const assignment = assignments.get(assignmentId)
      assignment.status = 'INACTIVA'
      revision += 1
      if (failRepositoryStage === 'after-deactivate') {
        failRepositoryStage = ''
        throw Object.assign(new Error('lost deactivation confirmation'), { code: 'HIERARCHY_WRITE_OUTCOME_UNKNOWN', status: 503 })
      }
      return { ...assignment }
    },
    async createAssignment(args) {
      mutationCalls.push({ action: 'create', ...args })
      if (failRepositoryStage === 'create') {
        failRepositoryStage = ''
        throw Object.assign(new Error('creation failed'), { code: 'HIERARCHY_ALFRESCO_HTTP_403', status: 403 })
      }
      const existing = [...assignments.values()].find((item) => item.operationId === args.operationId)
      if (existing) return { ...existing, reused: true }
      const assignment = { id: `new-assignment-${nextId++}`, ...args, status: 'ACTIVA', assignedBy: args.actorId }
      assignments.set(assignment.id, assignment)
      revision += 1
      if (failRepositoryStage === 'after-create') {
        failRepositoryStage = ''
        throw Object.assign(new Error('lost creation confirmation'), { code: 'HIERARCHY_WRITE_OUTCOME_UNKNOWN', status: 503 })
      }
      return { ...assignment }
    },
  }
  const directory = {
    async validateAssignmentCandidate(userId, options) {
      if (failCandidate) throw failCandidate
      return { id: userId, enabled: true, dependency: options.dependency, role: options.role }
    },
  }
  const auditRepository = {
    async listEvents({ dependency, page, pageSize }) {
      const events = [...auditEvents.values()].filter((event) => event.dependenciaEvento === dependency)
        .sort((left, right) => right.fechaEvento.localeCompare(left.fechaEvento))
      const start = (page - 1) * pageSize
      const totalPages = Math.ceil(events.length / pageSize)
      return { events: events.slice(start, start + pageSize), pagination: { page, pageSize, totalPages, totalItems: events.length } }
    },
    async createEvent(event) {
      auditCalls.push(event)
      if (failAuditStage === event.phase) {
        failAuditStage = ''
        throw Object.assign(new Error('audit failure'), { code: 'HIERARCHY_AUDIT_RECORD_FAILED', status: 503 })
      }
      const key = `${event.operationId}:${event.phase}:${event.action}:${event.assignmentId || ''}:${event.userId || ''}`
      if (!auditEvents.has(key)) auditEvents.set(key, {
        id: `audit-${auditEvents.size + 1}`,
        idOperacionEvento: event.operationId,
        faseEvento: event.phase,
        accionEvento: event.action,
        dependenciaEvento: event.dependency,
        idUnidadEvento: event.unitId,
        idAsignacionEvento: event.assignmentId,
        idUsuarioEvento: event.userId,
        actorEvento: event.actorId,
        datosAntesEvento: event.beforeData ? JSON.stringify(event.beforeData) : undefined,
        datosDespuesEvento: event.afterData ? JSON.stringify(event.afterData) : undefined,
        fechaEvento: new Date(Date.now() + auditEvents.size).toISOString(),
      })
      return auditEvents.get(key)
    },
  }
  return {
    service: createHierarchyHeadChangeService({ repository, directory, auditRepository, writesEnabled, responsibilityCheck }),
    units, assignments, mutationCalls, auditEvents, auditCalls,
    setCandidateError(error) { failCandidate = error },
  }
}

test('replaces the active head, preserves specialists and audits each mutation plus completion', async () => {
  const state = fixture()
  const result = await state.service.changeHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(result.previousHeadUserId, 'head-dsa-1')
  assert.equal(result.newHeadUserId, 'head-dsa-2')
  assert.equal(state.assignments.get(oldAssignmentId).status, 'INACTIVA')
  assert.equal(state.assignments.get(specialistAssignmentId).status, 'ACTIVA')
  assert.equal([...state.assignments.values()].filter((item) => item.role === 'especialista' && item.unitId === unitId && item.status === 'ACTIVA').length, 1)
  assert.deepEqual(state.mutationCalls.map(({ action }) => action), ['deactivate', 'create'])
  assert.deepEqual(state.auditCalls.map(({ phase, action }) => [phase, action]), [
    ['INICIADA', 'OPERACION_INICIADA'], ['CAMBIO_APLICADO', 'JEFE_DESACTIVADO'],
    ['CAMBIO_APLICADO', 'JEFE_ASIGNADO'], ['COMPLETADA', 'OPERACION_COMPLETADA'],
  ])
  assert.equal(state.auditCalls.at(-1).actorId, 'fixture_director_a')
  assert.equal(state.auditCalls.at(-1).afterData.newHeadUserId, 'head-dsa-2')
  assert.deepEqual(await state.service.listPendingChanges('DSA'), [])
})

test('reconciles a retry after the old head was deactivated but before the new assignment', async () => {
  const state = fixture({ repositoryFailure: 'create' })
  await assert.rejects(state.service.changeHead(input), (error) => error.operationStatus === 'PARCIAL')
  assert.equal(state.assignments.get(oldAssignmentId).status, 'INACTIVA')
  const result = await state.service.changeHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal([...state.assignments.values()].filter((item) => item.role === 'jefe-unidad' && item.status === 'ACTIVA').length, 1)
  assert.equal([...state.assignments.values()].find((item) => item.userId === 'head-dsa-2').status, 'ACTIVA')
})

test('reconciles a failure before deactivating the old head and retries with the same operation ID', async () => {
  const state = fixture({ repositoryFailure: 'deactivate' })
  await assert.rejects(state.service.changeHead(input), (error) => error.operationStatus === 'PARCIAL')
  assert.equal(state.assignments.get(oldAssignmentId).status, 'ACTIVA')
  const result = await state.service.changeHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(state.assignments.get(oldAssignmentId).status, 'INACTIVA')
})

test('recovers a committed deactivation whose response was uncertain before creating the new head', async () => {
  const state = fixture({ repositoryFailure: 'after-deactivate' })
  await assert.rejects(state.service.changeHead(input), (error) => error.operationStatus === 'PARCIAL')
  const result = await state.service.changeHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(state.mutationCalls.filter(({ action }) => action === 'deactivate').length, 1)
  assert.equal(state.mutationCalls.filter(({ action }) => action === 'create').length, 1)
})

test('recovers a new head created before the completion audit by reading Alfresco state first', async () => {
  const state = fixture({ auditFailure: 'COMPLETADA' })
  await assert.rejects(state.service.changeHead(input), (error) => error.operationStatus === 'PARCIAL')
  assert.equal([...state.assignments.values()].filter((item) => item.role === 'jefe-unidad' && item.status === 'ACTIVA').length, 1)
  const result = await state.service.changeHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(result.assignment.userId, 'head-dsa-2')
  assert.equal(state.mutationCalls.filter(({ action }) => action === 'create').length, 1)
})

test('replays a completed operation from its verified Alfresco state without revalidating a new assignment', async () => {
  const state = fixture()
  const first = await state.service.changeHead(input)
  state.setCandidateError(Object.assign(new Error('candidate no longer available'), { code: 'HIERARCHY_USER_DISABLED', status: 403 }))
  const replay = await state.service.changeHead(input)
  assert.equal(first.status, 'COMPLETADA')
  assert.equal(replay.status, 'COMPLETADA')
  assert.equal(replay.reused, true)
  assert.equal(replay.assignment.id, first.assignment.id)
  assert.deepEqual(state.mutationCalls.map(({ action }) => action), ['deactivate', 'create'])
})

test('recovers an uncertain new-head creation without creating a second assignment', async () => {
  const state = fixture({ repositoryFailure: 'after-create' })
  await assert.rejects(state.service.changeHead(input), (error) => error.operationStatus === 'PARCIAL')
  const result = await state.service.changeHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(state.mutationCalls.filter(({ action }) => action === 'create').length, 1)
  assert.equal([...state.assignments.values()].filter((item) => item.role === 'jefe-unidad' && item.status === 'ACTIVA').length, 1)
})

test('does not write if the initial audit record fails', async () => {
  const state = fixture({ auditFailure: 'INICIADA' })
  await assert.rejects(state.service.changeHead(input), (error) => error.code === 'HIERARCHY_AUDIT_INITIATION_FAILED')
  assert.deepEqual(state.mutationCalls, [])
})

test('records partial and blocks a different change while reconciliation remains pending', async () => {
  const state = fixture({ repositoryFailure: 'create' })
  await assert.rejects(state.service.changeHead(input), (error) => error.operationStatus === 'PARCIAL')
  const pending = await state.service.listPendingChanges('DSA')
  assert.deepEqual(pending, [{ operationId: input.operationId, unitId, previousHeadUserId: 'head-dsa-1', newHeadUserId: 'head-dsa-2', status: 'PARCIAL' }])
  await assert.rejects(state.service.assertNoPendingChange({ dependency: 'DSA', unitId }),
    (error) => error.code === 'HIERARCHY_HEAD_CHANGE_PENDING_RECONCILIATION' && error.operationId === input.operationId)
  await assert.rejects(state.service.changeHead({ ...input, operationId: 'another-change-operation', newHeadUserId: 'head-dsa-3' }),
    (error) => error.code === 'HIERARCHY_HEAD_CHANGE_PENDING_RECONCILIATION' && error.operationId === input.operationId)
})

test('rejects a disabled candidate, a different dependency and a mismatched functional group before mutation', async () => {
  for (const code of ['HIERARCHY_USER_DISABLED', 'HIERARCHY_USER_DEPENDENCY_MISMATCH', 'HIERARCHY_USER_FUNCTION_MISMATCH']) {
    const state = fixture({ candidateError: Object.assign(new Error(code), { code, status: 403 }) })
    await assert.rejects(state.service.changeHead(input), (error) => error.code === code)
    assert.deepEqual(state.mutationCalls, [])
    assert.equal(state.auditCalls.length, 0)
  }
})

test('rejects equal, missing, inactive, or cross-dependency targets before mutation', async () => {
  const same = fixture()
  await assert.rejects(same.service.changeHead({ ...input, newHeadUserId: 'head-dsa-1' }), /HIERARCHY_HEAD_UNCHANGED/)
  const missing = fixture()
  await assert.rejects(missing.service.changeHead({ ...input, unitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), /HIERARCHY_UNIT_OUT_OF_SCOPE/)
  const inactive = fixture({ unitStatus: 'INACTIVA' })
  await assert.rejects(inactive.service.changeHead(input), /HIERARCHY_UNIT_INACTIVE/)
  const foreign = fixture({ unitDependency: 'DTI' })
  await assert.rejects(foreign.service.changeHead(input), /HIERARCHY_DEPENDENCY_MISMATCH/)
  assert.deepEqual(same.mutationCalls, [])
  assert.deepEqual(missing.mutationCalls, [])
  assert.deepEqual(inactive.mutationCalls, [])
  assert.deepEqual(foreign.mutationCalls, [])
})

test('rejects a new head already active in another unit or assigned as an active specialist', async () => {
  const otherUnit = '77777777-0000-4000-8000-000000000015'
  const assignedElsewhere = fixture({ initialAssignments: [
    { id: oldAssignmentId, unitId, userId: 'head-dsa-1', dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA' },
    { id: 'other-head-assignment', unitId: otherUnit, userId: 'head-dsa-2', dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA' },
  ] })
  await assert.rejects(assignedElsewhere.service.changeHead(input), /HIERARCHY_HEAD_ALREADY_ASSIGNED_TO_OTHER_UNIT/)
  const specialistElsewhere = fixture({ initialAssignments: [
    { id: oldAssignmentId, unitId, userId: 'head-dsa-1', dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA' },
    { id: 'new-specialist-assignment', unitId: otherUnit, userId: 'head-dsa-2', dependency: 'DSA', role: 'especialista', status: 'ACTIVA' },
  ] })
  await assert.rejects(specialistElsewhere.service.changeHead(input), /HIERARCHY_USER_HAS_INCOMPATIBLE_ACTIVE_ASSIGNMENT/)
  assert.deepEqual(assignedElsewhere.mutationCalls, [])
  assert.deepEqual(specialistElsewhere.mutationCalls, [])
})

test('rejects duplicate active heads and preserves DTI assignments during a DSA change', async () => {
  const duplicate = fixture({ initialAssignments: [
    { id: oldAssignmentId, unitId, userId: 'head-dsa-1', dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA' },
    { id: 'duplicate-head', unitId, userId: 'head-dsa-3', dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA' },
  ] })
  await assert.rejects(duplicate.service.changeHead(input), /HIERARCHY_ACTIVE_UNIT_HEAD_CONFLICT/)
  const crossScope = fixture({ initialAssignments: [
    { id: oldAssignmentId, unitId, userId: 'head-dsa-1', dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA' },
    { id: 'dti-head', unitId: '77777777-0000-4000-8000-000000000017', userId: 'head-dti-1', dependency: 'DTI', role: 'jefe-unidad', status: 'ACTIVA' },
  ] })
  const result = await crossScope.service.changeHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(crossScope.assignments.get('dti-head').status, 'ACTIVA')
  assert.deepEqual(duplicate.mutationCalls, [])
})

test('rejects stale revisions and conflicting operation ID reuse', async () => {
  const stale = fixture()
  await assert.rejects(stale.service.changeHead({ ...input, expectedRevision: 'a'.repeat(64) }), /HIERARCHY_REVISION_CONFLICT/)
  const reused = fixture({ repositoryFailure: 'create' })
  await assert.rejects(reused.service.changeHead(input), (error) => error.operationStatus === 'PARCIAL')
  await assert.rejects(reused.service.changeHead({ ...input, newHeadUserId: 'head-dsa-3' }), /HIERARCHY_OPERATION_DUPLICATE_CONFLICT/)
})

test('keeps the independent write flag disabled by default', async () => {
  const state = fixture({ writesEnabled: false })
  await assert.rejects(state.service.changeHead(input), (error) => error.code === 'HIERARCHY_HEAD_CHANGES_DISABLED' && error.status === 403)
  assert.deepEqual(state.mutationCalls, [])
  assert.deepEqual(state.auditCalls, [])
})

test('document pending or incomplete coverage blocks head changes before any audit or mutation', async () => {
  for (const status of ['HAS_PENDING', 'INDETERMINATE', undefined]) {
    const state = fixture({ responsibilityCheck: async () => ({ status }) })
    await assert.rejects(state.service.changeHead(input), /HIERARCHY_DOCUMENT_/)
    assert.deepEqual(state.mutationCalls, [])
    assert.deepEqual(state.auditCalls, [])
  }
})

test('a new responsibility before deactivation blocks the change and requires reconciliation', async () => {
  let checks = 0
  const state = fixture({ responsibilityCheck: async scope => {
    assert.equal(scope.userId, 'head-dsa-1')
    assert.equal(scope.unitId, unitId)
    return { status: ++checks === 1 ? 'NO_PENDING' : 'HAS_PENDING' }
  } })
  await assert.rejects(state.service.changeHead(input), error => error.operationStatus === 'PARCIAL')
  assert.equal(checks, 2)
  assert.deepEqual(state.mutationCalls, [])
  assert.equal(state.assignments.get(oldAssignmentId).status, 'ACTIVA')
})

test('concurrent head requests serialize locally and a completed replay never repeats mutations', async () => {
  const state = fixture()
  const [first, second] = await Promise.all([state.service.changeHead(input), state.service.changeHead(input)])
  assert.equal(first.status, 'COMPLETADA')
  assert.equal(second.reused, true)
  assert.equal(state.mutationCalls.filter(call => call.action === 'create').length, 1)
})
