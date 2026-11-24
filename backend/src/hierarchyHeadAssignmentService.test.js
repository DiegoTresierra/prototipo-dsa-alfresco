import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyHeadAssignmentService } from './hierarchyHeadAssignmentService.js'

const input = {
  operationId: 'head-operation-2026-01',
  unitId: 'b0c78bf2-35f2-4787-878b-f235f21f7c95',
  userId: 'head-dsa-1',
  dependency: 'DSA',
  actorId: 'DSA_T',
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
        id: 'c0c78bf2-35f2-4787-878b-f235f21f7c96',
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
  const service = createHierarchyHeadAssignmentService({ repository, auditRepository, writesEnabled })
  return { service, events, eventCalls, assignments, repositoryCalls }
}

test('records INICIADA before repository mutation and COMPLETADA after verified assignment', async () => {
  const state = fixture()
  const result = await state.service.assignHead(input)
  assert.equal(result.status, 'COMPLETADA')
  assert.equal(result.assignment.role, 'jefe-unidad')
  assert.equal(result.assignment.unitId, input.unitId)
  assert.deepEqual(state.eventCalls.map(({ phase }) => phase), ['INICIADA', 'COMPLETADA'])
  assert.equal(state.eventCalls[0].actorId, 'DSA_T')
  assert.equal(state.eventCalls[1].action, 'JEFE_ASIGNADO')
  assert.equal(state.repositoryCalls[0].role, 'jefe-unidad')
  assert.equal(state.repositoryCalls[0].dependency, 'DSA')
})

test('retries the same operation id without creating another assignment or duplicate audit events', async () => {
  const state = fixture()
  const first = await state.service.assignHead(input)
  const retry = await state.service.assignHead(input)
  assert.equal(first.assignment.id, retry.assignment.id)
  assert.equal(retry.assignment.reused, true)
  assert.equal(state.assignments.size, 1)
  assert.equal(state.events.size, 2)
  assert.deepEqual(state.eventCalls.map(({ phase }) => phase), ['INICIADA', 'COMPLETADA', 'INICIADA', 'COMPLETADA'])
})

test('refuses mutation when head assignment writes are disabled', async () => {
  const state = fixture({ writesEnabled: false })
  await assert.rejects(state.service.assignHead(input), (error) => error.code === 'HIERARCHY_HEAD_WRITES_DISABLED' && error.status === 403)
  assert.equal(state.repositoryCalls.length, 0)
  assert.equal(state.eventCalls.length, 0)
})

test('reports a partial assignment and records a PARCIAL event when repository creation fails', async () => {
  const state = fixture({ repositoryError: Object.assign(new Error('active head exists'), { code: 'HIERARCHY_ACTIVE_UNIT_HEAD_EXISTS', status: 409 }) })
  await assert.rejects(state.service.assignHead(input), (error) =>
    error.code === 'HIERARCHY_ACTIVE_UNIT_HEAD_EXISTS' && error.operationStatus === 'PARCIAL' && error.operationId === input.operationId)
  assert.deepEqual(state.eventCalls.map(({ phase }) => phase), ['INICIADA', 'PARCIAL'])
})

test('does not report success if the completion audit fails and tries to record PARCIAL', async () => {
  const state = fixture({ auditErrorAt: 'COMPLETADA' })
  await assert.rejects(state.service.assignHead(input), (error) =>
    error.code === 'HIERARCHY_AUDIT_RECORD_FAILED' && error.operationStatus === 'PARCIAL' && error.assignmentId === 'c0c78bf2-35f2-4787-878b-f235f21f7c96')
  assert.deepEqual(state.eventCalls.map(({ phase }) => phase), ['INICIADA', 'COMPLETADA', 'PARCIAL'])
})

test('does not create an assignment if the initial audit write fails', async () => {
  const state = fixture({ auditErrorAt: 'INICIADA' })
  await assert.rejects(state.service.assignHead(input), (error) => error.code === 'HIERARCHY_AUDIT_INITIATION_FAILED' && error.operationId === input.operationId)
  assert.equal(state.repositoryCalls.length, 0)
})

test('validates operation, unit UUID, user, dependency and actor before audit or mutation', async () => {
  const state = fixture()
  await assert.rejects(state.service.assignHead({ ...input, operationId: 'bad operation' }), /HIERARCHY_OPERATION_ID_INVALID/)
  await assert.rejects(state.service.assignHead({ ...input, unitId: 'not-a-uuid' }), /HIERARCHY_UNIT_ID_INVALID/)
  await assert.rejects(state.service.assignHead({ ...input, dependency: 'DSA/DTI' }), /HIERARCHY_DEPENDENCY_INVALID/)
  assert.equal(state.repositoryCalls.length, 0)
  assert.equal(state.eventCalls.length, 0)
})
