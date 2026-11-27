import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryDeadline, formatDeliveryDeadline } from './deliveryDeadline.js'

test('the frontend uses the backend status at an exact daily deadline even within the same Lima calendar day', () => {
  const dueAt = '2026-11-26T20:00:00.000Z'
  const assignment = { status: 'ASIGNADO', deadlineSnapshot: { unit: 'DIAS', dueAt },
    deadline: { status: 'VENCIDO', dueAt, remainingMs: -1, initialDurationMs: 4 * 24 * 60 * 60 * 1000 } }
  assert.equal(deliveryDeadline(assignment, new Date('2026-11-27T04:59:59.000Z')).status, 'VENCIDO')
  const displayedDate = formatDeliveryDeadline(dueAt)
  assert.match(displayedDate, /26\/11\/(?:26|2026)/)
  assert.match(displayedDate, /3:00 p\. m\./)
})

test('daily, hourly, near, and attended states are displayed exactly as supplied by the backend', () => {
  const dueAt = '2026-11-26T20:00:00.000Z'
  const assignment = { status: 'ASIGNADO', deadlineSnapshot: { unit: 'HORAS', dueAt },
    deadline: { status: 'POR_VENCER', dueAt, remainingMs: 1, initialDurationMs: 3 * 60 * 60 * 1000 } }
  assert.equal(deliveryDeadline(assignment).status, 'POR_VENCER')
  assert.equal(deliveryDeadline({ ...assignment, deadline: { ...assignment.deadline, status: 'EN_PLAZO' } }).status, 'EN_PLAZO')
  assert.equal(deliveryDeadline({ ...assignment, deadline: { ...assignment.deadline, status: 'VENCIDO' } }).status, 'VENCIDO')
  assert.equal(deliveryDeadline({ ...assignment, status: 'ATENDIDO', deadline: { ...assignment.deadline, status: 'ATENDIDO' } }).status, 'ATENDIDO')
})

test('assignments without a real deadline remain undefined and format as No definida', () => {
  assert.deepEqual(deliveryDeadline({ status: 'ASIGNADO' }), { dueAt: null, status: 'SIN_PLAZO_REGISTRADO' })
  assert.equal(formatDeliveryDeadline(undefined), 'No definida')
})
