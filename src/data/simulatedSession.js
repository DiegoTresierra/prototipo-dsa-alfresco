export const simulatedUser = {
  id: 'usuario-simulado-dti',
  name: 'María Isabel Acurio',
  position: 'Directora de Tecnologías de Información',
  office: 'Dirección de Tecnologías de Información',
  acronym: 'DTI',
  role: 'director',
  dependencyId: 'dti',
  availableRoles: ['director'],
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
    role: 'director',
    dependencyId: 'dsa',
    availableRoles: ['director'],
    capabilities: ['emit', 'receive', 'approve', 'track'],
  },
}
