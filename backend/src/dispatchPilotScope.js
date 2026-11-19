import { canDispatch } from './dispatchPolicy.js'
import { validatePilotEnvironment } from './dispatchPilot.js'
import { canAttendSession } from './attentionPolicy.js'

const core = '/api/-default-/public/alfresco/versions/1'
const fail = (code, status = 403) => { throw Object.assign(new Error(code), { status }) }

// Positive membership proof from the configured folders, with ACTOR credentials.
// This recognizes primary and secondary cm:contains associations without /parents.
export async function belongsToFolder(documentId, folders, authorization, request) {
  let inspected = 0
  for (const folderId of folders) {
    let skipCount = 0
    let more
    do {
      let payload
      try {
        payload = await request(`${core}/nodes/${encodeURIComponent(folderId)}/children`, {
          authorization, query: `?include=association&maxItems=100&skipCount=${skipCount}`,
        })
      } catch (error) {
        if (error.message === 'DISPATCH_NODE_READ_DENIED') break
        throw error
      }
      const list = payload?.list
      if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean' ||
          list.entries.some((item) => typeof item?.entry?.id !== 'string')) fail('DISPATCH_SCOPE_INVALID_RESPONSE', 502)
      if (list.entries.some(({ entry }) => entry.id === documentId && entry.association?.assocType === 'cm:contains')) return true
      more = list.pagination.hasMoreItems
      skipCount += list.entries.length
      inspected += list.entries.length
      if (inspected > 10_000 || more && !list.entries.length) fail('DISPATCH_SCOPE_QUERY_LIMIT', 503)
    } while (more)
  }
  return false
}

async function verifyInstitutionalScope(settings, session, node, request, allowed) {
  const { institutionalFolders } = validatePilotEnvironment(settings)
  if (!allowed || !session.authorization || !session.capabilities?.includes('documents:read')) fail('HIERARCHICAL_DISPATCH_REQUIRED')
  if (!node?.isFile || node.nodeType !== 'cm:content' || node.content?.mimeType !== 'application/pdf') fail('DISPATCH_INVALID_DOCUMENT')
  const allowedFolders = institutionalFolders[String(session.dependency).toUpperCase()] || []
  if (!allowedFolders.length || !await belongsToFolder(node.id, allowedFolders, session.authorization, request)) fail('DISPATCH_DOCUMENT_NOT_ALLOWED')
}
export const verifyPilotDocumentScope = (settings, session, node, request) => verifyInstitutionalScope(settings, session, node, request, canDispatch(session))
export const verifyAttentionDocumentScope = (settings, session, node, request) => verifyInstitutionalScope(settings, session, node, request, canAttendSession(session))
