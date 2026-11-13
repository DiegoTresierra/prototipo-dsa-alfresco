import { apiFetch } from './client'

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
    originatingDependency: '',
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
  const response = await request(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/children?${params}`)
  if (!Array.isArray(response?.list?.entries) || response.list.entries.some((record) => !record?.entry)) throw new Error('ALFRESCO_INVALID_LIST_RESPONSE')
  return response.list.entries.map(({ entry }) => nodeToDocument(entry))
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

export function getNodeContent(nodeId) {
  return requestBlob(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/content?attachment=false`)
}

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

export async function uploadPdfToDirectorInbox(file, { title, description, recipientDependencyId, receiptCategory }, csrfToken) {
  if (typeof File === 'undefined' || !(file instanceof File) || (file.type && file.type !== 'application/pdf') || !file.name.toLocaleLowerCase('es').endsWith('.pdf')) throw new Error('Selecciona un archivo PDF válido.')
  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if (String.fromCharCode(...signature) !== '%PDF-') throw new Error('El archivo seleccionado no tiene una firma PDF válida.')
  if (!recipientDependencyId || !['por-atender', 'por-conocimiento'].includes(receiptCategory)) throw new Error('Selecciona una dependencia destinataria válida.')

  const formData = new FormData()
  formData.append('filedata', file, file.name)
  formData.append('name', file.name)
  formData.append('nodeType', 'cm:content')
  formData.append('cm:title', title)
  formData.append('cm:description', description)
  let response
  try {
    response = await apiFetch('/api/documents/send-to-director', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken,
        'X-UAC-Recipient-Dependency': recipientDependencyId.toUpperCase(),
        'X-UAC-Receipt-Category': receiptCategory,
      },
      body: formData,
    })
  } catch {
    const error = new Error('No se pudo confirmar la respuesta de Alfresco. Revisa la carpeta destinataria antes de volver a intentar.')
    error.uncertain = true
    throw error
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const knownErrors = {
      OFFICE_GROUP_MAPPING_REQUIRED: 'El backend no tiene configurado el grupo institucional destinatario.',
      DIRECTOR_EMITIDOS_WRITE_FORBIDDEN: 'Alfresco denegó la carga en Emitidos. Verifica que tu grupo tenga permiso para crear documentos en esa carpeta.',
      DIRECTOR_EMITIDOS_FOLDER_NOT_FOUND: 'No se encontró la carpeta Emitidos configurada para esta dependencia.',
      DIRECTOR_EMITIDOS_UPLOAD_FAILED: 'Alfresco no confirmó la creación del documento en Emitidos.',
      DIRECTOR_NODE_PERMISSION_READ_FORBIDDEN: 'Alfresco creó el PDF en Emitidos, pero no permitió consultar sus permisos para compartirlo. No reenvíes sin revisar Emitidos.',
      DIRECTOR_NODE_PERMISSION_WRITE_FORBIDDEN: 'El PDF quedó en Emitidos, pero Alfresco no permitió dar lectura al grupo de la dependencia destinataria. Revisa permisos del documento antes de reintentar.',
      DIRECTOR_NODE_PERMISSION_CONFLICT: 'El PDF quedó en Emitidos, pero ya existe una denegación explícita para el grupo destinatario. Revisa los permisos del documento.',
      DIRECTOR_NODE_PERMISSION_PARTIAL: 'El PDF quedó en Emitidos, pero no se pudo confirmar la configuración de acceso para la dependencia destinataria. Revisa el documento antes de reintentar.',
      DIRECTOR_MULTIFILING_PERMISSION_REQUIRED: 'El documento quedó creado en Emitidos, pero Alfresco denegó su asociación a la bandeja destinataria. Revisa los permisos de asociación y lectura del documento.',
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
      error.uncertain = [
        'DIRECTOR_NODE_PERMISSION_READ_FORBIDDEN',
        'DIRECTOR_NODE_PERMISSION_WRITE_FORBIDDEN',
        'DIRECTOR_NODE_PERMISSION_CONFLICT',
        'DIRECTOR_NODE_PERMISSION_PARTIAL',
        'DIRECTOR_MULTIFILING_PERMISSION_REQUIRED',
        'DIRECTOR_MULTIFILING_PARTIAL',
      ].includes(body.error)
      error.emittedNodeId = body.emittedNodeId || ''
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
