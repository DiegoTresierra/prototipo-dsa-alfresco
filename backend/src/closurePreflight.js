import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { authorizeNodeRead } from './documentReadPolicy.js'
import { belongsToFolder } from './dispatchPilotScope.js'
import { parseAssignments, projections } from './alfrescoDispatchRepository.js'
import { createResponseProposalReader } from './responseProposalReader.js'
import { evaluateClosure, validateClosureScope } from './closureEvaluation.js'
import { readClosureEvidence } from './closureEvidenceReader.js'

const core = '/api/-default-/public/alfresco/versions/1'
const fail = (code, status = 403) => { throw Object.assign(new Error(code), { status }) }

// Internal GET-only service. No HTTP route, technical identity, or mutable adapter.
export function createClosurePreflight(settings, { fetchImpl = (...args) => globalThis.fetch(...args), clock = () => new Date(), institutionalProvider } = {}) {
  return async function preflight({ documentId, scope }, session) {
    scope = validateClosureScope(scope)
    if (typeof documentId !== 'string' || !/^[A-Za-z0-9-]{1,250}$/.test(documentId)) fail('CLOSURE_INVALID_DOCUMENT', 400)
    const identity = await revalidateInstitutionalIdentity(settings, session, fetchImpl)
    if (!session.capabilities?.includes('documents:read')) fail('DOCUMENT_READ_NOT_ALLOWED')
    // Integral competence has not been approved or supplied by an institutional provider.
    if (scope.type === 'document') fail('CLOSURE_INTEGRAL_COMPETENCE_PENDING')
    if (scope.dependency !== identity.dependency.toLowerCase()) fail('CLOSURE_SCOPE_NOT_ALLOWED')
    async function get(path, { authorization = session.authorization, query = '' } = {}) {
      if (authorization !== session.authorization) fail('DOCUMENT_READ_NOT_ALLOWED')
      let r
      try { r = await fetchImpl(settings.alfrescoTarget + '/alfresco' + path + query, { method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { Authorization: session.authorization, Accept: 'application/json' } }) }
      catch { fail('CLOSURE_READ_UNAVAILABLE', 503) }
      if (!r.ok) fail(r.status === 401 || r.status === 403 || r.status === 404 ? 'DOCUMENT_READ_NOT_ALLOWED' : 'CLOSURE_READ_UNAVAILABLE', r.status === 401 || r.status === 403 || r.status === 404 ? 403 : 503)
      try { return await r.json() } catch { fail('CLOSURE_INVALID_RESPONSE', 502) }
    }
    const node = (await get(`${core}/nodes/${encodeURIComponent(documentId)}`, { query: '?include=properties,aspectNames' })).entry
    if (node?.id !== documentId || !node.isFile || node.nodeType !== 'cm:content' || node.content?.mimeType !== 'application/pdf') fail('DOCUMENT_READ_NOT_ALLOWED')
    const folders = settings.officeInboxNodeIds?.[identity.dependency] || {}
    if (!Object.values(folders).length || !await belongsToFolder(documentId, Object.values(folders), session.authorization, get)) fail('CLOSURE_SCOPE_NOT_ALLOWED')
    const envelope = parseAssignments(node.properties?.['gd:asignaciones'], documentId)
    if (node.properties?.['gd:asignaciones'] !== undefined && !node.aspectNames?.includes('gd:tramite')) fail('CLOSURE_INVALID_ASSIGNMENTS', 409)
    const knowledgeOnly = Boolean(folders.porConocimiento && await belongsToFolder(documentId, [folders.porConocimiento], session.authorization, get))
    if (['jefe-unidad', 'especialista'].includes(identity.functionalRole) && !await authorizeNodeRead({ settings, session, fetchImpl,
      institutionalMemberships: new Map([[documentId, new Set(knowledgeOnly ? [folders.porConocimiento] : [])]]),
      actorNodes: new Map([[documentId, node]]), listDispatches: async () => envelope.dispatches }, documentId)) fail('DOCUMENT_READ_NOT_ALLOWED')
    const consistent = Object.entries(projections(envelope)).every(([k, expected]) => {
      const actual = node.properties?.[k]
      return actual === undefined && !expected.length || Array.isArray(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
    })
    const proposals = {}
    const reader = createResponseProposalReader(settings, fetchImpl)
    for (const p of envelope.reviewProcesses || []) {
      if (p.dependency !== scope.dependency) continue
      try { await reader.content(documentId, p.id, p.snapshot.versionId, session); proposals[p.id] = true }
      catch { proposals[p.id] = false }
    }
    const responses = [...(envelope.responses || []).filter(r => r.emitterDependency === scope.dependency),
      ...envelope.dispatches.flatMap(d => d.recipients).filter(a => a.dependency === scope.dependency).flatMap(a => a.responses || [])]
    let responsesVerified = responses.length > 0
    for (const id of new Set(responses.map(r => r.documentId))) {
      try {
        const response = (await get(`${core}/nodes/${encodeURIComponent(id)}`)).entry
        if (response?.id !== id || !response.isFile || response.nodeType !== 'cm:content' || response.content?.mimeType !== 'application/pdf') throw new Error('invalid')
        let found = false
        for (let skip = 0; ;) {
          const { list } = await get(`${core}/nodes/${encodeURIComponent(id)}/targets`, { query: `?where=(assocType='cm:references')&include=association&maxItems=100&skipCount=${skip}` })
          if (!Array.isArray(list?.entries) || list.pagination?.skipCount !== skip || typeof list.pagination.hasMoreItems !== 'boolean') throw new Error('invalid')
          found ||= list.entries.some(({ entry }) => entry?.id === documentId && entry.association?.assocType === 'cm:references')
          if (!list.pagination.hasMoreItems) break
          if (!list.entries.length || skip > 10000) throw new Error('limit')
          skip += list.entries.length
        }
        responsesVerified &&= found
      } catch { responsesVerified = false }
    }
    const evaluatedAt = clock().toISOString()
    const closureEvidence = await readClosureEvidence({ envelope, scope, session, settings, get, fetchImpl, institutionalProvider, checkedAt: evaluatedAt })
    const finalNode = (await get(`${core}/nodes/${encodeURIComponent(documentId)}`, { query: '?include=properties' })).entry
    if (finalNode?.id !== documentId || JSON.stringify(finalNode.properties) !== JSON.stringify(node.properties)) fail('CLOSURE_SNAPSHOT_CHANGED', 409)
    // A verified reference never attests sufficiency or an official emission receipt.
    return evaluateClosure({ envelope, scope, evaluatedAt, evidence: {
      originalRead: true, institutionalScope: true, projections: consistent, proposals, responsesVerified, knowledgeOnly, ...closureEvidence } })
  }
}
