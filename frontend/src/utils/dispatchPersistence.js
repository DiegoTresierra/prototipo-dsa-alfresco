export function dispatchPersistenceError(code, fallback) {
  return {
    DISPATCH_HIERARCHY_UNAVAILABLE: 'No se pudo verificar la jerarquía institucional. Revisa la configuración de lectura y actualiza los destinos.',
    DISPATCH_HIERARCHY_DATA_INVALID: 'La jerarquía tiene relaciones ambiguas o datos incompatibles. Solicita una revisión antes de despachar.',
    DISPATCH_HIERARCHY_RECONCILIATION_REQUIRED: 'Hay una operación de jerarquía pendiente de confirmar. Los despachos por unidad siguen bloqueados hasta que se resuelva.',
    DISPATCH_HIERARCHY_REVISION_CONFLICT: 'La jerarquía cambió. Vuelve a seleccionar la unidad y el destinatario cuando se actualicen los destinos.',
    DISPATCH_HIERARCHY_REVISION_REQUIRED: 'Actualiza los destinos antes de confirmar el despacho.',
    DISPATCH_UNIT_REQUIRED: 'Selecciona una unidad organizacional válida.',
    DISPATCH_UNIT_NOT_APPLICABLE: 'La selección por unidad se usa en el despacho institucional de Dirección DSA.',
    DISPATCH_UNIT_NOT_ALLOWED: 'La unidad no está activa o no pertenece a esta dependencia.',
    DISPATCH_UNIT_RECIPIENT_NOT_ALLOWED: 'Uno o más destinatarios ya no tienen una asignación activa y habilitada en esta unidad.',
    DISPATCH_ALFRESCO_MODEL_NOT_READY: 'La persistencia Alfresco aún no está habilitada: falta desplegar o validar las propiedades del modelo gd:tramite.',
    DISPATCH_ALFRESCO_WRITES_DISABLED: 'La escritura de asignaciones en Alfresco está desactivada para este piloto.',
    DISPATCH_INSTITUTIONAL_SCOPE_REQUIRED: 'Falta configurar las bandejas institucionales del despacho.',
    DISPATCH_PILOT_ENVIRONMENT_REQUIRED: 'Confirma el entorno DEV o preproducción, su destino específico y la ejecución de una sola instancia antes de habilitar escrituras.',
    DISPATCH_NODE_UPDATE_DENIED: 'La cuenta técnica no tiene permiso efectivo de actualización sobre este documento. No se cambiaron permisos.',
    DISPATCH_NODE_READ_DENIED: 'Alfresco denegó la lectura del documento.',
    DISPATCH_INVALID_ASSIGNMENTS: 'Las asignaciones existentes no tienen un formato válido. Se detuvo la operación para conservarlas.',
    DISPATCH_ASSIGNMENTS_PROJECTION_MISMATCH: 'Los responsables registrados no coinciden con las asignaciones del documento. Se requiere revisión antes de continuar.',
    DISPATCH_ASSIGNMENTS_SIZE_LIMIT: 'El historial alcanzó el límite de tamaño del piloto. Se requiere revisión antes de añadir asignaciones.',
    DISPATCH_EXTERNAL_MODIFICATION: 'El documento cambió durante el despacho. Actualiza la bandeja antes de reintentar.',
    DISPATCH_WRITE_VERIFICATION_FAILED: 'La lectura posterior no coincide con lo escrito. El resultado requiere revisión; no se intentó revertir el documento.',
    DISPATCH_WRITE_OUTCOME_UNKNOWN: 'No se pudo confirmar el resultado en Alfresco. Verifica el resultado antes de iniciar otra operación.',
  }[code] || fallback
}

export function withDispatchPersistence(records, persistence) {
  return records.map((record) => ({ ...record, persistence: persistence === 'alfresco' ? 'alfresco' : 'local' }))
}

export function requireDispatchPersistence(persistence) {
  if (persistence === 'local') throw new Error('El backend usa persistencia local provisional. No se puede presentar como una bandeja institucional Alfresco; revisa la configuración sin migrar ni borrar los datos anteriores.')
  if (persistence !== 'alfresco') throw new Error('El backend no informa el origen de las asignaciones. Reinicia el backend actualizado y vuelve a consultar la bandeja.')
}

export function documentResponsibilities(records, documentId, requireAlfresco = false) {
  return [...new Map(records.filter((record) => record.documentId === documentId && (!requireAlfresco || record.persistence === 'alfresco'))
    .flatMap((record) => record.recipients || [])
    .filter((recipient) => ['ASIGNADO', 'DESPACHADO'].includes(recipient.status))
    .map((recipient) => [recipient.userId, recipient])).values()]
}

export function assignmentBackground(colors) {
  if (!colors.length) return undefined
  return `linear-gradient(to bottom, ${colors.map((color, index) =>
    `${color.replace(/\)$/, ' / 0.06)')} ${index * 100 / colors.length}% ${(index + 1) * 100 / colors.length}%`).join(', ')})`
}
