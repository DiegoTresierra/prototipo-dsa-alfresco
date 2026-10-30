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
