export function dispatchPersistenceError(code, fallback) {
  return {
    DISPATCH_ALFRESCO_MODEL_NOT_READY: 'La persistencia Alfresco aún no está habilitada: falta desplegar o validar las propiedades del modelo gd:tramite.',
    DISPATCH_ALFRESCO_WRITES_DISABLED: 'La escritura de asignaciones en Alfresco está desactivada para este piloto.',
    DISPATCH_PILOT_DOCUMENT_NOT_ALLOWED: 'Este documento no está autorizado como documento de prueba del piloto.',
    DISPATCH_NODE_UPDATE_DENIED: 'La cuenta técnica no tiene permiso efectivo de actualización sobre este documento. No se cambiaron permisos.',
    DISPATCH_NODE_READ_DENIED: 'Alfresco denegó la lectura del documento.',
    DISPATCH_INVALID_ASSIGNMENTS: 'Las asignaciones existentes no tienen un formato válido. Se detuvo la operación para conservarlas.',
    DISPATCH_ASSIGNMENTS_PROJECTION_MISMATCH: 'Los responsables registrados no coinciden con las asignaciones del documento. Se requiere revisión antes de continuar.',
    DISPATCH_ASSIGNMENTS_SIZE_LIMIT: 'El historial alcanzó el límite de tamaño del piloto. Se requiere revisión antes de añadir asignaciones.',
    DISPATCH_EXTERNAL_MODIFICATION: 'El documento cambió durante el despacho. Actualiza la bandeja antes de reintentar.',
    DISPATCH_WRITE_VERIFICATION_FAILED: 'La lectura posterior no coincide con lo escrito. El resultado requiere revisión; no se intentó revertir el documento.',
    DISPATCH_WRITE_OUTCOME_UNKNOWN: 'No se pudo confirmar el resultado en Alfresco. Actualiza la bandeja y reintenta con la misma solicitud.',
  }[code] || fallback
}

export function documentResponsibilities(records, documentId) {
  return [...new Map(records.filter((record) => record.documentId === documentId)
    .flatMap((record) => record.recipients || [])
    .filter((recipient) => ['ASIGNADO', 'DESPACHADO'].includes(recipient.status))
    .map((recipient) => [recipient.userId, recipient])).values()]
}
