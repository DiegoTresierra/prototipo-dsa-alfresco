const coreApiPrefix = import.meta.env.VITE_ALFRESCO_CORE_API_PREFIX
const searchApiPrefix = import.meta.env.VITE_ALFRESCO_SEARCH_API_PREFIX

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.error?.briefSummary || body?.error?.description || ''
    } catch {
      detail = ''
    }

    throw new Error(detail || `La API respondió con estado ${response.status}.`)
  }

  return response.status === 204 ? null : response.json()
}

async function requestBlob(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`No se pudo obtener el archivo. La API respondió con estado ${response.status}.`)
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
  const params = new URLSearchParams({
    include: 'properties,association,content,path',
    maxItems: String(options.maxItems || 100),
  })

  if (options.where) params.set('where', options.where)

  const response = await request(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/children?${params}`)
  return (response.list?.entries || []).map(({ entry }) => nodeToDocument(entry))
}

export async function searchDocuments(query, options = {}) {
  const response = await request(`${searchApiPrefix}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: { query },
      paging: { maxItems: options.maxItems || 100, skipCount: options.skipCount || 0 },
      include: ['properties', 'aspectNames', 'path'],
    }),
  })

  return (response.list?.entries || []).map(({ entry }) => nodeToDocument(entry))
}

export async function getNodeContent(nodeId) {
  return requestBlob(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/content?attachment=false`)
}

export async function uploadPdfToFolder(nodeId, file, { title, description }) {
  if (!nodeId) throw new Error('No está configurada la carpeta de pruebas de Alfresco.')
  if (typeof File === 'undefined' || !(file instanceof File) || (file.type && file.type !== 'application/pdf') || !file.name.toLocaleLowerCase('es').endsWith('.pdf')) {
    throw new Error('Selecciona un archivo PDF válido.')
  }

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
    response = await fetch(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}/children?autoRename=false`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    })
  } catch {
    const error = new Error('No se pudo confirmar la respuesta de Alfresco. Revisa la carpeta antes de volver a intentar.')
    error.uncertain = true
    throw error
  }

  if (!response.ok) {
    const safeMessages = {
      401: 'Alfresco rechazó la autenticación de la conexión.',
      403: 'La conexión no tiene permiso para crear documentos en la carpeta de pruebas.',
      404: 'No se encontró la carpeta de pruebas configurada.',
      409: 'Ya existe un archivo con ese nombre en la carpeta de pruebas.',
      413: 'El archivo supera el tamaño permitido por Alfresco.',
      415: 'Alfresco rechazó el formato del archivo.',
    }
    const error = new Error(safeMessages[response.status] || `Alfresco no pudo crear el documento (HTTP ${response.status}).`)
    error.uncertain = response.status >= 500
    throw error
  }

  let result
  try {
    result = await response.json()
  } catch {
    const error = new Error('Alfresco respondió sin un resultado verificable. Revisa la carpeta antes de volver a intentar.')
    error.uncertain = true
    throw error
  }

  if (!result?.entry?.id) {
    const error = new Error('Alfresco no devolvió el identificador del documento; revisa la carpeta antes de volver a intentar.')
    error.uncertain = true
    throw error
  }

  return result.entry
}

export async function listGroupMembers(groupId) {
  const params = new URLSearchParams({
    where: "(memberType='PERSON')",
    maxItems: '100',
  })
  const response = await request(`${coreApiPrefix}/groups/${encodeURIComponent(groupId)}/members?${params}`)
  return (response.list?.entries || []).map(({ entry }) => entry)
}

export async function getNodePermissions(nodeId) {
  const response = await request(`${coreApiPrefix}/nodes/${encodeURIComponent(nodeId)}?include=permissions`)
  return response.entry?.permissions || null
}
