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
