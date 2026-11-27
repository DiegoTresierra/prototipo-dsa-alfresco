import assert from 'node:assert/strict'
import { test } from 'node:test'
import { persistedDocumentNotifications } from './documentNotifications.js'

test('notices require a current authorized Alfresco inbox document and a matching persisted assignment', () => {
  const document = { id: 'pdf-1', subject: 'Prueba institucional', createdAt: '2026-11-25T10:00:00Z' }
  const dispatch = { documentId: 'pdf-1', priority: 'Alta', recipients: [
    { id: 'assignment-1', userId: 'user-1', status: 'ASIGNADO', createdAt: '2026-11-25T11:00:00Z' },
    { id: 'assignment-2', userId: 'user-2', status: 'ASIGNADO' },
  ] }
  const notices = persistedDocumentNotifications([document], [dispatch, dispatch], 'user-1')
  assert.equal(notices.length, 2)
  assert.equal(notices.filter(item => item.type === 'assignment-created').length, 1)
  assert.equal(notices.find(item => item.type === 'assignment-created').detectedAt, '2026-11-25T11:00:00Z')
  assert.equal(persistedDocumentNotifications([], [dispatch], 'user-1').length, 0)
  assert.equal(persistedDocumentNotifications([document], [dispatch], 'user-3').length, 1)
  const read = persistedDocumentNotifications([document], [dispatch], 'user-1', [{ id: notices[1].id, isRead: true }])
  assert.equal(read.filter(item => item.isRead).length, 1)
})

test('deadline alerts are stable per assignment, and attendance replaces active due alerts', () => {
  const document = { id: 'pdf-deadline', subject: 'Asignación de prueba' }
  const assignment = { id: 'assignment-deadline', userId: 'user-1', status: 'ASIGNADO', createdAt: '2026-11-25T10:00:00Z',
    deadline: { status: 'POR_VENCER', dueAt: '2026-11-26T10:00:00Z', remainingMs: 1_000, initialDurationMs: 10_000 } }
  const dispatch = { documentId: document.id, priority: 'Urgente', recipients: [assignment] }
  const notices = persistedDocumentNotifications([document], [dispatch, dispatch], 'user-1')
  assert.equal(notices.filter(item => item.type === 'deadline-near').length, 1)
  assert.equal(notices.find(item => item.type === 'deadline-near').deadline.status, 'POR_VENCER')
  const attended = persistedDocumentNotifications([document], [{ ...dispatch, recipients: [{ ...assignment, status: 'ATENDIDO', attendedAt: '2026-11-25T11:00:00Z', deadline: { ...assignment.deadline, status: 'ATENDIDO' } }] }], 'user-1')
  assert.equal(attended.some(item => item.type === 'deadline-near' || item.type === 'deadline-overdue'), false)
  assert.equal(attended.filter(item => item.type === 'assignment-attended').length, 1)
})
