import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { belongsToFolder } from './dispatchPilotScope.js'
import { parseAssignments } from './alfrescoDispatchRepository.js'
const fail = (code, status = 403) => { throw Object.assign(new Error(code), { status }) }

// Shared functional group AND exact institutional dependency; never technical credentials.
export function createClosureAuthority(settings, fetchImpl = (...args) => globalThis.fetch(...args)) {
  return { async authorizeOrdinaryClosure(input) {
    const { documentId, dependency, actorUserId, authorization, envelopeRevision, action } = input
    if (action !== 'CLOSE_INTERVENTION' || !['dsa', 'dti'].includes(dependency) || !authorization) fail('CLOSURE_AUTHORITY_NOT_VERIFIED')
    const identity = await revalidateInstitutionalIdentity(settings, { authorization, authorizationStatus: 'active',
      alfresco: { id: actorUserId }, functionalRole: 'direccion', dependency }, fetchImpl)
    async function get(path, { query = '' } = {}) {
      let r
      try { r = await fetchImpl(settings.alfrescoTarget + '/alfresco' + path + query, { method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { Authorization: authorization, Accept: 'application/json' } }) }
      catch { fail('CLOSURE_AUTHORITY_UNAVAILABLE', 503) }
      if (!r.ok) fail('CLOSURE_DOCUMENT_ACCESS_NOT_CONFIRMED', [401, 403, 404].includes(r.status) ? 403 : 503)
      try { return await r.json() } catch { fail('CLOSURE_AUTHORITY_UNAVAILABLE', 503) }
    }
    const node = (await get(`/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(documentId)}`, { query: '?include=properties' })).entry
    if (node?.id !== documentId || node.nodeType !== 'cm:content' || !node.isFile || node.content?.mimeType !== 'application/pdf') fail('CLOSURE_DOCUMENT_ACCESS_NOT_CONFIRMED')
    const envelope = parseAssignments(node.properties?.['gd:asignaciones'], documentId)
    if (envelope.revision !== envelopeRevision) fail('CLOSURE_STALE_REVISION', 409)
    const folders = Object.values(settings.officeInboxNodeIds?.[identity.dependency] || {}).filter(v => typeof v === 'string' && v)
    if (!folders.length || !await belongsToFolder(documentId, folders, authorization, get)) fail('CLOSURE_SCOPE_NOT_ALLOWED')
    const required = [settings.groupMappings.functions.direccion, settings.groupMappings.dependencies[identity.dependency]].flat()
    const groupIds = required.filter(g => identity.groups.includes(g))
    return { verified: true, source: 'alfresco', reference: `institutional-direction:${identity.dependency}`,
      action, documentId, dependency, actorUserId: identity.person.id, envelopeRevision, groupIds }
  } }
}
