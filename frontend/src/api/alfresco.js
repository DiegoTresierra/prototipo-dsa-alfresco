import { apiFetch } from './client'
import { collectInboxPages } from '../utils/inboxPages'
import { loadAssignmentInbox } from '../utils/assignmentInbox'
import { dispatchPersistenceError, requireDispatchPersistence, withDispatchPersistence } from '../utils/dispatchPersistence'
import { nodeToDocument } from '../utils/documentMapping.js'

const coreApiPrefix = '/api/alfresco/api/-default-/public/alfresco/versions/1'
const searchApiPrefix = '/api/alfresco/api/-default-/public/search/versions/1'

export async function getClosureEvaluation(documentId) {
  const r = await apiFetch(`/api/documents/closure?documentId=${encodeURIComponent(documentId)}`, { credentials: 'include', headers: { Accept: 'application/json' } })
  const body = await r.json()
  if (!r.ok) throw new Error(body.error || 'No se pudo evaluar el cierre.')
  if (body.evaluation?.documentId !== documentId || !Array.isArray(body.evaluation?.blockingReasons) || typeof body.canClose !== 'boolean' || typeof body.writesEnabled !== 'boolean') throw new Error('Evaluación incompleta. Consulta nuevamente.')
  return body
}
export async function getClosureInbox() {
  const r = await apiFetch('/api/documents/closure', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || 'No se pudo consultar la bandeja de cierre.')
  if (body.source !== 'alfresco' || body.semantics !== 'dependency-closure-interventions' || !Array.isArray(body.documents) ||
      body.documents.some(n => n.closure?.evaluation?.documentId !== n.id || n.closure.dependency !== body.dependency || n.closure.key !== `${n.id}:${body.dependency}` ||
        !Array.isArray(n.closure.responsibleUserIds) || !Array.isArray(n.closure.evaluation.blockingReasons) || !['APTAS', 'PENDIENTES', 'CERRADAS'].includes(n.closure.category) ||
        n.closure.category === 'CERRADAS' && (!n.closure.closed || !n.closure.closedAt || !n.closure.closedBy || !n.closure.closureProcessId || n.closure.uncertain ||
          n.closure.closureReceipt?.schemaVersion !== 2 || n.closure.closureReceipt.executionMode !== 'ALFRESCO' ||
          n.closure.closureReceipt.documentId !== n.id || n.closure.closureReceipt.dependency !== body.dependency) ||
        !['MET', 'BLOCKED', 'INDETERMINATE'].includes(n.closure?.compliance))) throw new Error('Bandeja de cierre incompleta o inválida.')
  return { ...body, documents: body.documents.map(n => ({ ...nodeToDocument(n), closure: n.closure })),
    warning: body.complete !== true ? 'La consulta es parcial o tiene evaluaciones no verificadas; no se acreditan contadores completos.' : '' }
}
export async function getResponseOriginals(documentId) {
  const r = await apiFetch(`/api/documents/assignment-responses?documentId=${encodeURIComponent(documentId)}&direction=originals`, { credentials: 'include', cache: 'no-store' })
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.responseDocumentId !== documentId || !Array.isArray(body.originals) || typeof body.complete !== 'boolean' ||
      body.originals.some(o => o.relationType !== 'response' || o.direction !== 'response-to-original' || o.documentId !== documentId || o.node?.id !== o.originalDocumentId) ||
      new Set(body.originals.map(o => o.originalDocumentId)).size !== body.originals.length) throw new Error(body.error || 'No se pudieron verificar los originales relacionados.')
  return body
}
export async function confirmDocumentClosure(input, csrfToken, reconcile = false) {
  const r = await apiFetch(`/api/documents/closure${reconcile ? '/reconcile' : ''}`, { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(input) })
  const body = await r.json()
  if (!r.ok) throw new Error(body.error || 'Resultado no confirmado; consulta y concilia sin crear otra operación.')
  if (body.process?.documentId !== input.documentId || body.process?.executionMode !== 'ALFRESCO' || body.process?.state !== 'CERRADA') throw new Error('Resultado de cierre incompleto. Consulta y concilia antes de continuar.')
  return body
}

export async function listEligibleDocumentRecipients() {
  const response = await apiFetch('/api/directory/recipients', { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) {
    let serverError = ''
    try { serverError = (await response.clone().json())?.error || '' } catch { /* use safe status message */ }
    if (serverError === 'GROUP_MAPPINGS_REQUIRED') throw new Error('El servidor no tiene configurados los grupos institucionales de destinatarios.')
    if (serverError === 'USER_INBOX_MAPPING_REQUIRED') throw new Error('El servidor no tiene bandejas individuales de Alfresco configuradas para los destinatarios.')
    const messages = {
      401: 'La sesión expiró. Inicia sesión otra vez.',
      403: 'La sesión no tiene un rol institucional habilitado.',
      502: 'No se pudo consultar el directorio de destinatarios en Alfresco.',
      503: 'El directorio de destinatarios todavía no está disponible.',
    }

    throw new Error(messages[response.status] || 'No se pudo consultar el directorio de destinatarios.')
  }
  const result = await response.json()
  if (!Array.isArray(result?.recipients)) throw new Error('Alfresco devolvió un directorio de destinatarios no válido.')
  return result.recipients
}

export async function listDispatchRecipients() {
  const response = await apiFetch('/api/directory/dispatch-recipients', { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const configurationMessages = {
      ORGANIZATIONAL_HIERARCHY_PENDING: 'La relación organizativa entre Jefatura y Especialistas está pendiente de configuración institucional.',
      DISPATCH_DIRECTORY_CREDENTIALS_REQUIRED: 'Falta configurar la cuenta de consulta del directorio de despacho en el backend.',
      GROUP_MAPPINGS_REQUIRED: 'Falta configurar los grupos institucionales del despacho en el backend.',
      DISPATCH_DIRECTORY_NESTED_GROUPS_UNSUPPORTED: 'El directorio contiene subgrupos y requiere verificar su política de membresías antes de despachar.',
    }
    const messages = {
      403: 'Tu rol no permite realizar derivaciones internas.',
      502: 'No se pudo consultar el directorio institucional de destinatarios.',
    }
    throw new Error(dispatchPersistenceError(body.error, configurationMessages[body.error] ||
      messages[response.status] || body.error || 'No se pudieron cargar los destinos autorizados.'))
  }
  const result = await response.json()
  if (!Array.isArray(result?.recipients)) throw new Error('El directorio de jefaturas no tiene un formato válido.')
  const requiresUnit = result.requiresUnit === true
  if (requiresUnit && (!Array.isArray(result.units) || !/^[0-9a-f]{64}$/.test(result.hierarchyRevision || ''))) {
    throw new Error('No se pudo verificar la lista de unidades y su revisión.')
  }
  return {
    recipients: result.recipients,
    allowedRecipientRoles: result.allowedRecipientRoles || [],
    requiresUnit,
    units: requiresUnit ? result.units : [],
    hierarchyRevision: requiresUnit ? result.hierarchyRevision : '',
  }
}

async function hierarchyRequest(url, options = {}) {
  const { csrfToken, ...fetchOptions } = options
  const response = await apiFetch(url, {
    credentials: 'include',
    ...fetchOptions,
    headers: {
      Accept: 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...fetchOptions.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const messages = {
      DIRECTOR_HIERARCHY_REQUIRED: 'Solo la Dirección autorizada de esta dependencia puede administrar su oficina.',
      INSTITUTIONAL_IDENTITY_REJECTED: 'Alfresco no confirma tu identidad o rol institucional vigente. Inicia sesión nuevamente.',
      INSTITUTIONAL_IDENTITY_UNAVAILABLE: 'No se pudo verificar tu identidad institucional en Alfresco. No se guardaron cambios; reintenta.',
      DISPATCH_DIRECTORY_CREDENTIALS_REQUIRED: 'Falta configurar la cuenta de consulta del directorio de Alfresco.',
      GROUP_MAPPINGS_REQUIRED: 'Faltan los grupos institucionales de dependencia y función.',
      DISPATCH_DIRECTORY_NESTED_GROUPS_UNSUPPORTED: 'Alfresco devolvió subgrupos; el directorio requiere revisar la política de membresías.',
      HIERARCHY_MEMBER_NOT_ALLOWED: 'Uno de los usuarios no pertenece al grupo funcional de este carril en tu dependencia.',
      HIERARCHY_UNIT_HEAD_NOT_ALLOWED: 'La jefatura seleccionada para el especialista ya no pertenece a la jerarquía de la oficina.',
      INVALID_HIERARCHY_ASSIGNMENTS: 'La estructura enviada no tiene un formato válido.',
      HIERARCHY_DIRECTORY_UNAVAILABLE: 'No se pudo consultar el directorio institucional de Alfresco.',
      HIERARCHY_ALFRESCO_READ_ONLY: 'La jerarquía se está consultando desde Alfresco, pero todavía no se pueden guardar cambios.',
      HIERARCHY_ALFRESCO_REQUIRED: 'La creación de unidades solo está disponible cuando la jerarquía se consulta desde Alfresco.',
      HIERARCHY_UNIT_WRITES_DISABLED: 'El servidor mantiene deshabilitada la creación de unidades.',
      HIERARCHY_PILOT_NOT_READY: 'El piloto de jerarquías no está preparado para escribir en esta dependencia.',
      HIERARCHY_PILOT_CREATE_PERMISSION_REQUIRED: 'La cuenta técnica no tiene permiso efectivo de creación en jerarquías o auditoría.',
      HIERARCHY_PENDING_RECONCILIATION: 'Hay una operación de jerarquía pendiente de reconciliación; no se inició otro cambio.',
      HIERARCHY_AUDIT_COVERAGE_INCOMPLETE: 'No se pudo verificar todo el historial de auditoría; el guardado permanece bloqueado.',
      HIERARCHY_UNIT_EDITS_DISABLED: 'La edición de unidades está deshabilitada por el backend.',
      HIERARCHY_UNIT_CHANGE_FIELDS_INVALID: 'La solicitud contiene propiedades que no se pueden editar.',
      HIERARCHY_OPERATION_DUPLICATE_CONFLICT: 'Ese identificador de operación ya se usó con otros datos.',
      HIERARCHY_OPERATION_RESULT_CONFLICT: 'La operación tiene un resultado parcial que requiere revisión antes de reintentar.',
      HIERARCHY_UNIT_UPDATE_OUTCOME_UNKNOWN: 'Alfresco no confirmó el resultado de la edición. Reintenta con el mismo identificador de operación.',
      HIERARCHY_UNIT_UPDATE_OUTCOME_PARTIAL: 'Alfresco aplicó solo parte de los cambios. Reintenta con los mismos datos para reconciliar.',
      HIERARCHY_WRITE_VERIFICATION_FAILED: 'Alfresco no confirmó los valores actualizados. La operación requiere reconciliación.',
      HIERARCHY_UNIT_NAME_REQUIRED: 'Escribe el nombre de la unidad.',
      HIERARCHY_UNIT_NAME_DUPLICATE: 'Ya existe una unidad con ese nombre en esta dependencia.',
      HIERARCHY_UNIT_CODE_DUPLICATE: 'Ya existe una unidad con ese código en esta dependencia.',
      HIERARCHY_UNIT_CODE_INVALID: 'El código de la unidad no es válido.',
      HIERARCHY_UNIT_DESCRIPTION_INVALID: 'La descripción supera el límite permitido.',
      HIERARCHY_OPERATION_ID_INVALID: 'No se pudo preparar un identificador seguro para esta operación. Reintenta.',
      HIERARCHY_AUDIT_RECORD_FAILED: 'La operación no se reportó como completada porque no se confirmó su auditoría.',
      HIERARCHY_AUDIT_INITIATION_FAILED: 'No se registró el inicio de auditoría; por seguridad, no se realizó el cambio.',
      HIERARCHY_UNIT_OPERATION_PARTIAL: 'La operación quedó parcial. Conserva el identificador para que el administrador pueda reconciliarla.',
      HIERARCHY_HEAD_WRITES_DISABLED: 'El servidor mantiene deshabilitada la asignación de Jefes de Unidad.',
      HIERARCHY_HEAD_ASSIGNMENT_PARTIAL: 'La asignación del Jefe quedó parcial. Conserva el identificador para reconciliarla.',
      HIERARCHY_HEAD_CHANGES_DISABLED: 'El servidor mantiene deshabilitado el cambio de Jefe de Unidad.',
      HIERARCHY_HEAD_CHANGE_PARTIAL: 'El cambio de Jefe quedó parcial. Conserva el identificador de operación para reconciliarlo.',
      HIERARCHY_SPECIALIST_WRITES_DISABLED: 'El servidor mantiene deshabilitada la asignación de Especialistas.',
      HIERARCHY_SPECIALIST_ASSIGNMENT_PARTIAL: 'La asignación del Especialista quedó parcial. Conserva el identificador para reconciliarla.',
      HIERARCHY_SPECIALIST_REASSIGNMENTS_DISABLED: 'La reasignación de Especialistas está deshabilitada por el servidor.',
      HIERARCHY_SPECIALIST_REASSIGNMENT_PARTIAL: 'La reasignación quedó parcial. Conserva el identificador de operación y reintenta con el mismo destino.',
      HIERARCHY_SPECIALIST_REASSIGNMENT_PENDING_RECONCILIATION: 'Este Especialista tiene una reasignación pendiente; reintenta esa operación antes de iniciar otra.',
      HIERARCHY_SPECIALIST_REASSIGNMENT_SAME_UNIT: 'Selecciona una unidad de destino distinta a la unidad actual.',
      HIERARCHY_SPECIALIST_REASSIGNMENT_STATE_CONFLICT: 'El estado de las asignaciones no coincide con la operación pendiente; requiere reconciliación.',
      HIERARCHY_SPECIALIST_REASSIGNMENT_FINAL_STATE_INVALID: 'Alfresco no confirmó una única unidad activa para el Especialista.',
      HIERARCHY_SPECIALIST_REASSIGNMENT_COMPLETION_CONFLICT: 'El historial indica que la operación se completó, pero el estado actual no coincide.',
      HIERARCHY_SPECIALIST_REASSIGNMENT_CROSS_DEPENDENCY_CONFLICT: 'El Especialista tiene una asignación activa incompatible en otra dependencia.',
      HIERARCHY_SPECIALIST_ASSIGNMENT_NOT_FOUND: 'No se encontró una asignación activa de Especialista para trasladar.',
      HIERARCHY_SPECIALIST_MULTIPLE_ACTIVE_UNITS: 'El Especialista tiene más de una asignación activa y requiere revisión antes de trasladarlo.',
      HIERARCHY_ACTIVE_UNIT_HEAD_EXISTS: 'Esta unidad ya tiene un Jefe activo. El cambio de Jefe se habilitará en otra etapa.',
      HIERARCHY_ACTIVE_UNIT_HEAD_CONFLICT: 'La unidad tiene más de un Jefe activo. Requiere reconciliación antes de cambiarlo.',
      HIERARCHY_ACTIVE_UNIT_HEAD_REQUIRED: 'La unidad no tiene un Jefe activo para reemplazar.',
      HIERARCHY_HEAD_UNCHANGED: 'Selecciona un Jefe distinto al actual.',
      HIERARCHY_HEAD_ALREADY_ASSIGNED_TO_OTHER_UNIT: 'El usuario seleccionado ya es Jefe activo de otra unidad.',
      HIERARCHY_USER_HAS_INCOMPATIBLE_ACTIVE_ASSIGNMENT: 'El usuario seleccionado ya tiene una asignación activa de Especialista.',
      HIERARCHY_HEAD_CHANGE_PENDING_RECONCILIATION: 'Existe otro cambio de Jefe pendiente de reconciliación para esta unidad.',
      HIERARCHY_HEAD_CHANGE_STATE_CONFLICT: 'El estado de las asignaciones no coincide con el cambio pendiente. Requiere reconciliación antes de continuar.',
      HIERARCHY_HEAD_CHANGE_FINAL_STATE_INVALID: 'Alfresco no confirmó un único Jefe activo con el resultado solicitado.',
      HIERARCHY_HEAD_CHANGE_COMPLETION_CONFLICT: 'El historial marca la operación como completada, pero el estado actual no coincide. Requiere reconciliación.',
      HIERARCHY_REVISION_CONFLICT: 'La jerarquía cambió desde que se cargó la pantalla. Actualiza los datos antes de continuar.',
      HIERARCHY_DOCUMENT_RESPONSIBILITIES_PENDING: 'El usuario conserva responsabilidades documentales pendientes. No se transferirán automáticamente.',
      HIERARCHY_DOCUMENT_COVERAGE_INCOMPLETE: 'No se ha acreditado una cobertura documental completa. El cambio permanece bloqueado.',
      RESPONSE_TIMES_INVALID_INPUT: 'Revisa los valores y las unidades. Los valores deben ser enteros positivos dentro de los límites permitidos.',
      RESPONSE_TIMES_REVISION_CONFLICT: 'La configuración cambió desde que la abriste. Consulta los valores actuales antes de volver a guardar.',
      RESPONSE_TIMES_OPERATION_ID_CONFLICT: 'El identificador ya corresponde a otros valores. Recarga la configuración antes de continuar.',
      RESPONSE_TIMES_OPERATION_PENDING: 'Hay un guardado anterior sin confirmar. Reintenta esa misma operación antes de iniciar otra.',
      RESPONSE_TIMES_OPERATION_UNCERTAIN: 'No se pudo confirmar el resultado. Reintenta el guardado con los mismos valores para verificarlo.',
      RESPONSE_TIMES_VERIFICATION_FAILED: 'Alfresco no confirmó el guardado. Reintenta la misma operación para verificar su estado.',
      RESPONSE_TIMES_PILOT_DSA_ONLY: 'La escritura está habilitada únicamente para el piloto DSA.',
      RESPONSE_TIMES_WRITE_PERMISSION_UNAVAILABLE: 'La cuenta técnica no tiene los permisos efectivos necesarios para guardar.',
      RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE: 'El bloqueo exclusivo del piloto no está disponible. No se guardaron cambios.',
      RESPONSE_TIMES_WRITES_DISABLED: 'El backend mantiene deshabilitada la escritura de tiempos de respuesta.',
      RESPONSE_TIMES_READ_UNAVAILABLE: 'No se pudo consultar la configuración de tiempos de respuesta en Alfresco.',
      HIERARCHY_SPECIALIST_ALREADY_ASSIGNED: 'Este Especialista ya tiene una unidad principal activa.',
      HIERARCHY_UNIT_INACTIVE: 'No se puede asignar un Especialista a una unidad inactiva.',
      HIERARCHY_USER_DISABLED: 'El usuario seleccionado está deshabilitado en Alfresco.',
      HIERARCHY_USER_NOT_FOUND: 'El usuario ya no existe en Alfresco.',
      HIERARCHY_USER_MEMBERSHIP_INCOMPLETE: 'No se pudo confirmar la dependencia o función del usuario.',
      HIERARCHY_TECHNICAL_ACCOUNT_NOT_ASSIGNABLE: 'La cuenta técnica no se puede asignar a una función organizacional.',
      HIERARCHY_USER_DEPENDENCY_MISMATCH: 'El usuario no pertenece a la dependencia de esta sesión.',
      HIERARCHY_USER_FUNCTION_MISMATCH: 'El usuario no pertenece al grupo funcional requerido para este rol.',
      HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS: 'La membresía del usuario no es inequívoca; solicita una revisión del directorio.',
      HIERARCHY_USER_NOT_IN_CONFIGURED_GROUPS: 'El usuario no pertenece a los grupos institucionales configurados para este rol.',
      HIERARCHY_UNIT_OUT_OF_SCOPE: 'La unidad no pertenece al contenedor autorizado de jerarquías.',
      HIERARCHY_DEPENDENCY_MISMATCH: 'La unidad no pertenece a la dependencia de tu sesión.',
      HIERARCHY_ALFRESCO_HTTP_401: 'La cuenta técnica no pudo autenticarse en Alfresco.',
      HIERARCHY_ALFRESCO_HTTP_403: 'La cuenta técnica no tiene permiso para crear unidades o registrar auditoría.',
      HIERARCHY_ALFRESCO_HTTP_409: 'Alfresco informó un conflicto al crear la unidad o el evento de auditoría.',
      HIERARCHY_ALFRESCO_ACCESS_DENIED: 'La cuenta técnica no tiene permiso para consultar la jerarquía en Alfresco.',
      HIERARCHY_ALFRESCO_CONFIGURATION_INVALID: 'La configuración del contenedor de jerarquías en Alfresco no es válida.',
      HIERARCHY_ALFRESCO_CONFIGURATION_REQUIRED: 'Falta completar la configuración lectora de jerarquía. No se cargaron datos locales como alternativa.',
      HIERARCHY_ALFRESCO_READ_UNAVAILABLE: 'Alfresco no está disponible para consultar la jerarquía. No se cargaron datos locales como alternativa.',
      HIERARCHY_ALFRESCO_DATA_INVALID: 'Alfresco devolvió datos de jerarquía inconsistentes. Solicita una revisión antes de continuar.',
      ORGANIZATION_STORE_UNAVAILABLE: 'No se pudo leer o guardar la estructura de la oficina en el BFF.',
      HIERARCHY_SAVE_FAILED: 'No se pudo guardar la estructura de la oficina.',
    }
    const error = new Error(messages[body.error] || body.error || `La consulta de oficina falló (HTTP ${response.status}).`)
    if (body.error === 'HIERARCHY_ALFRESCO_CONFIGURATION_REQUIRED' && Array.isArray(body.missingConfiguration)) {
      const names = body.missingConfiguration.filter(name => /^ALFRESCO_HIERARCHY_(STORAGE|SERVICE_USERNAME|SERVICE_PASSWORD|CONTAINER_NODE_ID|AUDIT_CONTAINER_NODE_ID)$/.test(name))
      if (names.length) error.message += ` Parámetros: ${names.join(', ')}.`
    }
    error.code = body.error
    error.status = response.status
    error.operationId = body.operationId
    error.operationStatus = body.operationStatus
    error.unitId = body.unitId
    error.userId = body.userId
    error.assignmentId = body.assignmentId
    error.currentHeadUserId = body.currentHeadUserId
    error.newHeadUserId = body.newHeadUserId
    error.sourceUnitId = body.sourceUnitId
    error.destinationUnitId = body.destinationUnitId
    error.sourceAssignmentId = body.sourceAssignmentId
    error.destinationAssignmentId = body.destinationAssignmentId
    error.uncertain = body.operationStatus === 'PARCIAL' || response.status >= 500
    throw error
  }
  return body
}

export const getHierarchy = () => hierarchyRequest('/api/hierarchy')
export const getResponseTimes = () => hierarchyRequest('/api/settings/response-times')
export const updateResponseTimes = ({ operationId, expectedRevision, values }, csrfToken) => hierarchyRequest('/api/settings/response-times', {
  method: 'PUT',
  csrfToken,
  body: JSON.stringify({ operationId, ...(expectedRevision ? { expectedRevision } : {}), values }),
})
export const getHierarchyAudit = (filters = {}) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''))
  return hierarchyRequest(`/api/hierarchy/audit${query.size ? `?${query.toString()}` : ''}`)
}
export const createHierarchyUnit = ({ name, code, description, operationId }, csrfToken) => hierarchyRequest('/api/hierarchy/units', {
  method: 'POST',
  csrfToken,
  body: JSON.stringify({ name, code, description, operationId }),
})
export const editHierarchyUnit = ({ unitId, name, code, description, operationId, expectedRevision }, csrfToken) => hierarchyRequest(`/api/hierarchy/units/${encodeURIComponent(unitId)}`, {
  method: 'PATCH',
  csrfToken,
  body: JSON.stringify({ name, code, description, operationId, ...(expectedRevision ? { expectedRevision } : {}) }),
})
export const assignHierarchyHead = ({ unitId, userId, operationId }, csrfToken) => hierarchyRequest(`/api/hierarchy/units/${encodeURIComponent(unitId)}/head`, {
  method: 'POST',
  csrfToken,
  body: JSON.stringify({ userId, operationId }),
})
export const assignHierarchySpecialist = ({ unitId, userId, operationId }, csrfToken) => hierarchyRequest(`/api/hierarchy/units/${encodeURIComponent(unitId)}/specialists`, {
  method: 'POST',
  csrfToken,
  body: JSON.stringify({ userId, operationId }),
})
export const changeHierarchyHead = ({ unitId, newHeadUserId, operationId, expectedRevision }, csrfToken) => hierarchyRequest(`/api/hierarchy/units/${encodeURIComponent(unitId)}/change-head`, {
  method: 'POST',
  csrfToken,
  body: JSON.stringify({ newHeadUserId, operationId, ...(expectedRevision ? { expectedRevision } : {}) }),
})
export const reassignHierarchySpecialist = ({ userId, destinationUnitId, operationId, expectedRevision }, csrfToken) => hierarchyRequest(`/api/hierarchy/specialists/${encodeURIComponent(userId)}/reassign`, {
  method: 'POST',
  csrfToken,
  body: JSON.stringify({ destinationUnitId, operationId, ...(expectedRevision ? { expectedRevision } : {}) }),
})
export const saveHierarchy = (assignments, csrfToken) => hierarchyRequest('/api/hierarchy', {
  method: 'PUT',
  csrfToken,
  body: JSON.stringify({ assignments }),
})

export async function getAssignmentInbox() {
  return loadAssignmentInbox(apiFetch, nodeToDocument)
}

export async function listDispatches() {
  const response = await apiFetch('/api/documents/dispatches', { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(dispatchPersistenceError(body.error, 'No se pudieron consultar los encargos documentales. Reintenta la actualización de la bandeja.'))
  }
  const result = await response.json()
  if (!Array.isArray(result?.dispatches)) throw new Error('La respuesta de encargos documentales no es válida.')
  if (result.discoveryErrors?.length) throw new Error('La consulta de asignaciones es parcial. Algunas fuentes no pudieron verificarse; reintenta sin asumir que la lista está vacía.')
  requireDispatchPersistence(result.persistence)
  return withDispatchPersistence(result.dispatches, result.persistence)
}

export async function reserveDocumentNumber(documentType, documentPeriod, csrfToken, issuerCode) {
  const response = await apiFetch('/api/documents/numbers', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ documentType, documentPeriod, issuerCode }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.number?.originalConsecutive) {
    const messages = {
      UNIT_CODE_NOT_CONFIGURED: 'La cuenta no tiene un código institucional de unidad configurado.',
      NUMBERING_SCOPE_REQUIRED: 'No se pudo determinar el ámbito institucional del correlativo.',
      NUMBERING_ATOMIC_RESERVATION_REQUIRED: 'La numeración oficial está suspendida hasta verificar en Alfresco todos los correlativos utilizados y la recuperación de emisiones inciertas.',
      NUMBERING_STORE_UNAVAILABLE: 'No se pudo guardar el correlativo institucional.',
    }
    throw new Error(messages[body.error] || 'No se pudo reservar el correlativo institucional.')
  }
  return body.number
}

export async function dispatchDocument(documentId, recipientUserIds, instruction, priority, requestKey, csrfToken, originAssignmentId = null, destination) {
  const response = await apiFetch('/api/documents/dispatch', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({
      documentId, recipientUserIds, instruction, priority, requestKey, originAssignmentId,
      ...(destination ? { unitId: destination.unitId, hierarchyRevision: destination.hierarchyRevision } : {}),
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const messages = {
      HIERARCHICAL_DISPATCH_REQUIRED: 'Tu rol no permite realizar esta derivación interna.',
      INSTITUTIONAL_IDENTITY_REJECTED: 'Alfresco no confirma tu identidad o rol institucional vigente. Inicia sesión nuevamente.',
      INSTITUTIONAL_IDENTITY_UNAVAILABLE: 'No se pudo verificar tu identidad institucional en Alfresco. No se ejecutó el despacho.',
      DISPATCH_RECIPIENT_NOT_ALLOWED: 'Uno o más destinatarios no pertenecen a la dependencia autorizada.',
      ORGANIZATIONAL_HIERARCHY_PENDING: 'La relación organizativa entre Jefatura y Especialistas está pendiente de configuración institucional.',
      DISPATCH_DOCUMENT_NOT_ALLOWED: 'No tienes autorización documental para derivar este PDF.',
      DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED: 'Debes tener una asignación propia y vigente de atención. Leer el documento o haberlo creado no basta para derivarlo.',
      INVALID_DISPATCH_ORIGIN: 'La referencia a la asignación de origen no es válida.',
      DISPATCH_REQUEST_CONFLICT: 'La clave de reintento ya corresponde a otro despacho.',
      DISTRIBUTION_SERVICE_NOT_CONFIGURED: 'La cuenta técnica de distribución no está configurada.',
      DISTRIBUTION_SERVICE_AUTH_FAILED: 'No se pudo autenticar la cuenta técnica de distribución.',
    }
    const error = new Error(dispatchPersistenceError(body.error, messages[body.error] || 'No se pudo completar el despacho documental.'))
    error.code = body.error
    error.status = response.status
    error.dispatchId = body.dispatchId || ''
    error.documentId = body.documentId || documentId
    throw error
  }
  requireDispatchPersistence(body.persistence)
  return withDispatchPersistence([body.dispatch], body.persistence)[0]
}

export async function getDirectorOfficeInboxes() {
  const response = await apiFetch('/api/directory/office-inboxes', { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    if (body.error === 'OFFICE_INBOX_MAPPING_REQUIRED') throw new Error('El backend todavía no tiene configuradas las carpetas de recepción de esta dependencia.')
    throw new Error('No se pudieron cargar las bandejas de la dependencia desde Alfresco.')
  }
  const result = await response.json()
  if (!result?.folders?.porAtender || !result?.folders?.porConocimiento) throw new Error('La configuración de las bandejas de oficina está incompleta.')
  return result.folders
}

async function request(url, options = {}) {
  const { csrfToken, ...fetchOptions } = options
  const response = await apiFetch(url, {
    ...fetchOptions,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...fetchOptions.headers },
  })
  if (!response.ok) {
    let detail = `ALFRESCO_HTTP_${response.status}`
    try {
      const body = await response.json()
      detail = `${detail}: ${body?.error?.briefSummary || body?.error?.description || ''}`
    } catch {
      detail = ''
    }
    const error = new Error(detail || `La API respondió con estado ${response.status}.`)
    error.status = response.status
    throw error
  }
  return response.status === 204 ? null : response.json()
}

async function requestBlob(url) {
  const response = await apiFetch(url, { credentials: 'include' })
  if (!response.ok) {
    const error = new Error(`No se pudo obtener el archivo. La API respondió con estado ${response.status}.`)
    error.status = response.status
    throw error
  }
  return response.blob()
}

export async function getEmittedDocuments() {
  const response = await apiFetch('/api/documents/emitted', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(response.status === 403 ? 'Tu sesión no tiene autorización para consultar Emitidos.' : 'No se pudo consultar Emitidos en Alfresco. Actualiza la bandeja para reintentar.')
  if (!Array.isArray(body.documents) || body.source !== 'alfresco' || body.semantics !== 'institutional-originals') throw new Error('La respuesta de Emitidos no tiene un formato válido.')
  return { ...body, documents: body.documents.map(nodeToDocument),
    scopeNotice: body.scopeNotice === 'UNIT_COMPETENCE_NOT_VERIFIED_OWN_ONLY' ? 'Se muestran solo documentos propios. El acceso por unidad requiere jerarquía institucional verificada.' : '',
    warning: body.documentErrors?.length ? `${body.documentErrors.length} documentos no pudieron verificarse por permisos u origen institucional. La lista es parcial.` : '' }
}

export async function listNodeChildren(nodeId, options = {}) {
  if (!nodeId) throw new Error('ALFRESCO_FOLDER_NOT_CONFIGURED')
  const params = new URLSearchParams({ include: 'properties,association,content,path', maxItems: String(options.maxItems || 100) })
  if (options.where) params.set('where', options.where)
  const entries = await collectInboxPages((skipCount) => {
    params.set('skipCount', String(skipCount))
    return request(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/children?${params}`)
  }, options.allPages)
  return entries.map(({ entry }) => nodeToDocument(entry))
}

export async function searchDocuments(query, options = {}) {
  const response = await request(`${searchApiPrefix}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    csrfToken: options.csrfToken,
    body: JSON.stringify({ query: { query }, paging: { maxItems: options.maxItems || 100, skipCount: options.skipCount || 0 }, include: ['properties', 'aspectNames', 'path'] }),
  })
  return (response.list?.entries || []).map(({ entry }) => nodeToDocument(entry))
}

export function getNodeContent(nodeId, originalDocumentId) {
  return requestBlob(originalDocumentId
    ? `/api/documents/response-content?documentId=${encodeURIComponent(originalDocumentId)}&responseDocumentId=${encodeURIComponent(nodeId)}`
    : `${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/content?attachment=false`)
}

export async function getAuthorizedDocument(nodeId) {
  const result = await request(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}?include=properties`)
  if (result?.entry?.id !== nodeId) throw new Error('No se pudo verificar el documento.')
  return nodeToDocument(result.entry)
}

async function attentionRequest(path, body, csrfToken) {
  const response = await apiFetch(path, { method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const messages = {
      ATTENTION_ASSIGNMENT_NOT_OWNED: 'Solo puedes atender tus propias asignaciones.',
      ATTENTION_REQUIRED: 'Tu sesión no está autorizada para registrar atención individual.',
      INVALID_ATTENTION_REQUEST: 'La solicitud de atención o vinculación no tiene un formato válido.',
      ASSIGNMENT_NOT_ACTIVE: 'La asignación ya no está vigente. Actualiza la bandeja.',
      RESPONSE_EMISSION_NOT_ALLOWED: 'Tu rol no tiene una emisión institucional habilitada para responder.',
      RESPONSE_NOT_OWN_EMISSION: 'Selecciona un PDF emitido por tu usuario en Emitidos de tu dependencia.',
      RESPONSE_UPDATE_DENIED: 'Alfresco no permite actualizar tu documento de respuesta. No se cambiarán permisos.',
      RESPONSE_REFERENCE_DENIED: 'Alfresco denegó crear la relación documental. No se cambiarán permisos.',
      RESPONSE_ORIGIN_CONFLICT: 'El origen registrado de la respuesta no coincide con tu dependencia.',
      RESPONSE_REFERENCE_MODEL_REQUIRED: 'La asociación estándar de referencia no está disponible en este repositorio.',
      RESPONSE_ALREADY_LINKED: 'Esta respuesta ya está vinculada. Actualiza los documentos relacionados.',
      RESPONSE_LINK_PARTIAL: 'La emisión existe, pero no se confirmó todo el vínculo. No vuelvas a emitir: reintenta con el mismo UUID y solicitud.',
      ATTENTION_RESPONSE_NOT_LINKED: 'La respuesta no tiene un vínculo verificado con el original.',
      ALFRESCO_ATTENTION_REQUIRED: 'La atención individual requiere persistencia Alfresco activa.',
    }
    throw new Error(dispatchPersistenceError(result.error, messages[result.error] || result.error || 'No se pudo registrar la atención.'))
  }
  return result
}
export const attendAssignment = (input, csrfToken) => attentionRequest('/api/documents/assignments/attend', input, csrfToken)
export const linkAssignmentResponse = (input, csrfToken) => attentionRequest('/api/documents/assignments/response', input, csrfToken)
export const listResponseCandidates = () => attentionRequest('/api/documents/response-candidates')
export const getLinkedResponses = (documentId) => attentionRequest(`/api/documents/assignment-responses?documentId=${encodeURIComponent(documentId)}`)

export async function uploadPdfToFolder(nodeId, file, { title, description, documentType, recipientDependency, recipientFunctionalRole }, csrfToken, recipientUserId) {
  if (!nodeId) throw new Error('No está configurada la bandeja personal del destinatario en Alfresco.')
  if (typeof File === 'undefined' || !(file instanceof File) || (file.type && file.type !== 'application/pdf') || !file.name.toLocaleLowerCase('es').endsWith('.pdf')) throw new Error('Selecciona un archivo PDF válido.')
  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if (String.fromCharCode(...signature) !== '%PDF-') throw new Error('El archivo seleccionado no tiene una firma PDF válida.')
  const formData = new FormData()
  formData.append('filedata', file, file.name)
  formData.append('name', file.name)
  formData.append('nodeType', 'cm:content')
  formData.append('cm:title', title)
  formData.append('cm:description', description)
  if (documentType) formData.append('documentType', documentType)
  let response
  try {
    response = await apiFetch(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/children?autoRename=false`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken, 'X-UAC-Recipient-User': recipientUserId,
      'X-UAC-Recipient-Dependency': recipientDependency || '', 'X-UAC-Recipient-Role': recipientFunctionalRole || '' }, body: formData })
  } catch {
    const error = new Error('No se pudo confirmar la respuesta de Alfresco. Revisa la carpeta antes de volver a intentar.')
    error.uncertain = true
    throw error
  }
  if (!response.ok) {
    const failurePayload = await response.clone().json().catch(() => ({}))
    const serverError = failurePayload.error || ''
    const uploadErrors = {
      DOCUMENT_WRITE_NOT_ALLOWED: 'La sesión autenticada no tiene permiso para enviar documentos.',
      RESERVED_DOCUMENT_METADATA: 'La carga incluye metadatos reservados. Envía solo el PDF, nombre, título y descripción.',
      GENERIC_RECIPIENT_SELECTION_REQUIRED: 'Actualiza el directorio y selecciona la cuenta, dependencia y función destinatarias.',
      GENERIC_RECIPIENT_UNVERIFIABLE: 'No se pudo verificar el destinatario o su carpeta en Alfresco. No se creó el documento.',
      GENERIC_RECIPIENT_NOT_ALLOWED: 'El destinatario cambió de estado o pertenencia institucional. Actualiza el directorio.',
      GENERIC_RECIPIENT_FOLDER_DENIED: 'La carpeta ya no corresponde al destino autorizado o Alfresco deniega crear allí.',
      GENERIC_DOCUMENT_TYPE_INVALID: 'Selecciona un tipo documental admitido.',
      GENERIC_DOCUMENT_TYPE_MODEL_REQUIRED: 'No se pudo verificar el modelo de tipo documental. No se creó el documento.',
      GENERIC_CREATE_OUTCOME_UNCERTAIN: 'El PDF pudo crearse, pero no se confirmó su tipo mediante lectura posterior. Conserva el UUID y revisa la carpeta antes de reintentar.',
      INVALID_PDF_MULTIPART: 'Los campos de la carga PDF no tienen un formato válido.',
      INSTITUTIONAL_IDENTITY_REJECTED: 'Alfresco no confirma tu identidad o rol institucional vigente. Inicia sesión nuevamente.',
      INSTITUTIONAL_IDENTITY_UNAVAILABLE: 'No se pudo verificar tu identidad institucional en Alfresco. No se creó el documento.',
      RECIPIENT_INBOX_NOT_CONFIGURED: 'La bandeja del destinatario no está configurada en el servidor.',
      CSRF_VALIDATION_FAILED: 'La sesión de seguridad expiró. Actualiza la página e inicia sesión otra vez.',
      ROLE_NOT_CONFIGURED: 'La cuenta no tiene un rol documental habilitado.',
    }
    if (uploadErrors[serverError]) {
      const error = new Error(uploadErrors[serverError])
      error.uncertain = failurePayload.uncertain === true
      error.emittedNodeId = failurePayload.emittedNodeId || ''
      throw error
    }
    const messages = { 401: 'Alfresco rechazó la autenticación de la sesión.', 403: 'La sesión no tiene permiso para crear documentos.', 404: 'No se encontró la carpeta configurada.', 409: 'Ya existe un archivo con ese nombre.', 413: 'El archivo supera el tamaño permitido.', 415: 'Alfresco rechazó el formato del archivo.' }
    const error = new Error(messages[response.status] || `Alfresco no pudo crear el documento (HTTP ${response.status}).`)
    error.status = response.status
    error.uncertain = response.status >= 500
    throw error
  }
  const result = await response.json().catch(() => null)
  if (!result?.entry?.id) {
    const error = new Error('Alfresco no devolvió el identificador del documento.')
    error.uncertain = true
    throw error
  }
  return result.entry
}

export async function uploadPdfToDirectorInbox(file, { title, description, recipientDependencyId, receiptCategory, existingNodeId = '' }, csrfToken) {
  if (!existingNodeId) {
    if (typeof File === 'undefined' || !(file instanceof File) || (file.type && file.type !== 'application/pdf') || !file.name.toLocaleLowerCase('es').endsWith('.pdf')) throw new Error('Selecciona un archivo PDF válido.')
    const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    if (String.fromCharCode(...signature) !== '%PDF-') throw new Error('El archivo seleccionado no tiene una firma PDF válida.')
  }
  if (!recipientDependencyId || !['por-atender', 'por-conocimiento'].includes(receiptCategory)) throw new Error('Selecciona una dependencia destinataria válida.')

  const formData = new FormData()
  if (!existingNodeId) {
    formData.append('filedata', file, file.name)
    formData.append('name', file.name)
    formData.append('nodeType', 'cm:content')
    formData.append('cm:title', title)
    formData.append('cm:description', description)
  }
  let response
  try {
    response = await apiFetch(existingNodeId ? '/api/documents/retry-director-delivery' : '/api/documents/send-to-director', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken,
        'X-UAC-Recipient-Dependency': recipientDependencyId.toUpperCase(),
        'X-UAC-Receipt-Category': receiptCategory,
        ...(existingNodeId ? { 'Content-Type': 'application/json' } : {}),
      },
      body: existingNodeId ? JSON.stringify({ nodeId: existingNodeId }) : formData,
    })
  } catch {
    const error = new Error('No se pudo confirmar la respuesta de Alfresco. Revisa la carpeta destinataria antes de volver a intentar.')
    error.uncertain = true
    throw error
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const knownErrors = {
      DISTRIBUTION_SERVICE_NOT_CONFIGURED: 'Falta configurar la cuenta de distribución en el servidor. El PDF no se ha vuelto a cargar.',
      OFFICIAL_EMISSION_ENDPOINT_REQUIRED: 'Las emisiones nuevas deben usar el flujo oficial. No se creó otro PDF.',
      OFFICIAL_RETRY_ENDPOINT_REQUIRED: 'Este documento es una emisión oficial. Reintenta con la misma clave y PDF mediante el flujo oficial.',
      DIRECTOR_RECIPIENT_NODE_READ_REQUIRED: 'El PDF ya existe en Emitidos, pero falta confirmar la lectura institucional del destinatario. Conserva el UUID; no se cambiaron permisos ni se creó otro PDF.',
      INSTITUTIONAL_IDENTITY_REJECTED: 'Alfresco no confirma tu identidad o rol institucional vigente. Inicia sesión nuevamente.',
      INSTITUTIONAL_IDENTITY_UNAVAILABLE: 'No se pudo verificar tu identidad institucional en Alfresco. No se inició la distribución.',
      DISTRIBUTION_SERVICE_AUTH_FAILED: 'Alfresco no pudo autenticar la cuenta de distribución. Revisa su configuración en el servidor.',
      DISTRIBUTION_SERVICE_DOCUMENT_ACCESS_FAILED: 'El PDF está en Emitidos, pero la cuenta de distribución no puede consultar el original. Revisa su permiso Lector en Emitidos.',
      OFFICE_GROUP_MAPPING_REQUIRED: 'El backend no tiene configurado el grupo institucional destinatario.',
      DIRECTOR_RETRY_NOT_ALLOWED: 'No tienes autorización para redistribuir este documento desde Emitidos.',
      DIRECTOR_EMITIDOS_WRITE_FORBIDDEN: 'Alfresco denegó la carga en Emitidos. Verifica que tu grupo tenga permiso para crear documentos en esa carpeta.',
      DIRECTOR_EMITIDOS_FOLDER_NOT_FOUND: 'No se encontró la carpeta Emitidos configurada para esta dependencia.',
      DIRECTOR_EMITIDOS_UPLOAD_FAILED: 'Alfresco no confirmó la creación del documento en Emitidos.',
      DIRECTOR_NODE_PERMISSION_READ_FORBIDDEN: 'Alfresco creó el PDF en Emitidos, pero no permitió consultar sus permisos para compartirlo. No reenvíes sin revisar Emitidos.',
      DIRECTOR_NODE_PERMISSION_WRITE_FORBIDDEN: 'El PDF quedó en Emitidos, pero Alfresco no permitió dar lectura al grupo de la dependencia destinataria. Revisa permisos del documento antes de reintentar.',
      DIRECTOR_NODE_PERMISSION_CONFLICT: 'El PDF quedó en Emitidos, pero ya existe una denegación explícita para el grupo destinatario. Revisa los permisos del documento.',
      DIRECTOR_NODE_PERMISSION_PARTIAL: 'El PDF quedó en Emitidos, pero no se pudo confirmar la configuración de acceso para la dependencia destinataria. Revisa el documento antes de reintentar.',
      DIRECTOR_MULTIFILING_PERMISSION_REQUIRED: 'El documento quedó creado en Emitidos, pero Alfresco denegó la asociación a la cuenta de distribución. Revisa su permiso Contribuidor en la carpeta destinataria.',
      DIRECTOR_MULTIFILING_PARTIAL: 'El documento quedó creado en Emitidos, pero no se confirmó su asociación a la bandeja destinataria. Verifica ambas carpetas antes de reintentar.',
      DIRECTOR_MULTIFILING_ALREADY_EXISTS: 'El documento ya está asociado a la bandeja destinataria.',
      DIRECTOR_DOCUMENT_WRITE_REQUIRED: 'La sesión no tiene permiso para enviar documentos como Director.',
      DIRECTOR_RECIPIENT_NOT_ALLOWED: 'La dependencia seleccionada no es un destino válido para esta sesión.',
      OFFICE_INBOX_MAPPING_REQUIRED: 'El backend no tiene configurada la carpeta de recepción de la dependencia destinataria.',
      DIRECTOR_DELIVERY_PARTIAL: 'Alfresco creó la copia en Emitidos, pero no confirmó la copia en la bandeja destino. Revisa ambas carpetas antes de reintentar.',
      PDF_UPLOAD_REQUIRED: 'Alfresco requiere un archivo PDF válido.',
      PDF_UPLOAD_TOO_LARGE: 'El archivo supera el tamaño permitido.',
      CSRF_VALIDATION_FAILED: 'La sesión de seguridad expiró. Actualiza la página e inicia sesión otra vez.',
    }
    if (knownErrors[body.error]) {
      const error = new Error(knownErrors[body.error])
      error.uncertain = Boolean(existingNodeId || body.emittedNodeId) || [
        'DIRECTOR_EMITIDOS_UPLOAD_FAILED',
        'DIRECTOR_NODE_PERMISSION_READ_FORBIDDEN',
        'DIRECTOR_NODE_PERMISSION_WRITE_FORBIDDEN',
        'DIRECTOR_NODE_PERMISSION_CONFLICT',
        'DIRECTOR_NODE_PERMISSION_PARTIAL',
        'DIRECTOR_MULTIFILING_PERMISSION_REQUIRED',
        'DIRECTOR_MULTIFILING_PARTIAL',
      ].includes(body.error)
      error.emittedNodeId = body.emittedNodeId || existingNodeId
      throw error
    }
    const messages = { 401: 'La sesión expiró. Inicia sesión otra vez.', 403: 'La sesión no tiene permiso para enviar a este destino.', 404: 'No se encontró la carpeta destinataria.', 409: 'Ya existe un archivo con ese nombre.', 413: 'El archivo supera el tamaño permitido.', 415: 'Alfresco rechazó el formato del archivo.' }
    const error = new Error(messages[response.status] || `Alfresco no pudo crear el documento (HTTP ${response.status}).`)
    error.status = response.status
    error.uncertain = response.status >= 500
    throw error
  }
  const result = await response.json().catch(() => null)
  if (!result?.emittedEntry?.id || !result?.receivedEntry?.id) {
    const error = new Error('Alfresco no devolvió el identificador del documento.')
    error.uncertain = true
    throw error
  }
  return { emittedEntry: result.emittedEntry, receivedEntry: result.receivedEntry }
}

export async function listGroupMembers(groupId) {
  const params = new URLSearchParams({ where: "(memberType='PERSON')", maxItems: '100' })
  const response = await request(`${coreApiPrefix}/groups/${encodeURIComponent(groupId)}/members?${params}`)
  return (response.list?.entries || []).map(({ entry }) => entry)
}

export async function getNodePermissions(nodeId) {
  const response = await request(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}?include=permissions`)
  return response.entry?.permissions || null
}

export async function emitOfficialDocument(file, fields, csrfToken) {
  const form = new FormData()
  form.set('filedata', file, file.name)
  for (const key of ['requestKey', 'title', 'description', 'documentType', 'documentPeriod', 'priority', 'recipientDependency', 'receiptCategory']) form.set(key, fields[key] || '')
  let response
  try { response = await apiFetch('/api/documents/official-emissions', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken }, body: form }) }
  catch { const error = new Error('No se pudo confirmar la emision. Conserva la misma clave y PDF para conciliar antes de reintentar.'); error.uncertain = true; throw error }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const messages = {
      OFFICIAL_EMISSION_WRITES_DISABLED: 'La emision oficial esta deshabilitada hasta completar las validaciones del piloto.',
      OFFICIAL_RECIPIENT_READ_CONFIGURATION_REQUIRED: 'La configuracion documental no permite compartir este PDF sin cambiar permisos. No se ha emitido.',
      OFFICIAL_RECIPIENT_NODE_READ_REQUIRED: 'El PDF ya está registrado en Emitidos. Falta autorizar la lectura del destinatario sobre ese nodo; conserva el UUID y la misma clave para conciliar, sin volver a emitir.',
      OFFICIAL_NUMBER_RECONCILIATION_REQUIRED: 'Existen documentos incompatibles pendientes de conciliacion administrativa.',
      OFFICIAL_RECONCILIATION_CHANGED: 'Cambio un documento excluido; se requiere revisar la conciliacion administrativa.',
      NUMBERING_RETRY_CONFLICT: 'La misma clave ya corresponde a otro contenido o parametros. No se ha creado otro PDF.',
      NUMBERING_RESULT_UNCERTAIN: 'La emision quedo incierta. Reintenta con la misma clave, PDF y datos; no generes otra emision.',
      DOCUMENT_ISSUER_CONFIGURATION_REQUIRED: 'Falta configurar tu unidad y código documental propio. No se ha creado ni numerado el PDF.',
      DOCUMENT_ISSUER_UNIT_NOT_VERIFIED: 'No se pudo acreditar la unidad institucional en Alfresco. No se ha emitido.',
      DOCUMENT_ISSUER_MEMBERSHIP_NOT_VERIFIED: 'Alfresco no acredita una asignación vigente a esa unidad y función.',
      DOCUMENT_ISSUER_CODE_CONFLICT: 'El código documental configurado es incompatible o está duplicado. Requiere revisión institucional.',
      DOCUMENT_DISTRIBUTION_AUTHORITY_PENDING: 'La distribución de documentos de Jefatura o Especialista requiere un circuito autorizado. Puedes emitir sin destinatario.',
    }
    const error = new Error(messages[body.error] || body.error || 'No se pudo confirmar la emision oficial.')
    error.uncertain = body.uncertain === true
    error.emittedNodeId = body.emittedNodeId || ''
    throw error
  }
  if (!body.officialEmission || !body.emittedEntry?.id || (body.distributed === false ? body.receivedEntry !== null || Boolean(fields.recipientDependency) : body.receivedEntry?.id !== body.emittedEntry.id)) {
    const error = new Error('No se pudo verificar el resultado de la emision. Conserva la misma clave para conciliar.'); error.uncertain = true; throw error
  }
  return body
}
