import { parseAssignments, maxAssignmentBytes, projections } from './alfrescoDispatchRepository.js'
import { closureSourceHash } from './ordinaryClosureContract.js'
import { evidenceHash } from './closureEvidenceContract.js'
import { validatePilotEnvironment, pilotLeaseIsHeld } from './dispatchPilot.js'
import { createClosureAuthority } from './closureAuthority.js'
const stores = new WeakSet()
const fail = (code, status = 503) => { throw Object.assign(new Error(code), { status }) }
export const isAlfrescoClosureStore = store => stores.has(store)
export function assertClosureWritesEnabled(settings) {
  const c = settings.documentClosure
  if (c?.writesEnabled !== true || c.environment !== 'dev' || settings.dispatchPilot?.environment !== 'dev' || c.expectedTarget !== settings.alfrescoTarget ||
      c.acknowledgement !== 'single-instance-exclusive-writer-dev-closure') fail('CLOSURE_WRITES_DISABLED')
  // Environment flags cannot prove durable dispatch history or fence external writers.
  // Until that protocol is implemented and validated, only isolated .invalid fixtures may write.
  if (!new URL(settings.alfrescoTarget).hostname.endsWith('.invalid')) fail('CLOSURE_REAL_READINESS_BLOCKED')
  validatePilotEnvironment(settings)
  if (!pilotLeaseIsHeld(settings)) fail('CLOSURE_EXCLUSIVE_WRITER_NOT_CONFIRMED')
}

// No administrative fallback, no ACL changes. The actor must be authorized by the engine.
export function createAlfrescoClosureStore(settings, { withDocument, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  if (typeof withDocument !== 'function') fail('CLOSURE_SHARED_MUTEX_REQUIRED')
  const uncertain = new Map()
  const root = { hasUncertain: id => uncertain.has(id), forSession(session) {
    const service = settings.distributionService
    async function getNode(id, authorization) {
      let r
      try { r = await fetchImpl(`${settings.alfrescoTarget}/alfresco/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(id)}?include=properties,aspectNames,allowableOperations`,
        { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: authorization, Accept: 'application/json' } }) }
      catch { fail('CLOSURE_READ_UNAVAILABLE') }
      if (!r.ok) fail('CLOSURE_NODE_ACCESS_DENIED', [401, 403, 404].includes(r.status) ? 403 : 503)
      let node
      try { node = (await r.json()).entry } catch { fail('CLOSURE_INVALID_NODE') }
      if (node?.id !== id || node.nodeType !== 'cm:content' || !node.isFile || node.content?.mimeType !== 'application/pdf') fail('CLOSURE_INVALID_NODE')
      const raw = node.properties?.['gd:asignaciones'], envelope = parseAssignments(raw, id)
      if (raw !== undefined && !node.aspectNames?.includes('gd:tramite')) fail('CLOSURE_INVALID_NODE')
      if (Object.entries(projections(envelope)).some(([key, expected]) => {
        const actual = node.properties?.[key]
        return !(actual === undefined && !expected.length) && (!Array.isArray(actual) || evidenceHash([...actual].sort()) !== evidenceHash([...expected].sort()))
      })) fail('DISPATCH_ASSIGNMENTS_PROJECTION_MISMATCH', 409)
      if ([...(envelope.closureProcesses || []), ...(envelope.closureOperations || [])].some(p => p.executionMode === 'SIMULATED')) fail('CLOSURE_SIMULATION_CANNOT_BE_PROMOTED', 409)
      return { node, raw, envelope }
    }
    const read = async id => {
      const current = await getNode(id, session.authorization)
      if (uncertain.get(id) === current.raw) uncertain.delete(id)
      return current
    }
    return Object.freeze({ withDocument, read, async save(id, next, raw) {
      assertClosureWritesEnabled(settings)
      if (uncertain.has(id)) fail('CLOSURE_RECONCILIATION_REQUIRED', 409)
      const serialized = JSON.stringify(next)
      if (Buffer.byteLength(serialized) > maxAssignmentBytes) fail('CLOSURE_ENVELOPE_SIZE_LIMIT', 413)
      parseAssignments(serialized, id)
      if ([...(next.closureProcesses || []), ...(next.closureOperations || [])].some(p => p.executionMode !== 'ALFRESCO')) fail('CLOSURE_SIMULATION_CANNOT_BE_PROMOTED', 409)
      const current = await read(id)
      if (current.raw !== raw || next.revision !== current.envelope.revision + 1 || closureSourceHash(next) !== closureSourceHash(current.envelope)) fail('CLOSURE_EXTERNAL_MODIFICATION', 409)
      for (const p of current.envelope.closureProcesses || []) if (!next.closureProcesses.some(n => evidenceHash(n) === evidenceHash(p))) fail('CLOSURE_HISTORY_MUTATION_FORBIDDEN', 409)
      for (const o of current.envelope.closureOperations || []) {
        const n = next.closureOperations.find(n => n.id === o.id)
        if (!n || evidenceHash({ ...n, phase: o.phase }) !== evidenceHash(o) || o.phase === 'COMMITTED' && n.phase !== 'COMMITTED') fail('CLOSURE_HISTORY_MUTATION_FORBIDDEN', 409)
      }
      const changed = next.closureOperations.filter(n => evidenceHash(n) !== evidenceHash(current.envelope.closureOperations?.find(o => o.id === n.id) || null))
      if (changed.length !== 1) fail('CLOSURE_INVALID_OPERATION_DELTA', 409)
      await createClosureAuthority(settings, fetchImpl).authorizeOrdinaryClosure({ documentId: id, dependency: changed[0].dependency,
        actorUserId: session.alfresco?.id, authorization: session.authorization, action: 'CLOSE_INTERVENTION', envelopeRevision: current.envelope.revision })
      if (!service?.username || !service.password) fail('CLOSURE_SERVICE_NOT_CONFIGURED')
      const authorization = 'Basic ' + Buffer.from(`${service.username}:${service.password}`).toString('base64')
      const me = await fetchImpl(`${settings.alfrescoTarget}/alfresco/api/-default-/public/alfresco/versions/1/people/-me-`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: authorization, Accept: 'application/json' } })
      const person = me.ok ? (await me.json()).entry : null
      if (person?.id !== service.username || person.enabled !== true || person.capabilities?.isAdmin !== false) fail('CLOSURE_TECHNICAL_IDENTITY_NOT_VERIFIED', 403)
      const technical = await getNode(id, authorization)
      if (technical.raw !== raw) fail('CLOSURE_EXTERNAL_MODIFICATION', 409)
      if (!technical.node.allowableOperations?.includes('update')) fail('CLOSURE_NODE_UPDATE_DENIED', 403)
      assertClosureWritesEnabled(settings)
      uncertain.set(id, serialized)
      try {
        const r = await fetchImpl(`${settings.alfrescoTarget}/alfresco/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(id)}`, {
          method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: { 'gd:asignaciones': serialized } }) })
        if (!r.ok) {
          if (r.status === 403) uncertain.delete(id)
          fail(r.status === 403 ? 'CLOSURE_NODE_UPDATE_DENIED' : 'CLOSURE_RESULT_UNCERTAIN', r.status === 403 ? 403 : 502)
        }
      } catch (e) { if (e.message === 'CLOSURE_NODE_UPDATE_DENIED') throw e; fail('CLOSURE_RESULT_UNCERTAIN', 502) }
      let after
      try { after = await read(id) } catch { fail('CLOSURE_RESULT_UNCERTAIN', 502) }
      if (after.raw !== serialized) fail('CLOSURE_RESULT_UNCERTAIN', 502)
      return after
    } })
  } }
  stores.add(root)
  return Object.freeze(root)
}
