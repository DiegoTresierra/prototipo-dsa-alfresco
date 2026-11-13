export function distributionServiceConfigured(distributionService) {
  return Boolean(distributionService?.username && distributionService?.password)
}

export function associationUsesSameDocument(emittedEntry, receivedEntry) {
  return Boolean(emittedEntry?.id && receivedEntry?.id && emittedEntry.id === receivedEntry.id)
}

export function associationConfirmed(payload, documentId) {
  return payload?.entry?.childId === documentId
}

export function mergeConsumerPermission(permissions, authorityId) {
  if (!permissions || !Array.isArray(permissions.locallySet) || !authorityId) return null
  const existing = permissions.locallySet.find((permission) => permission.authorityId === authorityId)
  if (existing?.accessStatus === 'DENIED') {
    return { conflict: true, permissions }
  }
  if (existing) {
    return { conflict: false, permissions }
  }
  return {
    conflict: false,
    permissions: {
      isInheritanceEnabled: permissions.isInheritanceEnabled !== false,
      locallySet: [
        ...permissions.locallySet,
        { authorityId, name: 'Consumer', accessStatus: 'ALLOWED' },
      ],
    },
  }
}
