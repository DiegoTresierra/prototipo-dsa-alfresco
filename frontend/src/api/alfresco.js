import { apiFetch } from './client'

const coreApiPrefix = '/api/alfresco/api/-default-/public/alfresco/versions/1'
const searchApiPrefix = '/api/alfresco/api/-default-/public/search/versions/1'

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

export async function uploadPdfToFolder(nodeId, file, { title, description }, csrfToken) {
  if (!nodeId) throw new Error('No está configurada la carpeta de pruebas de Alfresco.')
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
    response = await apiFetch(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/children?autoRename=false`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken }, body: formData })
  } catch {
    const error = new Error('No se pudo confirmar la respuesta de Alfresco. Revisa la carpeta antes de volver a intentar.')
    error.uncertain = true
    throw error
  }
  if (!response.ok) {
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

export async function listGroupMembers(groupId) {
  const params = new URLSearchParams({ where: "(memberType='PERSON')", maxItems: '100' })
  const response = await request(`${coreApiPrefix}/groups/${encodeURIComponent(groupId)}/members?${params}`)
  return (response.list?.entries || []).map(({ entry }) => entry)
}

export async function getNodePermissions(nodeId) {
  const response = await request(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}?include=permissions`)
  return response.entry?.permissions || null
}
