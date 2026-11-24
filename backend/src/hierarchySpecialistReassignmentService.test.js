import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchySpecialistReassignmentService } from './hierarchySpecialistReassignmentService.js'

const sourceUnitId = '1b0c78bf-35f2-4787-878b-f235f21f7c91'
const targetUnitId = '2b0c78bf-35f2-4787-878b-f235f21f7c92'
const otherUnitId = '3b0c78bf-35f2-4787-878b-f235f21f7c93'
const sourceAssignmentId = '4b0c78bf-35f2-4787-878b-f235f21f7c94'
const headAssignmentId = '5b0c78bf-35f2-4787-878b-f235f21f7c95'
const otherSpecialistAssignmentId = '6b0c78bf-35f2-4787-878b-f235f21f7c96'
const input = { operationId: 'reassign-specialist-operation-01', userId: 'staff-dsa-1', destinationUnitId: targetUnitId, dependency: 'DSA', actorId: 'DSA_T' }
const source = { id: sourceAssignmentId, userId: input.userId, unitId: sourceUnitId, dependency: 'DSA', role: 'especialista', status: 'ACTIVA', assignedBy: 'DSA_T' }

function fixture({ responsibilityCheck = async () => ({ status: 'NO_PENDING' }), writesEnabled = true, destinationStatus = 'ACTIVA', destinationDependency = 'DSA', candidateError, repositoryFailure, auditFailure, initialAssignments } = {}) {
  const units = new Map([
    [sourceUnitId, { id: sourceUnitId, name: 'Unidad origen', dependency: 'DSA', status: 'ACTIVA' }],
    [targetUnitId, { id: targetUnitId, name: 'Unidad destino', dependency: destinationDependency, status: destinationStatus }],
    [otherUnitId, { id: otherUnitId, name: 'Otra unidad', dependency: 'DSA', status: 'ACTIVA' }],
  ])
  const assignments = new Map((initialAssignments || [
    source,
    { id: headAssignmentId, userId: 'head-dsa-1', unitId: sourceUnitId, dependency: 'DSA', role: 'jefe-unidad', status: 'ACTIVA', assignedBy: 'DSA_T' },
    { id: otherSpecialistAssignmentId, userId: 'staff-dsa-2', unitId: targetUnitId, dependency: 'DSA', role: 'especialista', status: 'ACTIVA', assignedBy: 'DSA_T' },
  ]).map((entry) => [entry.id, { ...entry }]))
  const auditEvents = new Map()
  const auditCalls = []
  const mutationCalls = []
  let failRepositoryStage = repositoryFailure
  let failAuditStage = auditFailure
  let failCandidate = candidateError
  let revision = 0
  let nextId = 1
  const repository = {
    async getUnit(id) {
      const unit = units.get(id)
      if (!unit) throw Object.assign(new Error('HIERARCHY_UNIT_OUT_OF_SCOPE'), { code: 'HIERARCHY_UNIT_OUT_OF_SCOPE', status: 403 })
      return { ...unit }
    },
    async getRevision() { return revision.toString(16).padStart(64, '0') },
    async listAssignments({ dependency, unitId, includeInactive = true } = {}) {
      return { assignments: [...assignments.values()].filter((entry) => (!dependency || entry.dependency === dependency) &&
        (!unitId || entry.unitId === unitId) && (includeInactive || entry.status === 'ACTIVA')).map((entry) => ({ ...entry })) }
    },
    async deactivateAssignment({ assignmentId, operationId }) {
      mutationCalls.push({ type: 'deactivate', assignmentId, operationId })
      if (failRepositoryStage === 'deactivate') {
        failRepositoryStage = ''
        throw Object.assign(new Error('deactivation rejected'), { code: 'HIERARCHY_ALFRESCO_HTTP_403', status: 403 })
      }
      const assignment = assignments.get(assignmentId)
      assignment.status = 'INACTIVA'
      revision += 1
      if (failRepositoryStage === 'after-deactivate') {
        failRepositoryStage = ''
        throw Object.assign(new Error('deactivation response lost'), { code: 'HIERARCHY_WRITE_OUTCOME_UNKNOWN', status: 503 })
      }
      return { ...assignment }
    },
    async createAssignment(args) {
      mutationCalls.push({ type: 'create', ...args })
      if (failRepositoryStage === 'create') {
        failRepositoryStage = ''
        throw Object.assign(new Error('create rejected'), { code: 'HIERARCHY_ALFRESCO_HTTP_403', status: 403 })
      }
      const replay = [...assignments.values()].find((entry) => entry.operationId === args.operationId)
      if (replay) return { ...replay, reused: true }
      if ([...assignments.values()].some((entry) => entry.userId === args.userId && entry.role === 'especialista' && entry.status === 'ACTIVA')) {
        throw Object.assign(new Error('HIERARCHY_SPECIALIST_ALREADY_ASSIGNED'), { code: 'HIERARCHY_SPECIALIST_ALREADY_ASSIGNED', status: 409 })
      }
      const assignment = { id: `new-assignment-${nextId++}`, ...args, status: 'ACTIVA', assignedBy: args.actorId }
      assignments.set(assignment.id, assignment)
      revision += 1
      if (failRepositoryStage === 'race-create') {
        failRepositoryStage = ''
        assignments.set('concurrent-assignment', { ...assignment, id: 'concurrent-assignment', operationId: 'another-operation' })
        revision += 1
      }
      if (failRepositoryStage === 'after-create') {
        failRepositoryStage = ''
        throw Object.assign(new Error('creation response lost'), { code: 'HIERARCHY_WRITE_OUTCOME_UNKNOWN', status: 503 })
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
    async listEvents({ dependency, operationId, page, pageSize }) {
      const matching = [...auditEvents.values()].filter((event) => event.dependenciaEvento === dependency && (!operationId || event.idOperacionEvento === operationId))
      const startIndex = (page - 1) * pageSize
      return { events: matching.slice(startIndex, startIndex + pageSize), pagination: { page, pageSize, totalPages: Math.ceil(matching.length / pageSize) } }
    },
    async createEvent(event) {
      auditCalls.push(event)
      if (failAuditStage === event.phase || failAuditStage === `${event.phase}:${event.action}`) {
        failAuditStage = ''
        throw Object.assign(new Error('audit unavailable'), { code: 'HIERARCHY_AUDIT_RECORD_FAILED', status: 503 })
      }
      const key = `${event.operationId}:${event.phase}:${event.action}:${event.assignmentId || ''}:${event.unitId || ''}`
      if (!auditEvents.has(key)) auditEvents.set(key, {
        id: `audit-${auditEvents.size + 1}`, idOperacionEvento: event.operationId, faseEvento: event.phase,
        accionEvento: event.action, dependenciaEvento: event.dependency, idUnidadEvento: event.unitId,
        idAsignacionEvento: event.assignmentId, idUsuarioEvento: event.userId, actorEvento: event.actorId,
        datosAntesEvento: event.beforeData ? JSON.stringify(event.beforeData) : undefined,
        datosDespuesEvento: event.afterData ? JSON.stringify(event.afterData) : undefined,
        revisionAntesEvento: event.beforeRevision,
      })
      return auditEvents.get(key)
    },
  }
  return {
    service: createHierarchySpecialistReassignmentService({ repository, directory, auditRepository, writesEnabled, responsibilityCheck }),
    units, assignments, auditEvents, auditCalls, mutationCalls,
    setCandidateError(error) { failCandidate = error },
  }
}

test('moves the specialist, keeps the old assignment inactive, and preserves heads and other specialists', async () => {
  const state = fixture()
  const result = await state.service.reassign(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(result.sourceUnitId, sourceUnitId)
  assert.equal(result.destinationUnitId, targetUnitId)
  assert.equal(state.assignments.get(sourceAssignmentId).status, 'INACTIVA')
  assert.equal(result.assignment.status, 'ACTIVA')
  assert.equal(result.assignment.unitId, targetUnitId)
  assert.equal(state.assignments.get(headAssignmentId).status, 'ACTIVA')
  assert.equal(state.assignments.get(headAssignmentId).unitId, sourceUnitId)
  assert.equal(state.assignments.get(otherSpecialistAssignmentId).status, 'ACTIVA')
  assert.equal(state.assignments.get(otherSpecialistAssignmentId).unitId, targetUnitId)
  assert.deepEqual(state.auditCalls.map((event) => [event.phase, event.action]), [
    ['INICIADA', 'OPERACION_INICIADA'], ['CAMBIO_APLICADO', 'ASIGNACION_DESACTIVADA'],
    ['CAMBIO_APLICADO', 'ESPECIALISTA_REASIGNADO'], ['COMPLETADA', 'OPERACION_COMPLETADA'],
  ])
  assert.ok(state.auditCalls.every((event) => event.actorId === 'DSA_T' && event.dependency === 'DSA'))
  assert.equal(state.auditCalls[0].beforeData.sourceAssignmentId, sourceAssignmentId)
  assert.equal(state.auditCalls.at(-1).afterData.destinationAssignmentId, result.assignment.id)
})

test('allows a destination unit without a head and rejects same, missing, inactive, or foreign destinations', async () => {
  const noHead = fixture({ initialAssignments: [source] })
  assert.equal((await noHead.service.reassign(input)).status, 'COMPLETADA')
  const same = fixture()
  await assert.rejects(same.service.reassign({ ...input, destinationUnitId: sourceUnitId }), /HIERARCHY_SPECIALIST_REASSIGNMENT_SAME_UNIT/)
  const missing = fixture()
  await assert.rejects(missing.service.reassign({ ...input, destinationUnitId: '8b0c78bf-35f2-4787-878b-f235f21f7c98' }), /HIERARCHY_UNIT_OUT_OF_SCOPE/)
  const inactive = fixture({ destinationStatus: 'INACTIVA' })
  await assert.rejects(inactive.service.reassign(input), /HIERARCHY_UNIT_INACTIVE/)
  const foreign = fixture({ destinationDependency: 'DTI' })
  await assert.rejects(foreign.service.reassign(input), /HIERARCHY_DEPENDENCY_MISMATCH/)
  assert.deepEqual(same.mutationCalls, [])
  assert.deepEqual(missing.mutationCalls, [])
  assert.deepEqual(inactive.mutationCalls, [])
  assert.deepEqual(foreign.mutationCalls, [])
})

test('does not alter assignments in another dependency', async () => {
  const dtiAssignment = { id: 'dti-staff-assignment', userId: 'staff-dti-1', unitId: '7b0c78bf-35f2-4787-878b-f235f21f7c97', dependency: 'DTI', role: 'especialista', status: 'ACTIVA', assignedBy: 'DTI_T' }
  const state = fixture({ initialAssignments: [source, dtiAssignment] })
  const result = await state.service.reassign(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.deepEqual(state.assignments.get(dtiAssignment.id), dtiAssignment)
  assert.ok(state.mutationCalls.every((call) => call.dependency === undefined || call.dependency === 'DSA'))
})

test('rejects a Specialist with an active assignment in a different dependency', async () => {
  const dtiAssignment = { id: 'dti-same-user-assignment', userId: input.userId, unitId: '7b0c78bf-35f2-4787-878b-f235f21f7c97', dependency: 'DTI', role: 'especialista', status: 'ACTIVA', assignedBy: 'DTI_T' }
  const state = fixture({ initialAssignments: [source, dtiAssignment] })
  await assert.rejects(state.service.reassign(input), /HIERARCHY_SPECIALIST_REASSIGNMENT_CROSS_DEPENDENCY_CONFLICT/)
  assert.deepEqual(state.mutationCalls, [])
})

test('rejects missing, duplicate, or ineligible source assignments before mutation', async () => {
  const missing = fixture({ initialAssignments: [] })
  await assert.rejects(missing.service.reassign(input), /HIERARCHY_SPECIALIST_ASSIGNMENT_NOT_FOUND/)
  const duplicate = fixture({ initialAssignments: [source, { ...source, id: 'duplicate-active-assignment', unitId: otherUnitId }] })
  await assert.rejects(duplicate.service.reassign(input), /HIERARCHY_SPECIALIST_MULTIPLE_ACTIVE_UNITS/)
  for (const code of ['HIERARCHY_USER_DISABLED', 'HIERARCHY_USER_FUNCTION_MISMATCH', 'HIERARCHY_USER_DEPENDENCY_MISMATCH']) {
    const invalid = fixture({ candidateError: Object.assign(new Error(code), { code, status: 403 }) })
    await assert.rejects(invalid.service.reassign(input), new RegExp(code))
    assert.deepEqual(invalid.mutationCalls, [])
  }
  assert.deepEqual(missing.mutationCalls, [])
  assert.deepEqual(duplicate.mutationCalls, [])
})

test('reconciles an uncertain deactivation without losing history or repeating the deactivate write', async () => {
  const state = fixture({ repositoryFailure: 'after-deactivate' })
  await assert.rejects(state.service.reassign(input), (error) => error.operationStatus === 'PARCIAL')
  assert.equal(state.assignments.get(sourceAssignmentId).status, 'INACTIVA')
  const result = await state.service.reassign(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(state.mutationCalls.filter((call) => call.type === 'deactivate').length, 1)
  assert.equal(state.mutationCalls.filter((call) => call.type === 'create').length, 1)
  assert.equal([...state.assignments.values()].filter((entry) => entry.userId === input.userId && entry.role === 'especialista' && entry.status === 'ACTIVA').length, 1)
})

test('retries the same operation when deactivation failed before Alfresco changed the source assignment', async () => {
  const state = fixture({ repositoryFailure: 'deactivate' })
  await assert.rejects(state.service.reassign(input), (error) => error.operationStatus === 'PARCIAL')
  assert.equal(state.assignments.get(sourceAssignmentId).status, 'ACTIVA')
  const result = await state.service.reassign(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(state.assignments.get(sourceAssignmentId).status, 'INACTIVA')
  assert.equal(state.mutationCalls.filter((call) => call.type === 'create').length, 1)
})

test('reconciles uncertain creation and a failed completion audit without duplicate active assignments', async () => {
  for (const config of [{ repositoryFailure: 'after-create' }, { auditFailure: 'COMPLETADA:OPERACION_COMPLETADA' }]) {
    const state = fixture(config)
    await assert.rejects(state.service.reassign(input), (error) => error.operationStatus === 'PARCIAL')
    const result = await state.service.reassign(input)
    assert.equal(result.status, 'COMPLETADA')
    assert.equal([...state.assignments.values()].filter((entry) => entry.operationId === `${input.operationId}:create`).length, 1)
    assert.equal([...state.assignments.values()].filter((entry) => entry.userId === input.userId && entry.role === 'especialista' && entry.status === 'ACTIVA').length, 1)
  }
})

test('detects a competing active assignment during final verification and reports a partial result', async () => {
  const state = fixture({ repositoryFailure: 'race-create' })
  await assert.rejects(state.service.reassign(input), (error) => error.operationStatus === 'PARCIAL' && error.code === 'HIERARCHY_SPECIALIST_REASSIGNMENT_FINAL_STATE_INVALID')
  assert.equal(state.assignments.get(sourceAssignmentId).status, 'INACTIVA')
  assert.equal([...state.assignments.values()].filter((entry) => entry.userId === input.userId && entry.role === 'especialista' && entry.status === 'ACTIVA').length, 2)
  assert.ok(state.auditCalls.some((event) => event.phase === 'PARCIAL'))
})

test('records initiation before mutation and blocks other operation IDs while this specialist is pending', async () => {
  const noInitiationAudit = fixture({ auditFailure: 'INICIADA' })
  await assert.rejects(noInitiationAudit.service.reassign(input), /HIERARCHY_AUDIT_INITIATION_FAILED/)
  assert.deepEqual(noInitiationAudit.mutationCalls, [])
  const state = fixture({ repositoryFailure: 'create' })
  await assert.rejects(state.service.reassign(input), (error) => error.operationStatus === 'PARCIAL')
  assert.deepEqual(await state.service.listPendingReassignments('DSA'), [{
    operationId: input.operationId, userId: input.userId, sourceUnitId, destinationUnitId: targetUnitId, status: 'PARCIAL',
  }])
  await assert.rejects(state.service.assertNoPendingReassignment({ dependency: 'DSA', userId: input.userId }),
    /HIERARCHY_SPECIALIST_REASSIGNMENT_PENDING_RECONCILIATION/)
  await assert.rejects(state.service.reassign({ ...input, operationId: 'different-reassign-operation', destinationUnitId: otherUnitId }),
    /HIERARCHY_SPECIALIST_REASSIGNMENT_PENDING_RECONCILIATION/)
})

test('reuses a completed operation only when Alfresco confirms exactly one active destination assignment', async () => {
  const state = fixture()
  const first = await state.service.reassign(input)
  state.setCandidateError(Object.assign(new Error('candidate eligibility changed'), { code: 'HIERARCHY_USER_DISABLED', status: 403 }))
  const replay = await state.service.reassign(input)
  assert.equal(replay.status, 'COMPLETADA')
  assert.equal(replay.reused, true)
  assert.equal(replay.assignment.id, first.assignment.id)
  assert.equal(state.mutationCalls.filter((call) => call.type === 'create').length, 1)
  state.assignments.get(first.assignment.id).status = 'INACTIVA'
  await assert.rejects(state.service.reassign(input), /HIERARCHY_SPECIALIST_REASSIGNMENT_COMPLETION_CONFLICT/)
})

test('rejects stale revisions and keeps the independent write flag disabled by default', async () => {
  const stale = fixture()
  await assert.rejects(stale.service.reassign({ ...input, expectedRevision: 'f'.repeat(64) }), /HIERARCHY_REVISION_CONFLICT/)
  const disabled = fixture({ writesEnabled: false })
  await assert.rejects(disabled.service.reassign(input), (error) => error.code === 'HIERARCHY_SPECIALIST_REASSIGNMENTS_DISABLED' && error.status === 403)
  assert.deepEqual(disabled.mutationCalls, [])
  assert.deepEqual(disabled.auditCalls, [])
})

test('specialist pending obligations and incomplete coverage prevent reassignment without transferring duties', async () => {
  for (const status of ['HAS_PENDING', 'INDETERMINATE', undefined]) {
    const state = fixture({ responsibilityCheck: async () => ({ status }) })
    await assert.rejects(state.service.reassign(input), /HIERARCHY_DOCUMENT_/)
    assert.deepEqual(state.mutationCalls, [])
    assert.deepEqual(state.auditCalls, [])
    assert.equal(state.assignments.get(sourceAssignmentId).status, 'ACTIVA')
  }
})

test('specialist obligations are rechecked immediately before deactivating the original relation', async () => {
  let checks = 0
  const state = fixture({ responsibilityCheck: async scope => {
    assert.equal(scope.userId, input.userId)
    assert.equal(scope.unitId, sourceUnitId)
    return { status: ++checks === 1 ? 'NO_PENDING' : 'INDETERMINATE' }
  } })
  await assert.rejects(state.service.reassign(input), error => error.operationStatus === 'PARCIAL')
  assert.equal(checks, 2)
  assert.deepEqual(state.mutationCalls, [])
})
