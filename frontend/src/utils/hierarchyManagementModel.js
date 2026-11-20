const emptyMembers = () => ({ direccion: null, jefes: [], especialistas: [] })

export function createHierarchyManagementModel(result = {}) {
  const alfrescoReadOnly = Array.isArray(result.units)
  const recipients = Array.isArray(result.recipients) ? result.recipients : []
  const candidateIds = new Set(recipients.map((recipient) => recipient.id))
  const allAssignments = Array.isArray(result.assignments) ? result.assignments : []
  const assignments = alfrescoReadOnly
    ? allAssignments
    : allAssignments.filter((assignment) => candidateIds.has(assignment.userId))
  const members = emptyMembers()
  members.direccion = result.director || null
  members.jefes = assignments.filter((assignment) => assignment.laneId === 'jefes').map((assignment) => assignment.userId)
  members.especialistas = assignments.filter((assignment) => assignment.laneId === 'especialistas').map((assignment) => assignment.userId)

  const specialistUnits = Object.fromEntries(assignments
    .filter((assignment) => assignment.laneId === 'especialistas' && (alfrescoReadOnly ? assignment.unitId : assignment.unitHeadUserId))
    .map((assignment) => [assignment.userId, alfrescoReadOnly ? assignment.unitId : assignment.unitHeadUserId]))

  return {
    alfrescoReadOnly,
    units: alfrescoReadOnly ? result.units : [],
    recipients,
    assignments,
    members,
    specialistUnits,
    staleCount: allAssignments.filter((assignment) => !candidateIds.has(assignment.userId)).length,
  }
}
