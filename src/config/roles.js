const item = (id, label, description, icon = 'file') => ({ id, label, description, icon })

const directorMenu = [
  item('inicio', 'Inicio', 'Resumen de la actividad documental de la dependencia.', 'home'),
  item('nuevo-documento', 'Nuevo documento', 'Registra un documento emitido por la dependencia.'),
  item('documentos-enviados', 'Documentos enviados', 'Consulta los documentos emitidos por esta dependencia.', 'inbox'),
  item('para-conocimiento', 'Para conocimiento', 'Consulta documentos recibidos para conocimiento.', 'inbox'),
  item('para-atencion', 'Para atención', 'Consulta documentos recibidos para atención.', 'review'),
  item('mis-documentos', 'Mis documentos', 'Consulta documentos relacionados con la dependencia.', 'archive'),
  item('aprobar-colaboradores', 'Aprobar colaboradores', 'Espacio de demostración para solicitudes de colaboradores.'),
  item('aprobar-cierres', 'Aprobar cierres', 'Espacio de demostración para solicitudes de cierre.'),
  item('seguimiento', 'Seguimiento', 'Consulta el seguimiento documental de demostración.', 'chart'),
]

export const roleDefinitions = {
  'director-dti': { id: 'director-dti', label: 'Dirección DTI', menu: directorMenu },
  'director-dsa': { id: 'director-dsa', label: 'Dirección DSA', menu: directorMenu },
  especialista: { id: 'especialista', label: 'Especialista responsable', menu: [item('inicio', 'Inicio', 'Consulta el espacio de trabajo del especialista responsable.', 'home'), item('mis-asignaciones', 'Mis asignaciones', 'Consulta los documentos asignados al responsable seleccionado.', 'inbox'), item('solicitar-colaborador', 'Solicitar colaborador', 'Espacio reservado para solicitudes de apoyo.'), item('solicitar-cierre', 'Solicitar cierre', 'Espacio reservado para solicitudes de cierre.'), item('historial', 'Historial', 'Consulta del historial de actividades del especialista.', 'archive')] },
  colaborador: { id: 'colaborador', label: 'Colaborador', menu: [item('inicio', 'Inicio', 'Consulta el espacio de trabajo del colaborador.', 'home'), item('mis-actividades', 'Mis actividades', 'Consulta de las actividades asignadas al colaborador.', 'inbox'), item('documentos-compartidos', 'Documentos compartidos', 'Consulta de documentos compartidos para colaboración.', 'archive'), item('resultados', 'Resultados', 'Consulta de resultados asociados a las actividades.', 'chart')] },
  tecnico: { id: 'tecnico', label: 'Técnico (pruebas API)', menu: [item('inicio', 'Inicio', 'Consulta el espacio de pruebas del rol Técnico.', 'home'), item('consultar-documentos', 'Consultar documentos', 'Espacio reservado para futuras consultas técnicas.', 'inbox'), item('metadatos', 'Metadatos', 'Espacio reservado para revisar metadatos técnicos.'), item('pruebas-conexion', 'Pruebas de conexión', 'Espacio reservado para futuras pruebas de conexión.')] },
}
