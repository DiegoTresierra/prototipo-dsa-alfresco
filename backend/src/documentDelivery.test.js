import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRecipientPermissions } from './documentDelivery.js'

test('inherited-only node accepts an omitted local collection without disabling inheritance', () => {
  const inherited = [{ authorityId: 'GROUP_sender', name: 'Contributor', accessStatus: 'ALLOWED' }]
  assert.deepEqual(buildRecipientPermissions({ isInheritanceEnabled: true, inherited }, 'GROUP_recipient'), {
    isInheritanceEnabled: true,
    locallySet: [{ authorityId: 'GROUP_recipient', name: 'Consumer', accessStatus: 'ALLOWED' }],
  })
})

test('preserves existing local ACLs and disabled inheritance without mutating the response', () => {
  const entry = Object.freeze({ authorityId: 'owner', name: 'Coordinator', accessStatus: 'ALLOWED' })
  const permissions = Object.freeze({ isInheritanceEnabled: false, locallySet: Object.freeze([entry]) })
  const result = buildRecipientPermissions(permissions, 'GROUP_recipient')
  assert.equal(result.isInheritanceEnabled, false)
  assert.deepEqual(result.locallySet[0], entry)
  assert.equal(permissions.locallySet.length, 1)
})

test('fails closed on missing permissions and malformed collections', () => {
  for (const permissions of [undefined, {}, { isInheritanceEnabled: true, locallySet: null }, { isInheritanceEnabled: true, inherited: {} }]) {
    assert.throws(() => buildRecipientPermissions(permissions, 'GROUP_recipient'), { code: 'DIRECTOR_NODE_PERMISSION_PARTIAL' })
  }
})

test('retries do not add a duplicate Consumer ACL', () => {
  const permissions = buildRecipientPermissions({ isInheritanceEnabled: true }, 'GROUP_recipient')
  assert.equal(buildRecipientPermissions(permissions, 'GROUP_recipient'), null)
})

test('checks all recipient denies even after an allowed entry', () => {
  for (const location of ['locallySet', 'inherited']) {
    const permissions = { isInheritanceEnabled: true, locallySet: [{ authorityId: 'GROUP_recipient', name: 'Consumer', accessStatus: 'ALLOWED' }] }
    permissions[location] = [...(permissions[location] || []), { authorityId: 'GROUP_recipient', name: 'Read', accessStatus: 'DENIED' }]
    assert.throws(() => buildRecipientPermissions(permissions, 'GROUP_recipient'), { code: 'DIRECTOR_NODE_PERMISSION_CONFLICT' })
  }
})
