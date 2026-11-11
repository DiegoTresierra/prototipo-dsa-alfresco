// Catálogo de demostración basado únicamente en la estructura y los nombres proporcionados.
// No representa un directorio institucional validado ni incorpora funciones oficiales del MOF.
export const recipientDependencies = [
  { id: 'dsa', name: 'Dirección de Servicios Académicos (DSA)', available: true },
  { id: 'dependencia-demo-bienestar', name: 'Dirección de Bienestar Universitario (demostrativa)', available: false },
  { id: 'dependencia-demo-investigacion', name: 'Dirección de Investigación (demostrativa)', available: false },
  { id: 'dependencia-demo-administracion', name: 'Dirección de Administración (demostrativa)', available: false },
]

const provisionalFunctions = 'Funciones del MOF pendientes de incorporación. Esta descripción es provisional y no constituye una función oficial.'

const position = (id, title, recipientName, options = {}) => ({
  id,
  title,
  recipientName,
  available: options.available ?? true,
  reportsToPositionId: options.reportsToPositionId || null,
  functionsDescription: provisionalFunctions,
})

export const organizationalUnits = [
  {
    id: 'dsa-direccion',
    name: 'Dirección',
    dependencyId: 'dsa',
    parentId: null,
    positions: [
      position('dsa-puesto-direccion', 'Dirección', 'Responsable no especificado'),
      position('dsa-secretaria-direccion', 'Secretaría', 'Bethzabet'),
    ],
  },
  {
    id: 'dsa-procesos-tecnicos',
    name: 'Unidad de Procesos Técnicos',
    dependencyId: 'dsa',
    parentId: 'dsa-direccion',
    positions: [
      position('dsa-pt-jefatura', 'Jefatura', 'Erika'),
      position('dsa-pt-soporte-academico', 'Técnico en Soporte Académico', 'Paul'),
      position('dsa-pt-matriculas-especiales', 'Especialista en Soporte de Matrículas Especiales', 'Nicaise'),
      position('dsa-pt-homologacion-convalidacion', 'Especialista en Homologación y Convalidación', 'Humberto'),
      position('dsa-pt-emision-soporte-documentos', 'Especialista en Emisión y Soporte de Documentos Académicos', 'Alex'),
      position('dsa-pt-tecnico-emision-documentos', 'Técnico en emisión de documentos académicos', 'Roy', { reportsToPositionId: 'dsa-pt-emision-soporte-documentos' }),
    ],
  },
  {
    id: 'dsa-registro-central-estadistica',
    name: 'Unidad de Registro Central y Estadística Académica',
    dependencyId: 'dsa',
    parentId: 'dsa-direccion',
    positions: [
      position('dsa-rcea-registro-estadistica', 'Especialista en Registro y Estadística Académica', 'Giancarlo'),
      position('dsa-rcea-tecnico-registro-central', 'Técnico de registro central', 'Plaza disponible', { available: false }),
    ],
  },
]

export const documentTypes = ['Oficio', 'Memorando', 'Informe', 'Solicitud', 'Carta']
export const documentPriorities = ['Normal', 'Alta', 'Urgente']
