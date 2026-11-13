export const DEFAULT_CAPABILITIES_BY_FUNCTION = {
  direccion: ['documents:read', 'documents:write', 'documents:emit'],
  'jefe-unidad': ['documents:read', 'documents:attend'],
  especialista: ['documents:read', 'documents:attend'],
}

export function capabilitiesFor(functionalRole, policy = DEFAULT_CAPABILITIES_BY_FUNCTION) {
  const capabilities = policy?.[functionalRole]
  return Array.isArray(capabilities) ? [...new Set(capabilities)] : []
}

export function hasCapability(session, capability) {
  return session?.authorizationStatus === 'active' && session.capabilities?.includes(capability) === true
}
