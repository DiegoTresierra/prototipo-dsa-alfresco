export const simulatedUser = {
  id: 'usuario-simulado-dti',
  name: 'María Isabel Acurio',
  position: 'Directora de Tecnologías de Información',
  office: 'Dirección de Tecnologías de Información',
  acronym: 'DTI',
  dependencyId: 'dti',
  availableRoles: ['director-dti'],
  capabilities: ['emit', 'receive', 'approve', 'track'],
}

export const directorProfiles = {
  DTI: simulatedUser,
  DSA: {
    id: 'perfil-director-dsa-demostracion',
    name: 'Perfil de demostración',
    position: 'Dirección de Servicios Académicos',
    office: 'Dirección de Servicios Académicos',
    acronym: 'DSA',
    dependencyId: 'dsa',
    availableRoles: ['director-dsa'],
    capabilities: ['emit', 'receive', 'approve', 'track'],
  },
}
