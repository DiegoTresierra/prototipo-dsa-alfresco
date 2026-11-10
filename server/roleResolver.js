export function resolveRole(groups, roleMappings) {
  const normalizedGroups = new Set(groups.map((group) => group.toUpperCase()))
  const matches = Object.entries(roleMappings)
    .filter(([, configuredGroups]) => configuredGroups.some((group) => normalizedGroups.has(String(group).toUpperCase())))
    .map(([roleId]) => roleId)

  if (matches.length !== 1) {
    return { roleId: null, status: matches.length > 1 ? 'ambiguous-role' : 'no-role-assigned' }
  }

  return { roleId: matches[0], status: 'active' }
}
