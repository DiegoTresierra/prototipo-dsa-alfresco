import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchySpecialistAssignmentService } from './hierarchySpecialistAssignmentService.js'

const input = {
  operationId: 'specialist-operation-2026-01',
  unitId: '77777777-0000-4000-8000-000000000011',
  userId: 'specialist-dsa-1',
  dependency: 'DSA',
  actorId: 'fixture_director_a',
}

function fixture({ writesEnabled = true, repositoryError, auditErrorAt = '' } = {}) {
  const events = new Map()
  const eventCalls = []
  const assignments = new Map()
  const repositoryCalls = []
  const repository = {
    async createAssignment(args) {
      repositoryCalls.push(args)
      if (repositoryError) throw repositoryError
      if (assignments.has(args.operationId)) return { ...assignments.get(args.operationId), reused: true }
      const assignment = {
        id: '77777777-0000-4000-8000-000000000012',
        unitId: args.unitId,
        userId: args.userId,
        dependency: args.dependency,
        role: args.role,
        status: 'ACTIVA',
        assignedBy: args.actorId,
      }
      assignments.set(args.operationId, assignment)
      return assignment
    },
  }
  const auditRepository = {
    async createEvent(event) {
      eventCalls.push(event)
      if (event.phase === auditErrorAt) throw Object.assign(new Error('audit unavailable'), { code: 'HIERARCHY_AUDIT_RECORD_FAILED', status: 503 })
      const key = `${event.operationId}:${event.phase}:${event.action}`
      if (!events.has(key)) events.set(key, { id: `event-${events.size + 1}`, ...event })
      return events.get(key)
    },
  }
  const service = createHierarchySpecialistAssignmentService({ repository, auditRepository, writesEnabled })
  return { service, events, eventCalls, assignments, repositoryCalls }
}

test('records INICIADA before creation and COMPLETADA after verified specialist assignment', async () => {
  const state = fixture()
  const result = await state.service.assignSpecialist(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(result.assignment.role, 'especialista')
  assert.equal(result.assignment.unitId, input.unitId)
  assert.deepEqual(state.eventCalls.map(({ phase }) => phase), ['INICIADA', 'COMPLETADA'])
  assert.equal(state.eventCalls[0].actorId, 'fixture_director_a')
  assert.equal(state.eventCalls[1].action, 'ESPECIALISTA_ASIGNADO')
  assert.equal(state.repositoryCalls[0].role, 'especialista')
  assert.equal(state.repositoryCalls[0].dependency, 'DSA')
})

test('retries with the same operation id without creating duplicate assignments or events', async () => {
  const state = fixture()
  const first = await state.service.assignSpecialist(input)
  const retry = await state.service.assignSpecialist(input)
  assert.equal(first.assignment.id, retry.assignment.id)
  assert.equal(retry.assignment.reused, true)
  assert.equal(state.assignments.size, 1)
  assert.equal(state.events.size, 2)
})

test('refuses assignment while the specialist write flag is disabled', async () => {
  const state = fixture({ writesEnabled: false })
  await assert.rejects(state.service.assignSpecialist(input), (error) => error.code === 'HIERARCHY_SPECIALIST_WRITES_DISABLED' && error.status === 403)
  assert.equal(state.repositoryCalls.length, 0)
  assert.equal(state.eventCalls.length, 0)
})

test('records a partial operation if repository validation or creation fails', async () => {
  const state = fixture({ repositoryError: Object.assign(new Error('already assigned'), { code: 'HIERARCHY_SPECIALIST_ALREADY_ASSIGNED', status: 409 }) })
  await assert.rejects(state.service.assignSpecialist(input), (error) =>
    error.code === 'HIERARCHY_SPECIALIST_ALREADY_ASSIGNED' && error.operationStatus === 'PARCIAL' && error.operationId === input.operationId)
  assert.deepEqual(state.eventCalls.map(({ phase }) => phase), ['INICIADA', 'PARCIAL'])
})

test('does not report completion when its audit event fails and attempts a partial event', async () => {
  const state = fixture({ auditErrorAt: 'COMPLETADA' })
  await assert.rejects(state.service.assignSpecialist(input), (error) =>
    error.code === 'HIERARCHY_AUDIT_RECORD_FAILED' && error.operationStatus === 'PARCIAL' && error.assignmentId === '77777777-0000-4000-8000-000000000012')
  assert.deepEqual(state.eventCalls.map(({ phase }) => phase), ['INICIADA', 'COMPLETADA', 'PARCIAL'])
})

test('does not create a specialist assignment if initiation audit fails', async () => {
  const state = fixture({ auditErrorAt: 'INICIADA' })
  await assert.rejects(state.service.assignSpecialist(input), (error) => error.code === 'HIERARCHY_AUDIT_INITIATION_FAILED')
  assert.equal(state.repositoryCalls.length, 0)
})

test('validates operation, unit UUID, dependency and actor before auditing', async () => {
  const state = fixture()
  await assert.rejects(state.service.assignSpecialist({ ...input, operationId: 'bad operation' }), /HIERARCHY_OPERATION_ID_INVALID/)
  await assert.rejects(state.service.assignSpecialist({ ...input, unitId: 'not-uuid' }), /HIERARCHY_UNIT_ID_INVALID/)
  await assert.rejects(state.service.assignSpecialist({ ...input, dependency: 'DSA/DTI' }), /HIERARCHY_DEPENDENCY_INVALID/)
  await assert.rejects(state.service.assignSpecialist({ ...input, actorId: '' }), /HIERARCHY_ACTOR_REQUIRED/)
  assert.equal(state.repositoryCalls.length, 0)
  assert.equal(state.eventCalls.length, 0)
})
