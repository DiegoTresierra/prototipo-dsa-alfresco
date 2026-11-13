export function distributionServiceConfigured(distributionService) {
  return Boolean(distributionService?.username && distributionService?.password)
}

export function associationUsesSameDocument(emittedEntry, receivedEntry) {
  return Boolean(emittedEntry?.id && receivedEntry?.id && emittedEntry.id === receivedEntry.id)
}

export function associationConfirmed(payload, documentId) {
  return payload?.entry?.childId === documentId
}
