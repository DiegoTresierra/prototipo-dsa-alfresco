const emptyMembers = () => ({ direccion: null, jefes: [], especialistas: [] })

export function createHierarchyManagementModel(result = {}) {
  if (![result?.units, result?.recipients, result?.assignments].every(Array.isArray)) {
    throw new Error('Alfresco no devolvió una jerarquía institucional completa.')
  }
  const { units, recipients, assignments } = result
  const candidateIds = new Set(recipients.map(recipient => recipient.id))
  const members = emptyMembers()
  members.direccion = result.director || null
  members.jefes = assignments.filter((assignment) => assignment.laneId === 'jefes').map((assignment) => assignment.userId)
  members.especialistas = assignments.filter((assignment) => assignment.laneId === 'especialistas').map((assignment) => assignment.userId)

  const specialistUnits = Object.fromEntries(assignments
    .filter((assignment) => assignment.laneId === 'especialistas' && assignment.unitId)
    .map((assignment) => [assignment.userId, assignment.unitId]))

  return {
    units,
    recipients,
    assignments,
    members,
    specialistUnits,
    staleCount: assignments.filter((assignment) => !candidateIds.has(assignment.userId)).length,
  }
}
