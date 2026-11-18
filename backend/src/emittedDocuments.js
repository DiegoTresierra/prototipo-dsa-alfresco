import { documentIdentity } from './documentIdentity.js'

const core = '/alfresco/api/-default-/public/alfresco/versions/1'
const fail = (code, status = 502) => Object.assign(new Error(code), { status })
const institution = (value) => ['DTI', 'DSA'].includes(String(value || '').trim().toUpperCase()) ? String(value).trim().toUpperCase() : null

export function emittedOrigin(node, dependency, folderId) {
  // A secondary association, current user, creator or dispatcher never turns a
  // received document into an institutional original.
  const primary = node.parentId === folderId
  const p = node.properties || {}
  const declared = p['gd:dependenciaOrigen']
  const code = p['gd:codigoDocumental']
  const origin = declared ? institution(declared) : null
  const codeOrigin = typeof code === 'string' ? institution(code.split('-')[0]) : null
  if (declared && !origin || code && !codeOrigin || origin && codeOrigin && origin !== codeOrigin) throw fail('EMITTED_ORIGIN_CONFLICT', 409)
  const declaredOrigin = origin || codeOrigin
  if (!declaredOrigin && !primary) return null
  const resolved = declaredOrigin || dependency
  if (resolved !== dependency) {
    if (primary) throw fail('EMITTED_ORIGIN_CONFLICT', 409)
    return null
  }
  return { dependency: resolved, evidence: origin ? 'gd:dependenciaOrigen' : codeOrigin ? 'gd:codigoDocumental' : 'institutional-primary-folder',
    declared: Boolean(origin || codeOrigin) }
}

export async function listInstitutionalEmitted(settings, session, fetchImpl = globalThis.fetch) {
  const dependency = institution(session?.dependency)
  if (session?.authorizationStatus !== 'active' || session.functionalRole !== 'direccion' || !dependency ||
      !session.capabilities?.includes('documents:read') || !session.alfresco?.id || !session.authorization) throw fail('EMITTED_READ_NOT_ALLOWED', 403)
  const folderId = settings.officeInboxNodeIds?.[dependency]?.emitidos
  if (!folderId) throw fail('EMITTED_FOLDER_NOT_CONFIGURED', 503)
  const get = async (path) => {
    let r
    try { r = await fetchImpl(settings.alfrescoTarget + core + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', Authorization: session.authorization } }) }
    catch { throw fail('EMITTED_REPOSITORY_UNAVAILABLE') }
    if (!r.ok) throw fail('EMITTED_REPOSITORY_READ_REJECTED', r.status)
    try { return await r.json() } catch { throw fail('EMITTED_INVALID_RESPONSE') }
  }
  const root = (await get(`/nodes/${encodeURIComponent(folderId)}`))?.entry
  if (root?.id !== folderId || root.isFolder !== true) throw fail('EMITTED_FOLDER_INVALID')
  const documents = [], documentErrors = [], seen = new Set()
  let skip = 0, total
  for (;;) {
    const list = (await get(`/nodes/${encodeURIComponent(folderId)}/children?where=%28assocType%3D%27cm%3Acontains%27%29&include=association&maxItems=100&skipCount=${skip}`))?.list
    const paging = list?.pagination
    if (!Array.isArray(list?.entries) || list.entries.length > 100 || !Number.isSafeInteger(paging?.totalItems) || paging.totalItems < 0 ||
        paging.skipCount !== skip || paging.count !== list.entries.length || typeof paging.hasMoreItems !== 'boolean' || total !== undefined && total !== paging.totalItems) throw fail('EMITTED_INVALID_RESPONSE')
    total = paging.totalItems
    for (const { entry } of list.entries) {
      if (typeof entry?.id !== 'string' || !entry.id || entry.association?.assocType !== 'cm:contains') throw fail('EMITTED_INVALID_RESPONSE')
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      let node
      try {
        node = (await get(`/nodes/${encodeURIComponent(entry.id)}?include=properties,aspectNames`))?.entry
        if (node?.id !== entry.id) throw fail('EMITTED_INVALID_RESPONSE')
        if (!node.isFile) continue
        const origin = emittedOrigin(node, dependency, folderId)
        if (!origin) continue
        const mime = node.content?.mimeType
        if (mime !== 'application/pdf' && !(String(node.name || '').toLowerCase().endsWith('.pdf') && (!mime || mime === 'application/octet-stream'))) continue
        documents.push({ ...node, documentIdentity: documentIdentity(node, settings), emittedOrigin: origin,
          contentWarning: node.content?.sizeInBytes === 0 ? 'EMPTY_PDF_CONTENT' : null })
      } catch (error) {
        if (![403, 404, 409].includes(error.status)) throw error
        documentErrors.push({ documentId: entry.id, status: error.status, error: error.message })
      }
    }
    skip += list.entries.length
    if (skip > total || paging.hasMoreItems !== (skip < total) || (!list.entries.length && paging.hasMoreItems)) throw fail('EMITTED_INVALID_RESPONSE')
    if (!paging.hasMoreItems) break
  }
  return { dependency, folderId, documents, documentErrors, source: 'alfresco', semantics: 'institutional-originals',
    observedAt: new Date().toISOString() }
}
