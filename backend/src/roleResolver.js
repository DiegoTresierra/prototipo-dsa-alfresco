const DEFAULT_GROUP_MAPPINGS = {
  dependencies: {
    DTI: 'GROUP_GD_DTI',
    DSA: 'GROUP_GD_DSA',
  },
  functions: {
    direccion: 'GROUP_GD_DIRECCION',
    'jefe-unidad': 'GROUP_GD_JEFE_UNIDAD',
    especialista: 'GROUP_GD_ESPECIALISTA',
  },
}

function normalizeGroup(group) {
  let normalized = String(group || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
  normalized = normalized
    .replace(/^GROUP_/, '')
    .replace(/^GESTION\s+DOCUMENTAL\s*-\s*/, '')
    .replace(/^FUNCION[_\s-]*/, '')
    .replace(/^GD_/, '')
  return normalized.replace(/[^A-Z0-9]/g, '')
}

function matchingKeys(groups, mappings) {
  return Object.entries(mappings || {})
    .filter(([, configuredGroups]) => {
      const groupIds = Array.isArray(configuredGroups) ? configuredGroups : [configuredGroups]
      return groupIds.some((groupId) => groups.has(normalizeGroup(groupId)))
    })
    .map(([key]) => key)
}

function roleIdFor(dependency, functionalRole) {
  if (functionalRole === 'direccion') return `director-${dependency.toLowerCase()}`
  return `${functionalRole}-${dependency.toLowerCase()}`
}

export function resolveRole(groups = [], groupMappings = DEFAULT_GROUP_MAPPINGS, userId = null) {
  const normalizedGroups = new Set(groups.map(normalizeGroup).filter(Boolean))
  const dependencies = matchingKeys(normalizedGroups, groupMappings.dependencies)
  const functions = matchingKeys(normalizedGroups, groupMappings.functions)
  const hasOneDependency = dependencies.length === 1
  const hasOneFunction = functions.length === 1
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

export { DEFAULT_GROUP_MAPPINGS }
