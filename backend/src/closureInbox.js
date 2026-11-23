import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { parseAssignments } from './alfrescoDispatchRepository.js'
import { evidenceHash } from './closureEvidenceContract.js'

const fail = (code, status = 502) => { throw Object.assign(new Error(code), { status }) }
export function closureCategory(result) {
  const r = result.closureReceipt
  if (result.closed === true && r?.schemaVersion === 2 && r.executionMode === 'ALFRESCO' && r.documentId === result.evaluation?.documentId &&
      r.dependency === result.evaluation?.scope?.dependency && r.at === result.closedAt && r.actorUserId === result.closedBy &&
      r.processId === result.closureProcessId && r.operationId && !result.uncertain && !result.evaluationFailed) return 'CERRADAS'
  if (!result.closed && !result.uncertain && !result.pendingOperation && !result.evaluationFailed &&
      result.evaluation?.preliminaryCompliance === 'MET' && !result.evaluation.blockingReasons.length &&
      result.evaluation.knowledgeSummary?.exclusivelyKnowledge === false) return 'APTAS'
  return 'PENDIENTES'
}
// Direct actor-ACL-filtered enumeration, never an indexed search or an Emitidos alias.
// evaluate is the SAME protected service used by the existing single-document GET.
export async function listClosureInbox(settings, session, evaluate, fetchImpl = globalThis.fetch) {
  const identity = await revalidateInstitutionalIdentity(settings, session, fetchImpl)
  if (identity.functionalRole !== 'direccion' || !session.capabilities?.includes('documents:read')) fail('CLOSURE_DIRECTION_REQUIRED', 403)
  const dependency = identity.dependency.toLowerCase()
  const folders = settings.officeInboxNodeIds?.[identity.dependency]
  if (!folders?.emitidos || !folders?.porAtender || !folders?.porConocimiento) fail('CLOSURE_INBOX_NOT_CONFIGURED', 503)
  async function get(path) {
    let r
    try { r = await fetchImpl(settings.alfrescoTarget + '/alfresco/api/-default-/public/alfresco/versions/1' + path,
      { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: session.authorization, Accept: 'application/json' } }) }
    catch { fail('CLOSURE_INBOX_UNAVAILABLE', 503) }
    if (!r.ok) fail('CLOSURE_INBOX_READ_DENIED', [401, 403, 404].includes(r.status) ? 403 : 502)
    try { return await r.json() } catch { fail('CLOSURE_INBOX_INVALID_RESPONSE') }
  }
  const memberships = new Map()
  for (const folder of new Set(Object.values(folders).filter(v => typeof v === 'string' && v))) {
    let skip = 0, total
    for (;;) {
      const list = (await get(`/nodes/${encodeURIComponent(folder)}/children?where=%28assocType%3D%27cm%3Acontains%27%29&include=association&maxItems=100&skipCount=${skip}`)).list
      const p = list?.pagination
      if (!Array.isArray(list?.entries) || list.entries.length > 100 || p?.skipCount !== skip || p.count !== list.entries.length ||
          !Number.isSafeInteger(p.totalItems) || p.totalItems < 0 || typeof p.hasMoreItems !== 'boolean' || total !== undefined && total !== p.totalItems) fail('CLOSURE_INBOX_INVALID_PAGINATION')
      total = p.totalItems
      for (const { entry } of list.entries) {
        if (!entry?.id || typeof entry.id !== 'string' || entry.association?.assocType !== 'cm:contains') fail('CLOSURE_INBOX_INVALID_RESPONSE')
        if (!memberships.has(entry.id)) memberships.set(entry.id, new Set())
        memberships.get(entry.id).add(folder)
      }
      skip += list.entries.length
      if (skip > total || p.hasMoreItems !== (skip < total) || !list.entries.length && p.hasMoreItems) fail('CLOSURE_INBOX_INVALID_PAGINATION')
      if (!p.hasMoreItems) break
    }
  }
  const documents = [], documentErrors = []
  for (const [id, memberOf] of memberships) {
    let node
    try { node = (await get(`/nodes/${encodeURIComponent(id)}?include=properties,aspectNames`)).entry }
    catch (e) { documentErrors.push({ documentId: id, error: e.message }); continue }
    if (node?.id !== id) fail('CLOSURE_INBOX_INVALID_RESPONSE')
    if (node.isFile !== true || node.nodeType !== 'cm:content' || node.content?.mimeType !== 'application/pdf') continue
    let result
    try {
      const envelope = parseAssignments(node.properties?.['gd:asignaciones'], id)
      const own = envelope.dispatches.some(d => d.recipients.some(a => a.dependency === dependency)) ||
        envelope.reviewProcesses?.some(p => p.dependency === dependency) || envelope.closureProcesses?.some(p => p.dependency === dependency) ||
        envelope.closureEvidence?.classifications?.some(c => c.dependency === dependency)
      // Unclassified received documents remain visible as indeterminate. Bare emitted
      // originals without an intervention are not candidates just because of their folder.
      if (!own && !memberOf.has(folders.porAtender) && !memberOf.has(folders.porConocimiento)) continue
      result = await evaluate(id, session)
      // The list metadata and the protected evaluation must describe the same
      // snapshot. A successful evaluation cannot certify older responsibilities.
      if (result.sourcePropertiesHash !== evidenceHash(node.properties || {})) fail('CLOSURE_STALE_EVALUATION', 409)
    } catch (e) {
      result = { evaluation: { documentId: id, scope: { type: 'dependency', dependency }, preliminaryCompliance: 'INDETERMINATE',
        blockingReasons: [/^[A-Z_]+$/.test(e.message) ? e.message : 'CLOSURE_EVALUATION_UNAVAILABLE'], summary: null },
        closed: false, canClose: false, writesEnabled: false, evaluationFailed: true }
    }
    const value = result.evaluation
    documents.push({ ...node, closure: { ...result, category: closureCategory(result), key: `${id}:${dependency}`, dependency,
      responsibleUserIds: (() => { try { return [...new Set(parseAssignments(node.properties?.['gd:asignaciones'], id).dispatches
        .flatMap(d => d.recipients).filter(a => a.dependency === dependency).map(a => a.userId))] } catch { return [] } })(),
      // This metadata snapshot is for display only; actions must obtain a fresh evaluation.
      compliance: value.preliminaryCompliance } })
  }
  const complete = !documentErrors.length && documents.every(d => !d.closure.evaluationFailed)
  return { source: 'alfresco', semantics: 'dependency-closure-interventions', dependency, documents, documentErrors,
    complete, coverage: { complete, scope: 'configured-institutional-trays' },
    counts: complete ? Object.fromEntries(['APTAS', 'PENDIENTES', 'CERRADAS'].map(c => [c, documents.filter(d => d.closure.category === c).length])) : null,
    observedAt: new Date().toISOString() }
}
