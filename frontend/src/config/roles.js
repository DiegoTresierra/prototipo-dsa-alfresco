const item = (id, label, description, icon = 'file') => ({ id, label, description, icon })
const emittedItem = () => item('documentos-enviados', 'Emitidos', 'Consulta tus originales accesibles en Alfresco.', 'inbox')
const newDocumentItem = () => item('nuevo-documento', 'Nuevo documento', 'Registra un documento emitido por el usuario autenticado.')

const directorMenu = [
  item('inicio', 'Inicio', 'Resumen de la actividad documental de la dependencia.', 'home'),
  item('nuevo-documento', 'Nuevo documento', 'Registra un documento emitido por la dependencia.'),
  item('documentos-enviados', 'Emitidos', 'Consulta los originales emitidos por tu dependencia en Alfresco.', 'inbox'),
  item('documentos-recibidos', 'Documentos recibidos', 'Consulta documentos enviados a la carpeta de recepción de esta dependencia.', 'inbox'),
  item('para-atencion', 'Para atención', 'Documentos que seleccionaste Para mí desde Recibidos.', 'review'),
  item('mis-documentos', 'Mis documentos', 'Consulta los originales de tu dependencia creados por tu usuario.', 'archive'),
  item('aprobar-cierres', 'Aprobar cierres', 'Evalúa las intervenciones de tu dependencia; el cierre real permanece protegido.'),
  item('seguimiento', 'Seguimiento', 'Consulta estados publicados por Alfresco.', 'chart'),
  item('gestion-jerarquia', 'Ajustes', 'Administra la organización documental de tu oficina.', 'users'),
]

const directorRole = { id: 'director', label: 'Director', menu: directorMenu }

export const roleDefinitions = {
  director: directorRole,
  'director-dti': directorRole,
  'director-dsa': directorRole,
  'jefe-unidad-dti': {
    id: 'jefe-unidad-dti',
    label: 'Jefatura de Unidad DTI',
    menu: [item('inicio', 'Inicio', 'Vista autorizada de la jefatura de unidad.', 'home'), newDocumentItem(), item('documentos-recibidos', 'Documentos recibidos', 'Consulta documentos recibidos para la unidad.', 'inbox')],
  },
  'jefe-unidad-dsa': {
    id: 'jefe-unidad-dsa',
    label: 'Jefatura de Unidad DSA',
    menu: [item('inicio', 'Inicio', 'Vista autorizada de la jefatura de unidad.', 'home'), newDocumentItem(), item('documentos-recibidos', 'Documentos recibidos', 'Consulta documentos recibidos para la unidad.', 'inbox')],
  },
  'especialista-dti': {
    id: 'especialista-dti',
    label: 'Especialista DTI',
    menu: [item('inicio', 'Inicio', 'Consulta el espacio de trabajo del especialista.', 'home'), newDocumentItem(), item('documentos-recibidos', 'Documentos recibidos', 'Consulta los documentos recibidos por esta cuenta.', 'inbox'), item('mis-asignaciones', 'Mis asignaciones', 'Consulta documentos asignados.', 'inbox')],
  },
  'especialista-dsa': {
    id: 'especialista-dsa',
    label: 'Especialista DSA',
    menu: [item('inicio', 'Inicio', 'Consulta el espacio de trabajo del especialista.', 'home'), newDocumentItem(), item('documentos-recibidos', 'Documentos recibidos', 'Consulta los documentos recibidos por esta cuenta.', 'inbox'), item('mis-asignaciones', 'Mis asignaciones', 'Consulta documentos asignados.', 'inbox')],
  },
  jefe_unidad: {
    id: 'jefe_unidad',
    label: 'Jefe de unidad',
    menu: [item('inicio', 'Inicio', 'Espacio de trabajo del jefe de unidad.', 'home'), newDocumentItem(), item('documentos-recibidos', 'Documentos recibidos', 'Consulta los documentos recibidos por esta cuenta.', 'inbox')],
  },
  especialista: { id: 'especialista', label: 'Especialista responsable', menu: [item('inicio', 'Inicio', 'Consulta el espacio de trabajo del especialista responsable.', 'home'), newDocumentItem(), item('mis-asignaciones', 'Mis asignaciones', 'Consulta tus encargos individuales sobre los documentos originales.', 'inbox'), item('solicitar-colaborador', 'Solicitar colaborador', 'Espacio reservado para solicitudes de apoyo.'), item('solicitar-cierre', 'Solicitar cierre', 'Espacio reservado para solicitudes de cierre.'), item('historial', 'Historial', 'Consulta del historial de actividades del especialista.', 'archive')] },
  colaborador: { id: 'colaborador', label: 'Colaborador', menu: [item('inicio', 'Inicio', 'Consulta el espacio de trabajo del colaborador.', 'home'), newDocumentItem(), item('mis-actividades', 'Mis actividades', 'Consulta de las actividades asignadas al colaborador.', 'inbox'), item('documentos-compartidos', 'Documentos compartidos', 'Consulta de documentos compartidos para colaboración.', 'archive'), item('resultados', 'Resultados', 'Consulta de resultados asociados a las actividades.', 'chart')] },
  tecnico: { id: 'tecnico', label: 'Técnico (pruebas API)', menu: [item('inicio', 'Inicio', 'Consulta el espacio de pruebas del rol Técnico.', 'home'), newDocumentItem(), item('consultar-documentos', 'Consultar documentos', 'Espacio reservado para futuras consultas técnicas.', 'inbox'), item('metadatos', 'Metadatos', 'Espacio reservado para revisar metadatos técnicos.'), item('pruebas-conexion', 'Pruebas de conexión', 'Espacio reservado para futuras pruebas de conexión.')] },
}

for (const role of new Set(Object.values(roleDefinitions))) {
  if (role.id?.startsWith('jefe-unidad-')) {
    role.menu.push(item('derivaciones-enviadas', 'Derivaciones realizadas', 'Consulta los encargos que derivaste a especialistas.', 'inbox'))
  }
  if (!role.menu.some((entry) => entry.id === 'documentos-recibidos')) {
    const newDocumentIndex = role.menu.findIndex((entry) => entry.id === 'nuevo-documento')
    role.menu.splice(newDocumentIndex + 1, 0, item('documentos-recibidos', 'Documentos recibidos', 'Consulta los documentos recibidos por esta cuenta.', 'inbox'))
  }
}

// Navigation only: backend identity, documentary competence and ACL remain mandatory.
for (const roleId of ['jefe-unidad-dti', 'jefe-unidad-dsa', 'jefe_unidad', 'especialista-dti', 'especialista-dsa', 'especialista']) {
  roleDefinitions[roleId].menu.splice(2, 0, emittedItem())
}
