function normalizeGroupId(group) {
  return String(group).toUpperCase().replace(/^GROUP_/, '')
}

export function resolveRole(groups, roleMappings) {
  const normalizedGroups = new Set(groups.map(normalizeGroupId))
  const matches = Object.entries(roleMappings)
    .filter(([, configuredGroups]) => configuredGroups.some((group) => normalizedGroups.has(normalizeGroupId(group))))
    .map(([roleId]) => roleId)

  if (matches.length !== 1) {
    return { roleId: null, status: matches.length > 1 ? 'ambiguous-role' : 'no-role-assigned' }
  }

  return { roleId: matches[0], status: 'active' }
}

export function resolveDependency(groups, dependencyMappings) {
  const normalizedGroups = new Set(groups.map(normalizeGroupId))
  const matches = Object.entries(dependencyMappings)
    .filter(([groupId]) => normalizedGroups.has(normalizeGroupId(groupId)))
    .map(([, dependency]) => dependency)

  if (matches.length !== 1) {
    return { dependency: null, status: matches.length > 1 ? 'ambiguous-dependency' : 'no-dependency-assigned' }
  }

  return { dependency: matches[0], status: 'active' }
}

export function resolveAccess(groups, roleMappings, dependencyMappings) {
  const groupRole = resolveRole(groups, roleMappings)
  if (groupRole.status !== 'active') return { ...groupRole, dependency: null }

  const groupDependency = resolveDependency(groups, dependencyMappings)
  if (groupDependency.status !== 'active') {
    return { roleId: null, status: groupDependency.status, dependency: null }
  }

  return { roleId: groupRole.roleId, status: 'active', dependency: groupDependency.dependency }
}
