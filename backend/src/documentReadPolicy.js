import { buildAlfrescoUrl } from './alfrescoClient.js'
import { isAttentionAssignment } from './dispatchStore.js'

const core = '/api/-default-/public/alfresco/versions/1'
const searchPath = '/api/-default-/public/search/versions/1/search'
const fail = (code, status) => { throw Object.assign(new Error(code), { status }) }
const officeFolders = ({ session, settings }) => settings.officeInboxNodeIds?.[String(session.dependency || '').toUpperCase()] || {}
const userId = (session) => session.alfresco?.id || session.user?.id

function pagination(value) {
  const maxItems = Number(value?.maxItems ?? 100)
  const skipCount = Number(value?.skipCount ?? 0)
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 100 || !Number.isSafeInteger(skipCount) || skipCount < 0) fail('INVALID_DOCUMENT_PAGING', 400)
  return { maxItems, skipCount }
}

export function validateDocumentReadRequest(request, settings) {
  const match = request.path.match(/^\/api\/-default-\/public\/alfresco\/versions\/1\/nodes\/([^/]+)(?:\/(children|content))?$/)
  const isSearch = request.method === 'POST' && request.path === searchPath
  if (!(request.method === 'GET' && match) && !isSearch) return null
  if (!request.session.capabilities?.includes('documents:read') || !userId(request.session)) fail('DOCUMENT_READ_REQUIRED', 403)
  if (!['jefe-unidad', 'especialista'].includes(request.session.functionalRole)) return null // Existing institutional ACL policy for other roles.
  let nodeId
  try { nodeId = match ? decodeURIComponent(match[1]) : undefined } catch { fail('INVALID_DOCUMENT_ID', 400) }
  if (nodeId && !/^[A-Za-z0-9-]+$/.test(nodeId)) fail('INVALID_DOCUMENT_ID', 400)
  const collection = isSearch ? 'search' : match[2] === 'children' ? 'children' : null
  if (collection === 'children') {
    if (!Object.values(officeFolders({ session: request.session, settings })).includes(nodeId)) fail('DOCUMENT_FOLDER_NOT_ALLOWED', 403)
    const query = new URLSearchParams(request.url.split('?')[1] || '')
    if ([...query.keys()].some((key) => !['maxItems', 'skipCount', 'where', 'orderBy', 'include'].includes(key))) fail('UNSUPPORTED_DOCUMENT_QUERY', 400)
    return { nodeId, collection, ...pagination(Object.fromEntries(query)) }
  }
  if (isSearch) {
    const body = request.body
    if (!body || Object.keys(body).some((key) => !['query', 'paging', 'sort', 'include'].includes(key)) ||
        typeof body.query?.query !== 'string' || !body.query.query.trim() ||
        (body.query.language && body.query.language !== 'afts') ||
        Object.keys(body.query).some((key) => !['query', 'language'].includes(key)) ||
        (body.include && (!Array.isArray(body.include) || body.include.some((item) => !['properties', 'aspectNames', 'path'].includes(item))))) {
      fail('UNSUPPORTED_DOCUMENT_QUERY', 400)
    }
    return { collection, ...pagination(body.paging) }
  }
  return { nodeId, collection }
}

async function upstream(context, path, query = '', body) {
  const response = await (context.fetchImpl || globalThis.fetch)(buildAlfrescoUrl(context.settings.alfrescoTarget, path, query), {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', Authorization: context.session.authorization, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if ([403, 404].includes(response.status)) return { denied: response.status }
  if (!response.ok) fail('ALFRESCO_READ_UNAVAILABLE', response.status === 401 ? 401 : 502)
  try { return await response.json() } catch { fail('ALFRESCO_INVALID_LIST_RESPONSE', 502) }
}

async function assignedIds(context) {
  if (context.assignedIds) return context.assignedIds
  const { session } = context
  try {
    context.assignedIds = new Set((await context.listDispatches(userId(session), session.functionalRole, session.dependency, session))
      .filter((record) => record.recipients.some((recipient) => isAttentionAssignment(recipient, userId(session), session.functionalRole, session.dependency)))
      .map((record) => record.documentId))
    return context.assignedIds
  } catch (error) { fail(/^DISPATCH_[A-Z_]+$/.test(error.message) ? error.message : 'DISPATCH_STORE_UNAVAILABLE', 503) }
}

export async function authorizeNodeRead(context, nodeId) {
  context.decisions ||= new Map()
  if (context.decisions.has(nodeId)) return context.decisions.get(nodeId)
  const payload = await upstream(context, `${core}/nodes/${encodeURIComponent(nodeId)}`, '?include=properties')
  if (payload.denied) return false
  const node = payload.entry
  if (!node || node.id !== nodeId) fail('ALFRESCO_INVALID_NODE_RESPONSE', 502)
  context.nodes ||= new Map()
  context.nodes.set(nodeId, node)
  const folders = officeFolders(context)
  let allowed = Object.values(folders).includes(nodeId) || node.createdByUser?.id === userId(context.session)
  if (!allowed && node.isFile) {
    // These are independent reading rights. Neither makes the user responsible.
    let assignmentError
    const knowledgeFolder = context.session.functionalRole === 'jefe-unidad' ? folders.porConocimiento : null
    allowed = Boolean(knowledgeFolder && node.parentId === knowledgeFolder)
    if (!allowed) {
      try { allowed = (await assignedIds(context)).has(node.id) } catch (error) { assignmentError = error }
    }
    if (!allowed && knowledgeFolder) {
      let skipCount = 0
      let more
      do {
        const parents = await upstream(context, `${core}/nodes/${encodeURIComponent(node.id)}/parents`, `?maxItems=100&skipCount=${skipCount}`)
        if (parents.denied) break
        const list = parents.list
        if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') fail('ALFRESCO_INVALID_LIST_RESPONSE', 502)
        allowed = list.entries.some(({ entry }) => entry?.id === knowledgeFolder)
        more = list.pagination.hasMoreItems
        skipCount += list.entries.length
        if ((!list.entries.length && more) || skipCount > 10_000) fail('ALFRESCO_INVALID_LIST_RESPONSE', 502)
      } while (!allowed && more)
    }
    if (!allowed && assignmentError) throw assignmentError
  }
  context.decisions.set(nodeId, allowed)
  return allowed
}

// Scan and repaginate the authorized set. Never expose upstream totals, facets or context.
export async function filterDocumentCollection(context, request, readRequest) {
  const authorized = []
  let skipCount = 0
  let more
  do {
    const query = new URLSearchParams(request.url.split('?')[1] || '')
    query.set('maxItems', '100')
    query.set('skipCount', String(skipCount))
    const isSearch = readRequest.collection === 'search'
    const payload = await upstream(context, isSearch ? searchPath : `${core}/nodes/${encodeURIComponent(readRequest.nodeId)}/children`,
      isSearch ? '' : `?${query}`, isSearch ? { ...request.body, paging: { maxItems: 100, skipCount } } : undefined)
    if (payload.denied) fail('DOCUMENT_READ_NOT_ALLOWED', payload.denied)
    const list = payload.list
    if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') fail('ALFRESCO_INVALID_LIST_RESPONSE', 502)
    for (const record of list.entries) {
      if (typeof record?.entry?.id !== 'string') fail('ALFRESCO_INVALID_LIST_RESPONSE', 502)
      if (await authorizeNodeRead(context, record.entry.id)) authorized.push(record)
    }
    more = list.pagination.hasMoreItems
    skipCount += list.entries.length
    if ((!list.entries.length && more) || skipCount > 10_000) fail('DOCUMENT_QUERY_LIMIT_EXCEEDED', 503)
  } while (more)
  const { maxItems, skipCount: requestedSkip } = readRequest
  const entries = authorized.slice(requestedSkip, requestedSkip + maxItems)
  return { list: { entries, pagination: { count: entries.length, totalItems: authorized.length, skipCount: requestedSkip, maxItems, hasMoreItems: requestedSkip + entries.length < authorized.length } } }
}
