import test from 'node:test'
import assert from 'node:assert/strict'
import { associationConfirmed, associationUsesSameDocument, distributionServiceConfigured } from './distribution.js'

test('requires both technical service credentials', () => {
  assert.equal(distributionServiceConfigured({ username: 'service', password: 'secret' }), true)
  assert.equal(distributionServiceConfigured({ username: 'service' }), false)
  assert.equal(distributionServiceConfigured({}), false)
})

test('requires the same UUID for both document references', () => {
  assert.equal(associationUsesSameDocument({ id: 'node-1' }, { id: 'node-1' }), true)
  assert.equal(associationUsesSameDocument({ id: 'node-1' }, { id: 'node-2' }), false)
})

test('confirms an association only when Alfresco returns the requested child', () => {
  assert.equal(associationConfirmed({ entry: { childId: 'node-1' } }, 'node-1'), true)
  assert.equal(associationConfirmed({ entry: { childId: 'node-2' } }, 'node-1'), false)
})
