// An omitted locallySet collection is valid for a node with inherited ACLs.
// Missing permissions or malformed collections must never become an empty ACL.
export function buildRecipientPermissions(permissions, groupId) {
  const fail = (code) => { const error = new Error(code); error.code = code; throw error }
  if (!permissions || typeof permissions.isInheritanceEnabled !== 'boolean' ||
      (permissions.locallySet !== undefined && !Array.isArray(permissions.locallySet)) ||
      (permissions.inherited !== undefined && !Array.isArray(permissions.inherited))) {
    fail('DIRECTOR_NODE_PERMISSION_PARTIAL')
  }
  const local = permissions.locallySet || []
  const inherited = permissions.isInheritanceEnabled ? permissions.inherited || [] : []
  if ([...local, ...inherited].some((entry) => entry.authorityId === groupId && entry.accessStatus === 'DENIED')) fail('DIRECTOR_NODE_PERMISSION_CONFLICT')
  if (local.some((entry) => entry.authorityId === groupId && entry.name === 'Consumer' && entry.accessStatus === 'ALLOWED')) return null
  return {
    isInheritanceEnabled: permissions.isInheritanceEnabled,
    locallySet: [...local, { authorityId: groupId, name: 'Consumer', accessStatus: 'ALLOWED' }],
  }
}
