import { isServiceIdentity } from './institutionalIdentity.js'
import { createHierarchyServiceClient } from './hierarchyServiceClient.js'
import { resolveRole } from './roleResolver.js'

const assignableRoles = new Set(['direccion', 'jefe-unidad', 'especialista'])

function failure(code, status = 403) {
  return Object.assign(new Error(code), { code, status })
}

function groupIds(mapping = {}) {
  return [...new Set(Object.values(mapping).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value) => typeof value === 'string' && value))]
}

export function createHierarchyDirectory(settings, { fetchImpl = globalThis.fetch } = {}) {
  const service = createHierarchyServiceClient(settings, fetchImpl)
  const mappings = settings?.groupMappings || { dependencies: {}, functions: {} }
  const dependencies = mappings.dependencies || {}
  const functions = mappings.functions || {}

  function assertMapping(dependency, role) {
    if (!Object.hasOwn(dependencies, dependency) || !groupIds({ [dependency]: dependencies[dependency] }).length) {
      throw failure('HIERARCHY_DEPENDENCY_GROUP_NOT_CONFIGURED', 503)
    }
    if (!assignableRoles.has(role)) throw failure('HIERARCHY_ASSIGNMENT_ROLE_INVALID', 400)
    if (!Object.hasOwn(functions, role) || !groupIds({ [role]: functions[role] }).length) {
      throw failure('HIERARCHY_FUNCTION_GROUP_NOT_CONFIGURED', 503)
    }
  }

  async function loadMemberships() {
    const membership = new Map()
    const allGroupIds = [...new Set([...groupIds(dependencies), ...groupIds(functions)])]
    if (!allGroupIds.length) throw failure('HIERARCHY_GROUP_MAPPINGS_REQUIRED', 503)
    for (const groupId of allGroupIds) {
      const members = await service.getInstitutionalGroupMembers(groupId)
      for (const member of members) {
        if (!membership.has(member.id)) membership.set(member.id, new Set())
        membership.get(member.id).add(groupId)
      }
    }
    return membership
  }

  // Exact memberships from configured institutional groups only; never infer unitId here.
  async function getConfiguredGroupsForPerson(userId) {
    if (typeof userId !== 'string' || !userId.trim()) throw failure('HIERARCHY_USER_REQUIRED', 400)
    const memberships = await loadMemberships()
    return [...(memberships.get(userId) || [])]
  }

  async function validateCandidate(userId, { dependency, role, memberships } = {}) {
    assertMapping(dependency, role)
    if (typeof userId !== 'string' || !userId.trim()) throw failure('HIERARCHY_USER_REQUIRED', 400)
    const memberGroups = memberships || await loadMemberships()
    const userGroups = memberGroups.get(userId)
    if (!userGroups) throw failure('HIERARCHY_USER_NOT_IN_CONFIGURED_GROUPS', 403)
    let person
    try {
      person = await service.getPerson(userId)
    } catch (error) {
      if (error.status === 404) throw failure('HIERARCHY_USER_NOT_FOUND', 404)
      throw error
    }
    if (person.id !== userId) throw failure('HIERARCHY_PERSON_ID_MISMATCH', 502)
    if (person.enabled !== true) throw failure('HIERARCHY_USER_DISABLED', 403)
    // Alfresco administrator capability is technical; functional eligibility still
    // requires exact dependency + role groups and an enabled person account.
    if (isServiceIdentity(settings, person.id)) throw failure('HIERARCHY_TECHNICAL_ACCOUNT_NOT_ASSIGNABLE', 403)
    const resolved = resolveRole([...userGroups], mappings, userId)
    if (resolved.authorizationStatus === 'ambiguous') throw failure('HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS', 409)
    if (resolved.authorizationStatus !== 'active') throw failure('HIERARCHY_USER_MEMBERSHIP_INCOMPLETE', 403)
    if (resolved.dependency !== dependency) throw failure('HIERARCHY_USER_DEPENDENCY_MISMATCH', 403)
    if (resolved.functionalRole !== role) throw failure('HIERARCHY_USER_FUNCTION_MISMATCH', 403)
    return {
      id: person.id,
      displayName: person.displayName || person.id,
      firstName: person.firstName || '',
      lastName: person.lastName || '',
      email: person.email || '',
      enabled: true,
      dependency: resolved.dependency,
      role: resolved.functionalRole,
      groups: [...userGroups],
    }
  }

  async function validateAssignmentCandidate(userId, options) {
    return validateCandidate(userId, options)
  }

  async function listCandidates({ dependency, role } = {}) {
    assertMapping(dependency, role)
    const memberships = await loadMemberships()
    const candidates = []
    const candidateIds = [...memberships.keys()].sort((a, b) => a.localeCompare(b))
    for (const userId of candidateIds) {
      try {
        candidates.push(await validateCandidate(userId, { dependency, role, memberships }))
      } catch (error) {
        if (![
          'HIERARCHY_USER_NOT_FOUND',
          'HIERARCHY_USER_DISABLED',
          'HIERARCHY_TECHNICAL_ACCOUNT_NOT_ASSIGNABLE',
          'HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS',
          'HIERARCHY_USER_MEMBERSHIP_INCOMPLETE',
          'HIERARCHY_USER_DEPENDENCY_MISMATCH',
          'HIERARCHY_USER_FUNCTION_MISMATCH',
        ].includes(error.code)) throw error
      }
    }
    return candidates
  }

  return { listCandidates, validateAssignmentCandidate, getConfiguredGroupsForPerson }
}
