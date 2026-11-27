const emptyMembers = () => ({ direccion: null, jefes: [], especialistas: [] })

export function listAvailableHierarchyCandidates(recipients = [], { role, dependency, assignedIds = new Set(), query = '' } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase('es')
  return recipients.filter((recipient) => recipient.functionalRole === role &&
    String(recipient.dependency || '').toLowerCase() === String(dependency || '').toLowerCase() &&
    !assignedIds.has(recipient.id) &&
    (!normalizedQuery || `${recipient.displayName} ${recipient.id}`.toLocaleLowerCase('es').includes(normalizedQuery)))
}

export function createHierarchyManagementModel(result = {}) {
  const alfrescoReadOnly = Array.isArray(result?.units)
  const units = alfrescoReadOnly ? result.units : []
  const recipients = Array.isArray(result?.recipients) ? result.recipients : []
  const candidateIds = new Set(recipients.map(recipient => recipient.id))
  const allAssignments = Array.isArray(result?.assignments) ? result.assignments : []
  const assignments = alfrescoReadOnly
    ? allAssignments
    : allAssignments.filter(assignment => candidateIds.has(assignment.userId))
  const members = emptyMembers()
  members.direccion = result.director || null
  members.jefes = assignments.filter(assignment => assignment.laneId === 'jefes').map(assignment => assignment.userId)
  members.especialistas = assignments.filter(assignment => assignment.laneId === 'especialistas').map(assignment => assignment.userId)

  const specialistUnits = Object.fromEntries(assignments
    .filter(assignment => assignment.laneId === 'especialistas' && (alfrescoReadOnly ? assignment.unitId : assignment.unitHeadUserId))
    .map(assignment => [assignment.userId, alfrescoReadOnly ? assignment.unitId : assignment.unitHeadUserId]))

  return {
    alfrescoReadOnly,
    units,
    recipients,
    assignments,
    members,
    specialistUnits,
    staleCount: allAssignments.filter(assignment => !candidateIds.has(assignment.userId)).length,
  }
}
