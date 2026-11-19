import test from 'node:test'
import assert from 'node:assert/strict'
import { documentPriority, ownSentDocuments, withKnownPriorities, personalAttentionKey, loadPersonalAttention, personalAttentionDocuments } from './documentViews.js'

test('Mis documentos contains only the authenticated sender, excluding received and unidentified nodes', () => {
  const documents = [{ id: 'own', senderUserId: 'director-dsa' }, { id: 'received', senderUserId: 'director-dti' }, { id: 'unknown' }]
  assert.deepEqual(ownSentDocuments(documents, 'director-dsa').map((document) => document.id), ['own'])
  assert.deepEqual(ownSentDocuments(documents, ''), [])
})

test('Para atención starts empty and requires the exact selected node ID', () => {
  const inbox = [{ id: 'first' }, { id: 'second' }]
  assert.deepEqual(personalAttentionDocuments(inbox, []), [])
  assert.deepEqual(personalAttentionDocuments(inbox, ['second', 'not-in-inbox']), [{ id: 'second' }])
  assert.deepEqual(personalAttentionDocuments(inbox, []), [], 'removing Para mí removes it from attention')
})

test('personal selections are isolated by user and dependency', () => {
  const key = personalAttentionKey('dsa-director', 'DSA')
  assert.notEqual(key, personalAttentionKey('dti-director', 'DSA'))
  assert.notEqual(key, personalAttentionKey('dsa-director', 'DTI'))
  const values = new Map([[key, JSON.stringify(['one', 'one', 'two'])]])
  const storage = { getItem: (name) => values.get(name) ?? null }
  assert.deepEqual(loadPersonalAttention(storage, key), ['one', 'two'])
  assert.deepEqual(loadPersonalAttention(storage, personalAttentionKey('someone-else', 'DSA')), [])
  values.set(key, '{broken-json')
  assert.throws(() => loadPersonalAttention(storage, key))
  values.set(key, '[null]')
  assert.throws(() => loadPersonalAttention(storage, key))
})

test('priority labels match real selections and unknown values are never displayed as Normal', () => {
  assert.equal(documentPriority('Normal').className, 'normal')
  assert.equal(documentPriority(' Alta ').className, 'high')
  assert.equal(documentPriority('URGENTE').className, 'urgent')
  for (const value of [undefined, '', 'invalid', '__proto__', 'constructor']) assert.equal(documentPriority(value).className, 'unknown')
})

test('browser confirmations never supply documentary priority or add unauthorized documents', () => {
  const inbox = [{ id: 'pdf', senderUserId: 'sender' }, { id: 'other', senderUserId: 'another' }]
  const confirmations = [{ id: 'pdf', senderUserId: 'sender', priority: 'Urgente' }, { id: 'other', senderUserId: 'wrong-person', priority: 'Alta' }, { id: 'not-authorized', senderUserId: 'sender', priority: 'Normal' }]
  const result = withKnownPriorities(inbox, confirmations)
  assert.equal(result.length, 2)
  assert.equal(result[0].priority, undefined)
  assert.equal(result[0].prioritySource, undefined)
  assert.equal(result[1].priority, undefined)
  assert.equal(inbox[0].priority, undefined, 'API results are not mutated')
  const repositoryNode = { id: 'pdf', senderUserId: 'sender', priority: 'Alta' }
  assert.equal(withKnownPriorities([repositoryNode], confirmations)[0], repositoryNode)
})
