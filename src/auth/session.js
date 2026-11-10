import { directorProfiles } from '../data/simulatedSession'
import { getDemoAssignmentsForUser } from '../data/organizationalAssignments'

export function normalizeSessionIdentity(identity) {
  const dependency = identity.dependency || {
    id: identity.dependencyId,
    name: identity.office,
    acronym: identity.acronym,
  }
  const assignments = identity.assignments || []
  const assignedRoles = [...new Set(assignments.map((assignment) => assignment.roleId))]

  return {
    id: identity.id,
    name: identity.name,
    position: identity.position,
    role: identity.role,
    dependencyId: dependency.id,
    dependencyName: dependency.name,
    office: dependency.name,
    acronym: dependency.acronym,
    assignments,
    availableRoles: assignedRoles.length ? assignedRoles : identity.availableRoles || [identity.role],
  }
}

export function createDemoSession(profileKey) {
  const profile = directorProfiles[profileKey]
  if (!profile) throw new Error('Perfil de demostración desconocido.')

  const assignments = getDemoAssignmentsForUser(profile.id)

  return {
    mode: 'demo',
    activeRole: 'director',
    user: normalizeSessionIdentity({ ...profile, role: 'director', assignments, dependency: { id: profile.dependencyId, name: profile.office, acronym: profile.acronym } }),
  }
}
