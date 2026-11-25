function canonicalizeMappingKeys(mapping, aliases) {
  const result = Object.create(null)
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('INVALID_GROUP_MAPPINGS')
  for (const [key, configuredGroups] of Object.entries(mapping)) {
    const normalizedKey = String(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const groupIds = Array.isArray(configuredGroups) ? configuredGroups : [configuredGroups]
    const normalizedGroups = groupIds.map((group) => {
      if (group && typeof group === 'object') return group.id || group.groupId || group.name || ''
      return group
    }).filter(Boolean)
    const canonicalKey = Object.hasOwn(aliases, normalizedKey) ? aliases[normalizedKey] : key
    if (Object.hasOwn(result, canonicalKey) || normalizedGroups.length !== groupIds.length ||
        normalizedGroups.some(id => typeof id !== 'string' || !/^GROUP_[A-Za-z0-9_-]+$/.test(id))) {
      throw new Error('INVALID_GROUP_MAPPINGS')
    }
    result[canonicalKey] = normalizedGroups.length === 1 ? normalizedGroups[0] : normalizedGroups
  }
  return result
}

function normalizeGroupMappings(dependencies, functions) {
  const mappings = {
    dependencies: canonicalizeMappingKeys(dependencies, { dti: 'DTI', gddti: 'DTI', dsa: 'DSA', gddsa: 'DSA' }),
    functions: canonicalizeMappingKeys(functions, {
      director: 'direccion',
      direccion: 'direccion',
      jefeunidad: 'jefe-unidad',
      especialista: 'especialista',
    }),
  }
  const officeIds = new Set(Object.values(mappings.dependencies).flat())
  if (Object.values(mappings.functions).flat().some(id => officeIds.has(id))) {
    throw new Error('INVALID_GROUP_MAPPINGS')
  }
  return mappings
}

export function parseGroupMappings(environment = process.env) {
  const read = (name, fallback) => {
    if (!environment[name]) return fallback
    try { return JSON.parse(environment[name]) }
    catch { throw new Error(`Invalid JSON configuration: ${name}`) }
  }
  if (environment.ALFRESCO_GROUP_MAPPINGS_JSON) {
    const mappings = read('ALFRESCO_GROUP_MAPPINGS_JSON', {})
    return normalizeGroupMappings(mappings.dependencies || {}, mappings.functions || {})
  }

  const dependencies = read('ALFRESCO_DEPENDENCY_GROUP_MAPPINGS_JSON', {})
  const functions = read('ALFRESCO_ROLE_MAPPINGS_JSON', {})
  if (Object.keys(dependencies).length || Object.keys(functions).length) return normalizeGroupMappings(dependencies, functions)

  return { dependencies: {}, functions: {} }
}

export function distributionGroupIds(mappings, explicit) {
  if (explicit !== undefined) return explicit
  return Object.fromEntries(Object.entries(mappings.dependencies)
    .filter(([, id]) => typeof id === 'string' && id.startsWith('GROUP_')))
}
