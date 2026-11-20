import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizedNotifications, documentNotificationStorageKey, loadDocumentNotificationState, saveDocumentNotificationState } from './documentNotifications.js'
import { requireDispatchPersistence } from './dispatchPersistence.js'

test('notification preferences never persist sensitive details and only current authorized nodes supply visible details', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }
  const key = documentNotificationStorageKey('person', 'dsa')
  const state = { initialized: true, knownDocumentIds: ['pdf'], notifications: [{ id: 'notice', type: 'document-received', documentId: 'pdf',
    title: 'obsolete sensitive title', sender: 'obsolete sender', detectedAt: '2026-11-19T12:00:00Z', isRead: true }] }
  saveDocumentNotificationState(storage, key, state)
  assert.ok(!values.get(key).includes('sensitive'))
  assert.ok(!values.get(key).includes('sender'))
  const restored = loadDocumentNotificationState(storage, key)
  assert.equal(restored.notifications[0].title, undefined)
  assert.deepEqual(authorizedNotifications(restored.notifications, []), [], 'revoked or not currently verified documents have no visible notification')
  const visible = authorizedNotifications(restored.notifications, [{ id: 'pdf', subject: 'Current authorized title', sender: 'Current actor' }])
  assert.equal(visible[0].title, 'Current authorized title')
  assert.equal(visible[0].source, 'browser-detection')
  assert.notEqual(key, documentNotificationStorageKey('other', 'dsa'))
  assert.notEqual(key, documentNotificationStorageKey('person', 'dti'))
})

test('explicit local persistence cannot masquerade as an institutional Alfresco inbox', () => {
  assert.throws(() => requireDispatchPersistence('local'), /persistencia local provisional/)
  assert.doesNotThrow(() => requireDispatchPersistence('alfresco'))
})
