import { organizationalUnits } from './emisorCatalog'
import { directorProfiles } from './simulatedSession'

// Relaciones de demostración para preparar la estructura de asignaciones.
// Son datos de interfaz: no conceden ni verifican permisos de Alfresco.
export const organizationalDependencies = Object.values(directorProfiles).map((profile) => ({
  id: profile.dependencyId,
  name: profile.office,
  acronym: profile.acronym,
}))

export const organizationalOffices = organizationalUnits.map((unit) => ({
  id: unit.id,
  dependencyId: unit.dependencyId,
  parentOfficeId: unit.parentId,
  name: unit.name,
  positions: unit.positions.map((position) => ({
    id: position.id,
    title: position.title,
    roleId: position.title === 'Dirección'
      ? 'director'
      : position.title === 'Jefatura'
        ? 'jefe_unidad'
        : position.title.startsWith('Especialista')
          ? 'especialista'
          : null,
    displayName: position.recipientName,
    reportsToPositionId: position.reportsToPositionId,
    available: position.available,
  })),
}))

const demoAssignments = [
  {
    id: 'asignacion-demo-director-dti',
    userId: directorProfiles.DTI.id,
    roleId: 'director',
    dependencyId: 'dti',
    officeIds: [],
    reportsToAssignmentId: null,
    source: 'demo',
  },
  {
    id: 'asignacion-demo-director-dsa',
    userId: directorProfiles.DSA.id,
    roleId: 'director',
    dependencyId: 'dsa',
    officeIds: organizationalUnits
      .filter((unit) => unit.dependencyId === 'dsa' && unit.parentId)
      .map((unit) => unit.id),
    reportsToAssignmentId: null,
    source: 'demo',
  },
]

export function getDemoAssignmentsForUser(userId) {
  return demoAssignments.filter((assignment) => assignment.userId === userId)
}
