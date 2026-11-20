import { parseAssignments } from './alfrescoDispatchRepository.js'
import { proposalMetadataHash, verifyProposalPdf } from './responseReview.js'

const core = '/alfresco/api/-default-/public/alfresco/versions/1'
const fail = (code, status = 502) => { throw Object.assign(new Error(code), { status }) }
export function createResponseProposalReader(settings, fetchImpl = (...args) => globalThis.fetch(...args)) {
  async function get(path, session, binary = false) {
    const r = await fetchImpl(settings.alfrescoTarget + core + path, { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { Authorization: session.authorization, Accept: binary ? 'application/pdf' : 'application/json' } })
    if (!r.ok) fail(r.status === 403 || r.status === 404 ? 'PROPOSAL_INACCESSIBLE' : 'PROPOSAL_READ_FAILED', r.status === 403 || r.status === 404 ? 403 : 502)
    if (!binary) return r.json()
    // Bound downloads even when Content-Length is missing or inaccurate.
    const chunks = []; let length = 0
    for await (const chunk of r.body) {
      length += chunk.length
      if (length > 25 * 1024 * 1024) fail('PROPOSAL_INVALID_VERSION', 422)
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
  async function entries(path, session) {
    let skip = 0; const all = []
    for (;;) {
      const { list } = await get(`${path}${path.includes('?') ? '&' : '?'}maxItems=100&skipCount=${skip}`, session)
      if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean' || list.pagination.skipCount !== skip) fail('PROPOSAL_INCONSISTENT', 409)
      all.push(...list.entries.map(({ entry }) => entry)); skip += list.entries.length
      if (skip > 10000 || list.pagination.hasMoreItems && !list.entries.length) fail('PROPOSAL_INCONSISTENT', 409)
      if (!list.pagination.hasMoreItems) return all
    }
  }
  async function processes(documentId, session) {
    const { entry } = await get(`/nodes/${encodeURIComponent(documentId)}?include=properties`, session)
    if (entry?.id !== documentId || !entry.isFile) fail('PROPOSAL_INCONSISTENT', 409)
    const envelope = parseAssignments(entry.properties?.['gd:asignaciones'], documentId)
    return (envelope.reviewProcesses || []).map((p) => ({ ...p,
      pendingOperation: (envelope.reviewOperations || []).some((o) => o.processId === p.id && o.phase !== 'COMMITTED') }))
  }
  async function inspect(p, documentId, session, versionId = p.snapshot.versionId) {
    const path = `/nodes/${encodeURIComponent(p.proposalDocumentId)}`
    const { entry: node } = await get(path + '?include=properties', session)
    if (node?.id !== p.proposalDocumentId || node.nodeType !== 'cm:content' || !node.isFile || node.content?.mimeType !== 'application/pdf') fail('PROPOSAL_INCONSISTENT', 409)
    if (!node.aspectNames?.includes('cm:versionable') || node.properties?.['cm:versionLabel'] !== p.snapshot.versionId || proposalMetadataHash(node) !== p.snapshot.metadataSha256) fail('PROPOSAL_INCONSISTENT', 409)
    const targets = await entries(path + "/targets?where=(assocType='cm:references')&include=association", session)
    if (!targets.some((e) => e?.id === documentId && e.association?.assocType === 'cm:references')) fail('PROPOSAL_INCONSISTENT', 409)
    const snapshots = p.events.filter((e) => e.snapshot).map((e) => e.snapshot)
    const snapshot = snapshots.find((s) => s.versionId === versionId)
    if (!snapshot) fail('PROPOSAL_INVALID_VERSION', 422)
    const versions = await entries(path + '/versions', session)
    if (!versions.some((v) => v?.id === versionId)) fail('PROPOSAL_INVALID_VERSION', 422)
    const { entry: version } = await get(path + `/versions/${encodeURIComponent(versionId)}?include=properties`, session)
    if (version?.id !== versionId || !version.isFile || version.content?.mimeType !== 'application/pdf') fail('PROPOSAL_INVALID_VERSION', 422)
    // Without version-specific metadata the approval snapshot cannot be attested.
    if (!version.properties || proposalMetadataHash(version) !== snapshot.metadataSha256) fail('PROPOSAL_INCONSISTENT', 409)
    const bytes = await get(path + `/versions/${encodeURIComponent(versionId)}/content`, session, true)
    verifyProposalPdf(bytes, snapshot.contentSha256)
    return { bytes, metadata: { processId: p.id, proposalDocumentId: node.id, state: p.state, revision: p.revision,
      versionId, title: version.properties['cm:title'] || version.name, versions: [...new Set(snapshots.map((s) => s.versionId))],
      contentSha256: snapshot.contentSha256, status: 'AVAILABLE' } }
  }
  return {
    async list(documentId, session) {
      const result = []
      for (const p of await processes(documentId, session)) {
        try {
          const verified = await inspect(p, documentId, session)
          result.push(p.pendingOperation ? { status: 'UNAVAILABLE' } : verified.metadata)
        }
        catch (error) {
          // Do not leak node IDs, process IDs, authors, counts of versions or metadata on denial.
          const status = error.message === 'PROPOSAL_INACCESSIBLE' ? 'INACCESSIBLE'
            : error.message === 'PROPOSAL_INVALID_VERSION' ? 'INVALID_VERSION'
              : ['PROPOSAL_INCONSISTENT', 'PROPOSAL_CONTENT_CHANGED'].includes(error.message) ? 'INCONSISTENT' : 'UNAVAILABLE'
          result.push({ status })
        }
      }
      return { proposals: result, persistence: 'alfresco', writesEnabled: false }
    },
    async content(documentId, processId, versionId, session) {
      const p = (await processes(documentId, session)).find((p) => p.id === processId)
      if (!p) fail('PROPOSAL_INACCESSIBLE', 403)
      return (await inspect(p, documentId, session, versionId)).bytes
    },
  }
}
