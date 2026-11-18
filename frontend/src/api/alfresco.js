import { apiFetch } from './client'
import { collectInboxPages } from '../utils/inboxPages'
import { loadAssignmentInbox } from '../utils/assignmentInbox'
import { dispatchPersistenceError, requireDispatchPersistence, withDispatchPersistence } from '../utils/dispatchPersistence'
import { documentIdentity } from '../utils/documentIdentity'

const coreApiPrefix = '/api/alfresco/api/-default-/public/alfresco/versions/1'
const searchApiPrefix = '/api/alfresco/api/-default-/public/search/versions/1'

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
      DISPATCH_DIRECTORY_CREDENTIALS_REQUIRED: 'Falta configurar la cuenta de consulta del directorio de despacho en el backend.',
      GROUP_MAPPINGS_REQUIRED: 'Falta configurar los grupos institucionales del despacho en el backend.',
      DISPATCH_DIRECTORY_NESTED_GROUPS_UNSUPPORTED: 'El directorio contiene subgrupos y requiere verificar su política de membresías antes de despachar.',
    }
    if (configurationMessages[body.error]) throw new Error(configurationMessages[body.error])
    const messages = {
      403: 'Tu rol no permite realizar derivaciones internas.',
      502: 'No se pudo consultar el directorio institucional de destinatarios.',
    }
    throw new Error(messages[response.status] || body.error || 'No se pudieron cargar las jefaturas autorizadas.')
  }
  const result = await response.json()
  if (!Array.isArray(result?.recipients)) throw new Error('El directorio de jefaturas no tiene un formato válido.')
  return { recipients: result.recipients, allowedRecipientRoles: result.allowedRecipientRoles || [] }
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
      DISPATCH_DIRECTORY_CREDENTIALS_REQUIRED: 'Falta configurar la cuenta de consulta del directorio de Alfresco.',
      GROUP_MAPPINGS_REQUIRED: 'Faltan los grupos institucionales de dependencia y función.',
      DISPATCH_DIRECTORY_NESTED_GROUPS_UNSUPPORTED: 'Alfresco devolvió subgrupos; el directorio requiere revisar la política de membresías.',
      HIERARCHY_MEMBER_NOT_ALLOWED: 'Uno de los usuarios no pertenece al grupo funcional de este carril en tu dependencia.',
      HIERARCHY_UNIT_HEAD_NOT_ALLOWED: 'La jefatura seleccionada para el especialista ya no pertenece a la jerarquía de la oficina.',
      INVALID_HIERARCHY_ASSIGNMENTS: 'La estructura enviada no tiene un formato válido.',
      HIERARCHY_DIRECTORY_UNAVAILABLE: 'No se pudo consultar el directorio institucional de Alfresco.',
      HIERARCHY_STORE_UNAVAILABLE: 'No se pudo leer o guardar la estructura de la oficina en el BFF.',
      HIERARCHY_SAVE_FAILED: 'No se pudo guardar la estructura de la oficina.',
    }
    const error = new Error(messages[body.error] || body.error || `La consulta de oficina falló (HTTP ${response.status}).`)
    error.code = body.error
    error.status = response.status
    throw error
  }
  return body
}

export const getHierarchy = () => hierarchyRequest('/api/hierarchy')
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
      NUMBERING_STORE_UNAVAILABLE: 'No se pudo guardar el correlativo institucional.',
    }
    throw new Error(messages[body.error] || 'No se pudo reservar el correlativo institucional.')
  }
  return body.number
}

export async function dispatchDocument(documentId, recipientUserIds, instruction, priority, requestKey, csrfToken, originAssignmentId = null) {
  const response = await apiFetch('/api/documents/dispatch', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ documentId, recipientUserIds, instruction, priority, requestKey, originAssignmentId }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const messages = {
      HIERARCHICAL_DISPATCH_REQUIRED: 'Tu rol no permite realizar esta derivación interna.',
      DISPATCH_RECIPIENT_NOT_ALLOWED: 'Uno o más destinatarios no pertenecen a la dependencia autorizada.',
      DISPATCH_DOCUMENT_NOT_ALLOWED: 'No tienes autorización documental para derivar este PDF.',
      DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED: 'Debes tener una asignación propia y vigente de atención. Leer el documento o haberlo creado no basta para derivarlo.',
      INVALID_DISPATCH_ORIGIN: 'La referencia a la asignación de origen no es válida.',
      DISPATCH_REQUEST_CONFLICT: 'La clave de reintento ya corresponde a otro despacho.',
      DISTRIBUTION_SERVICE_NOT_CONFIGURED: 'La cuenta técnica de distribución no está configurada.',
      DISTRIBUTION_SERVICE_AUTH_FAILED: 'No se pudo autenticar la cuenta técnica de distribución.',
    }
    const error = new Error(dispatchPersistenceError(body.error, messages[body.error] || 'No se pudo completar el despacho documental.'))
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

function nodeToDocument(node) {
  const properties = node.properties || {}
  const content = node.content || {}
  return {
    id: node.id,
    subject: properties['cm:title'] || node.name,
    description: properties['cm:description'] || '',
    sender: node.createdByUser?.displayName || node.createdByUser?.id || '',
    senderUserId: node.createdByUser?.id || '',
    originatingDependency: '',
    documentIdentity: documentIdentity(node),
    unitName: '',
    specialistName: '',
    attachmentName: node.name,
    createdAt: node.createdAt,
    status: null,
    nodeType: node.nodeType,
    mimeType: content.mimeType || '',
    sizeInBytes: content.sizeInBytes || 0,
  }
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

export async function uploadPdfToFolder(nodeId, file, { title, description }, csrfToken, recipientUserId) {
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
  let response
  try {
    response = await apiFetch(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/children?autoRename=false`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken, 'X-UAC-Recipient-User': recipientUserId }, body: formData })
  } catch {
    const error = new Error('No se pudo confirmar la respuesta de Alfresco. Revisa la carpeta antes de volver a intentar.')
    error.uncertain = true
    throw error
  }
  if (!response.ok) {
    let serverError = ''
    try { serverError = (await response.clone().json())?.error || '' } catch { /* safe generic status below */ }
    const uploadErrors = {
      DOCUMENT_WRITE_NOT_ALLOWED: 'La sesión autenticada no tiene permiso para enviar documentos.',
      RECIPIENT_INBOX_NOT_CONFIGURED: 'La bandeja del destinatario no está configurada en el servidor.',
      CSRF_VALIDATION_FAILED: 'La sesión de seguridad expiró. Actualiza la página e inicia sesión otra vez.',
      ROLE_NOT_CONFIGURED: 'La cuenta no tiene un rol documental habilitado.',
    }
    if (uploadErrors[serverError]) throw new Error(uploadErrors[serverError])
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
