import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createHierarchyServiceClient } from '../src/hierarchyServiceClient.js'
import { createHierarchyRepository } from '../src/hierarchyRepository.js'
import { planHierarchyMigration } from '../src/hierarchyMigrationPlanner.js'
import { resolveRole } from '../src/roleResolver.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(backendRoot, '..')
for (const envPath of [
  path.join(backendRoot, '.env.local'), path.join(projectRoot, '.env.local'),
  path.join(backendRoot, '.env'), path.join(projectRoot, '.env'),
]) {
  try { await fs.access(envPath); dotenv.config({ path: envPath, override: false, quiet: true }) } catch { /* optional env file */ }
}

function parseJson(name, fallback) {
  if (!process.env[name]) return fallback
  try { return JSON.parse(process.env[name]) } catch { throw Object.assign(new Error(), { code: `INVALID_JSON_${name}` }) }
}

function canonicalize(mapping, aliases) {
  return Object.fromEntries(Object.entries(mapping || {}).map(([key, value]) => {
    const normalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const values = (Array.isArray(value) ? value : [value]).map((item) =>
      item && typeof item === 'object' ? item.id || item.groupId || item.name || '' : item).filter(Boolean)
    return [aliases[normalized] || key, values.length === 1 ? values[0] : values]
  }))
}

function loadMappings() {
  if (process.env.ALFRESCO_GROUP_MAPPINGS_JSON) {
    const value = parseJson('ALFRESCO_GROUP_MAPPINGS_JSON', {})
    return {
      dependencies: canonicalize(value.dependencies, { dti: 'DTI', gddti: 'DTI', dsa: 'DSA', gddsa: 'DSA' }),
      functions: canonicalize(value.functions, { director: 'direccion', direccion: 'direccion', jefeunidad: 'jefe-unidad', especialista: 'especialista' }),
    }
  }
  return {
    dependencies: canonicalize(parseJson('ALFRESCO_DEPENDENCY_GROUP_MAPPINGS_JSON', {}), { dti: 'DTI', gddti: 'DTI', dsa: 'DSA', gddsa: 'DSA' }),
    functions: canonicalize(parseJson('ALFRESCO_ROLE_MAPPINGS_JSON', {}), { director: 'direccion', direccion: 'direccion', jefeunidad: 'jefe-unidad', especialista: 'especialista' }),
  }
}

const groupMappings = loadMappings()
const settings = {
  alfrescoTarget: (process.env.ALFRESCO_TARGET || '').replace(/\/+$/, ''),
  groupMappings,
  hierarchyService: {
    username: process.env.ALFRESCO_HIERARCHY_SERVICE_USERNAME || '',
    password: process.env.ALFRESCO_HIERARCHY_SERVICE_PASSWORD || '',
    containerNodeId: process.env.ALFRESCO_HIERARCHY_CONTAINER_NODE_ID || '',
    auditContainerNodeId: process.env.ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID || '',
    labContainerNodeId: process.env.ALFRESCO_HIERARCHY_LAB_CONTAINER_NODE_ID || '',
    storage: process.env.ALFRESCO_HIERARCHY_STORAGE || '',
  },
  userUnitAssignments: parseJson('ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON', {}),
}
const sourcePath = path.join(backendRoot, 'data', 'organization.json')

function safeError(error) {
  return { code: error?.code || 'READ_FAILED', status: Number.isInteger(error?.status) ? error.status : null }
}

try {
  const originalBytes = await fs.readFile(sourcePath)
  const organization = JSON.parse(originalBytes.toString('utf8'))
  const sourceSha256 = createHash('sha256').update(originalBytes).digest('hex')
  const service = createHierarchyServiceClient(settings)
  const repository = createHierarchyRepository(settings) // allowWrites remains false
  const roots = [...new Set([
    ...Object.values(groupMappings.dependencies || {}).flatMap((value) => Array.isArray(value) ? value : [value]),
    ...Object.values(groupMappings.functions || {}).flatMap((value) => Array.isArray(value) ? value : [value]),
  ].filter((value) => typeof value === 'string' && value))]
  const groupTrees = {}
  for (const groupId of roots) {
    try {
      const tree = await service.inspectGroupHierarchy(groupId)
      groupTrees[groupId] = {
        exists: true,
        displayName: tree.root.displayName,
        groups: tree.groups,
        directMemberCount: tree.people.filter((person) => person.directGroupIds.includes(groupId)).length,
        effectiveMemberCount: tree.people.length,
        people: tree.people,
        cycles: tree.cycles,
      }
    } catch (error) {
      groupTrees[groupId] = { exists: false, error: safeError(error) }
    }
  }

  const directorMapping = groupMappings.functions?.direccion || []
  const directorGroupIds = Array.isArray(directorMapping) ? directorMapping : [directorMapping]
  const directorUsers = new Set(directorGroupIds.flatMap((id) => groupTrees[id]?.people?.map((person) => person.id) || []))
  const dependencyGroups = Object.entries(groupMappings.dependencies || {}).flatMap(([dependency, values]) =>
    (Array.isArray(values) ? values : [values]).map((groupId) => ({ dependency, groupId })))
  const allTreeMemberships = new Map()
  for (const { dependency, groupId } of dependencyGroups) {
    for (const person of groupTrees[groupId]?.people || []) {
      if (!allTreeMemberships.has(person.id)) allTreeMemberships.set(person.id, new Set())
      allTreeMemberships.get(person.id).add(dependency)
    }
  }
  const functionalPeople = new Map()
  for (const [role, value] of Object.entries(groupMappings.functions || {})) {
    const ids = Array.isArray(value) ? value : [value]
    for (const groupId of ids) {
      for (const person of groupTrees[groupId]?.people || []) {
        if (!functionalPeople.has(person.id)) functionalPeople.set(person.id, new Set())
        functionalPeople.get(person.id).add(role)
      }
    }
  }
  const jsonRolesByUser = new Map()
  for (const assignment of Object.values(organization.hierarchies || {}).flatMap((hierarchy) => hierarchy?.assignments || [])) {
    const role = assignment.laneId === 'jefes' ? 'jefe-unidad' : assignment.laneId === 'especialistas' ? 'especialista' : null
    if (!role || !assignment.userId) continue
    if (!jsonRolesByUser.has(assignment.userId)) jsonRolesByUser.set(assignment.userId, new Set())
    jsonRolesByUser.get(assignment.userId).add(role)
  }
  const allPopulationIds = new Set([...functionalPeople.keys(), ...jsonRolesByUser.keys()])
  const authorizationPopulation = [...allPopulationIds].map((userId) => {
    const userDependencies = [...(allTreeMemberships.get(userId) || [])]
    return {
      userId,
      functionRoles: [...(functionalPeople.get(userId) || [])],
      jsonRoles: [...(jsonRolesByUser.get(userId) || [])],
      dependencies: userDependencies,
      dependencyStatus: userDependencies.length === 0 ? 'none' : userDependencies.length > 1 ? 'multiple' : 'single',
    }
  })
  const directorMemberships = []
  for (const userId of directorUsers) {
    let personGroups = []
    let personGroupsError = null
    try { personGroups = await service.getPersonGroups(userId) } catch (error) { personGroupsError = safeError(error) }
    const dependencyKeys = [...(allTreeMemberships.get(userId) || [])]
    const resolved = resolveRole(personGroups.map((group) => group.id), groupMappings, userId)
    directorMemberships.push({
      userId,
      configuredDependencyMemberships: dependencyKeys,
      personGroupsEndpoint: personGroupsError ? { error: personGroupsError } : { groupIds: personGroups.map((group) => group.id) },
      predictedRoleFromPersonGroups: {
        dependency: resolved.dependency,
        functionalRole: resolved.functionalRole,
        authorizationStatus: resolved.authorizationStatus,
      },
      sessionResolutionSource: 'authentication.groups capturado al iniciar sesión; el estado de una sesión existente no se consulta aquí.',
    })
  }

  const assignments = Object.values(organization.hierarchies || {}).flatMap((hierarchy) => hierarchy?.assignments || [])
  const directoryChecks = {}
  const directDirectoryGroups = {}
  const directoryMemberships = new Map()
  for (const groupId of roots) {
    try {
      const members = await service.getGroupMembers(groupId)
      directDirectoryGroups[groupId] = { readable: true, directPersonCount: members.length }
      for (const member of members) {
        if (!directoryMemberships.has(member.id)) directoryMemberships.set(member.id, new Set())
        directoryMemberships.get(member.id).add(groupId)
      }
    } catch (error) {
      directDirectoryGroups[groupId] = { readable: false, error: safeError(error) }
    }
  }
  const membershipSourceComparisons = []
  for (const assignment of assignments) {
    const role = assignment.laneId === 'jefes' ? 'jefe-unidad' : assignment.laneId === 'especialistas' ? 'especialista' : null
    const key = `${assignment.userId}|${assignment.dependency}|${role}`
    if (directoryChecks[key]) continue
    if (!role) { directoryChecks[key] = { valid: false, code: 'HIERARCHY_ASSIGNMENT_ROLE_INVALID' }; continue }
    try {
      const person = await service.getPerson(assignment.userId)
      if (person.enabled !== true) {
        directoryChecks[key] = { valid: false, personEnabled: false, code: 'HIERARCHY_USER_DISABLED' }
        continue
      }
      const queriedGroups = [...(directoryMemberships.get(assignment.userId) || [])]
      let personGroups = []
      try { personGroups = await service.getPersonGroups(assignment.userId) } catch (error) {
        membershipSourceComparisons.push({ userId: assignment.userId, personGroupsError: safeError(error) })
      }
      const personGroupIds = personGroups.map((group) => group.id).filter((id) => roots.includes(id))
      const inGroupList = new Set(queriedGroups)
      const inPersonEndpoint = new Set(personGroupIds)
      if (personGroups.length && (queriedGroups.some((id) => !inPersonEndpoint.has(id)) || personGroupIds.some((id) => !inGroupList.has(id)))) {
        membershipSourceComparisons.push({
          userId: assignment.userId,
          groupMembersEndpoint: queriedGroups,
          personGroupsEndpoint: personGroupIds,
          differs: true,
        })
      }
      const resolved = resolveRole(queriedGroups, groupMappings, assignment.userId)
      if (resolved.authorizationStatus === 'ambiguous') {
        directoryChecks[key] = { valid: false, personEnabled: true, code: 'HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS', groups: queriedGroups }
      } else if (resolved.authorizationStatus !== 'active') {
        directoryChecks[key] = { valid: false, personEnabled: true, code: 'HIERARCHY_USER_MEMBERSHIP_INCOMPLETE', groups: queriedGroups }
      } else if (resolved.dependency.toLowerCase() !== String(assignment.dependency).toLowerCase()) {
        directoryChecks[key] = { valid: false, personEnabled: true, code: 'HIERARCHY_USER_DEPENDENCY_MISMATCH', groups: queriedGroups }
      } else if (resolved.functionalRole !== role) {
        directoryChecks[key] = { valid: false, personEnabled: true, code: 'HIERARCHY_USER_FUNCTION_MISMATCH', groups: queriedGroups }
      } else if (roots.some((groupId) => !directDirectoryGroups[groupId]?.readable)) {
        directoryChecks[key] = { valid: false, personEnabled: true, code: 'HIERARCHY_DIRECTORY_GROUP_READ_INCOMPLETE', groups: queriedGroups }
      } else {
        directoryChecks[key] = { valid: true, personEnabled: true, dependency: resolved.dependency, role: resolved.functionalRole, groups: queriedGroups }
      }
    } catch (error) {
      const code = error.status === 404 ? 'HIERARCHY_USER_NOT_FOUND' : error.code || 'DIRECTORY_VALIDATION_FAILED'
      directoryChecks[key] = { valid: false, code }
    }
  }

  let existingUnits = []
  let existingAssignments = []
  let alfrescoReadError = null
  try {
    const unitsResult = await repository.listUnits({ includeInactive: true })
    const assignmentsResult = await repository.listAssignments({ includeInactive: true })
    existingUnits = unitsResult.units
    existingAssignments = assignmentsResult.assignments
  } catch (error) {
    alfrescoReadError = safeError(error).code
  }
  const migration = planHierarchyMigration({
    organization,
    sourceSha256,
    directoryChecks,
    userUnitAssignments: settings.userUnitAssignments,
    existingUnits,
    existingAssignments,
    alfrescoReadError,
  })

  const dependencySummary = {}
  for (const [dependency, groupIds] of Object.entries(groupMappings.dependencies || {})) {
    const ids = Array.isArray(groupIds) ? groupIds : [groupIds]
    const present = new Set(ids.flatMap((id) => groupTrees[id]?.people?.map((person) => person.id) || []))
    dependencySummary[dependency] = { groupIds: ids, effectiveMemberCount: present.size }
  }
  const report = {
    diagnosticMode: 'read-only',
    source: migration.source,
    configuredMappings: groupMappings,
    direction: {
      mappedGroupIds: directorGroupIds,
      configuredGroupTrees: Object.fromEntries(directorGroupIds.map((id) => [id, groupTrees[id] || { exists: false, error: { code: 'GROUP_NOT_MAPPED' } }])),
      directMemberCount: directorGroupIds.reduce((sum, id) => sum + (groupTrees[id]?.directMemberCount || 0), 0),
      effectiveMemberCount: directorUsers.size,
      bffSessionResolver: {
        functionalRole: 'direccion',
        mappedGroupIds: directorGroupIds,
        membershipSourceAtLogin: 'authentication.groups passed to resolveRole by createAlfrescoSession',
      },
      members: directorMemberships,
    },
    dependencies: dependencySummary,
    directoryGroupReads: directDirectoryGroups,
    membershipSourceComparisons,
    authorizationPopulation: {
      usersWithoutDependency: authorizationPopulation.filter((item) => item.dependencyStatus === 'none').length,
      usersWithMultipleDependencies: authorizationPopulation.filter((item) => item.dependencyStatus === 'multiple').length,
      users: authorizationPopulation,
    },
    groupTrees,
    directoryChecks,
    migration,
    guarantees: {
      alfrescoWritesAttempted: false,
      localFilesWritten: false,
      sessionGroupsComparedDirectly: false,
      sessionGroupSource: 'createAlfrescoSession resolves authentication.groups at login; no live session state is changed or read by this script.',
    },
  }
  console.log(JSON.stringify(report, null, 2))
  if (alfrescoReadError) process.exitCode = 2
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: safeError(error) }, null, 2))
  process.exitCode = 1
}
