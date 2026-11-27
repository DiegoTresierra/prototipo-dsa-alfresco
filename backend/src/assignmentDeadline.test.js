import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeadlineSnapshot, evaluateAssignmentDeadline, withAssignmentDeadlines } from './assignmentDeadline.js'
import { responseTimesDefaults } from './responseTimesService.js'

const start = '2026-06-01T12:00:00.000Z'
const snapshot = (priority, settings = responseTimesDefaults('dsa')) => createDeadlineSnapshot({ priority, startedAt: start, settings })

test('default priorities produce independent calendar deadlines in hours', () => {
  assert.equal(snapshot('Normal').dueAt, '2026-06-06T12:00:00.000Z')
  assert.equal(snapshot('Alta').dueAt, '2026-06-04T12:00:00.000Z')
  assert.equal(snapshot('Urgente').dueAt, '2026-06-02T12:00:00.000Z')
  const hourly = { ...responseTimesDefaults('dsa'), values: [{ priority: 'NORMAL', value: 2, unit: 'HORAS' }] }
  assert.equal(snapshot('Normal', hourly).dueAt, '2026-06-01T14:00:00.000Z')
})

test('deadline state covers on-time, configurable near threshold, overdue, and attended assignments', () => {
  const assignment = { status: 'ASIGNADO', deadlineSnapshot: snapshot('Alta') }
  assert.equal(evaluateAssignmentDeadline(assignment, Date.parse(start)).status, 'EN_PLAZO')
  assert.equal(evaluateAssignmentDeadline(assignment, Date.parse(start) + 3 * 24 * 60 * 60 * 1000 * 0.8).status, 'POR_VENCER')
  assert.equal(evaluateAssignmentDeadline(assignment, Date.parse(assignment.deadlineSnapshot.dueAt)).status, 'VENCIDO')
  assert.equal(evaluateAssignmentDeadline({ ...assignment, status: 'ATENDIDO' }, Date.parse(assignment.deadlineSnapshot.dueAt)).status, 'ATENDIDO')
  assert.equal(withAssignmentDeadlines({ recipients: [assignment] }, Date.parse(start)).recipients[0].deadline.status, 'EN_PLAZO')
})

test('day and hour deadlines switch to overdue exactly at dueAt, not one millisecond before', () => {
  const dayAssignment = { status: 'ASIGNADO', deadlineSnapshot: snapshot('Alta') }
  const hourSettings = { ...responseTimesDefaults('dsa'), values: [{ priority: 'URGENTE', value: 3, unit: 'HORAS' }] }
  const hourAssignment = { status: 'DESPACHADO', deadlineSnapshot: snapshot('Urgente', hourSettings) }
  for (const assignment of [dayAssignment, hourAssignment]) {
    const dueAt = Date.parse(assignment.deadlineSnapshot.dueAt)
    assert.notEqual(evaluateAssignmentDeadline(assignment, dueAt - 1).status, 'VENCIDO')
    assert.equal(evaluateAssignmentDeadline(assignment, dueAt).status, 'VENCIDO')
  }
})

test('a saved deadline snapshot is independent from later response-time configuration', () => {
  const saved = snapshot('Normal')
  const updated = { ...responseTimesDefaults('dsa'), values: [{ priority: 'NORMAL', value: 9, unit: 'DIAS' }] }
  assert.equal(saved.dueAt, '2026-06-06T12:00:00.000Z')
  assert.notEqual(snapshot('Normal', updated).dueAt, saved.dueAt)
  assert.equal(evaluateAssignmentDeadline({ status: 'ASIGNADO', deadlineSnapshot: saved }, Date.parse(start)).dueAt, saved.dueAt)
})
