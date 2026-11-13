import test from 'node:test'
import assert from 'node:assert/strict'
import { associationConfirmed, associationUsesSameDocument, distributionServiceConfigured, mergeConsumerPermission } from './distribution.js'

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

test('preserves existing local permissions when adding the recipient Consumer grant', () => {
  const result = mergeConsumerPermission({
    isInheritanceEnabled: false,
    locallySet: [{ authorityId: 'GROUP_GD_OTHER', name: 'Collaborator', accessStatus: 'ALLOWED' }],
  }, 'GROUP_GD_DSA')

  assert.deepEqual(result, {
    conflict: false,
    permissions: {
      isInheritanceEnabled: false,
      locallySet: [
        { authorityId: 'GROUP_GD_OTHER', name: 'Collaborator', accessStatus: 'ALLOWED' },
        { authorityId: 'GROUP_GD_DSA', name: 'Consumer', accessStatus: 'ALLOWED' },
      ],
    },
  })
})

test('does not overwrite an explicit recipient denial', () => {
  const permissions = {
    isInheritanceEnabled: false,
    locallySet: [{ authorityId: 'GROUP_GD_DSA', name: 'Consumer', accessStatus: 'DENIED' }],
  }
  const result = mergeConsumerPermission(permissions, 'GROUP_GD_DSA')
  assert.equal(result.conflict, true)
  assert.deepEqual(result.permissions, permissions)
})
