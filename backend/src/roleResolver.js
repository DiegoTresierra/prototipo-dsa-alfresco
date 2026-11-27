function matchingKeys(groups, mappings) {
  return Object.entries(mappings || {})
    .filter(([, configuredGroups]) => {
      const groupIds = Array.isArray(configuredGroups) ? configuredGroups : [configuredGroups]
      return groupIds.some((groupId) => typeof groupId === 'string' && groups.has(groupId))
    })
    .map(([key]) => key)
}

function roleIdFor(dependency, functionalRole) {
  if (functionalRole === 'direccion') return `director-${dependency.toLowerCase()}`
  return `${functionalRole}-${dependency.toLowerCase()}`
}

export function resolveRole(groups = [], groupMappings = {}, userId = null) {
  const normalizedGroups = new Set(groups.filter((group) => typeof group === 'string' &&
    group.toUpperCase() !== 'GROUP_ALFRESCO_ADMINISTRATORS'))
  const dependencies = matchingKeys(normalizedGroups, groupMappings.dependencies)
  const functions = matchingKeys(normalizedGroups, groupMappings.functions)
  const hasOneDependency = dependencies.length === 1
  const hasOneFunction = functions.length === 1 && ['direccion', 'jefe-unidad', 'especialista'].includes(functions[0])
  const authorizationStatus = hasOneDependency && hasOneFunction
    ? 'active'
    : dependencies.length > 1 || functions.length > 1
      ? 'ambiguous'
      : 'incomplete'

  const dependency = hasOneDependency ? dependencies[0] : null
  const functionalRole = hasOneFunction ? functions[0] : null

  return {
    userId,
    dependency,
    functionalRole,
    authorizationStatus,
    status: authorizationStatus,
    roleId: authorizationStatus === 'active' ? roleIdFor(dependency, functionalRole) : null,
    groups,
  }
}
