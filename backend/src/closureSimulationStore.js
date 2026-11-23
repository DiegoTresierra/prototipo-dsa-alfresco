import { parseAssignments, maxAssignmentBytes } from './alfrescoDispatchRepository.js'
import { validateClosureEvidence, evidenceHash } from './closureEvidenceContract.js'
import { validateOrdinaryClosures, closureSourceHash } from './ordinaryClosureContract.js'
const branded = new WeakSet()
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { status }) }
export const isClosureSimulationStore = store => branded.has(store)

// Memory only: no filesystem, fetch, REST writer or production enable flag.
export function createClosureSimulationStore({ nodes, withDocument, faults = {} }) {
  if (!(nodes instanceof Map) || typeof withDocument !== 'function') fail('CLOSURE_SIMULATION_SETUP_REQUIRED', 503)
  const memory = structuredClone(nodes)
  const node = id => { if (!memory.has(id)) fail('CLOSURE_SIMULATION_DOCUMENT_MISSING', 404); return structuredClone(memory.get(id)) }
  const store = {
    withDocument, node,
    snapshot: () => structuredClone(memory),
    replaceFixtureNode: n => memory.set(n.id, structuredClone(n)),
    async read(id) {
      const n = node(id), raw = n.properties?.['gd:asignaciones']
      const envelope = parseAssignments(raw, id)
      validateClosureEvidence(envelope); validateOrdinaryClosures(envelope)
      return { node: n, raw, envelope }
    },
    async save(id, next, expectedRaw) {
      const current = await store.read(id), raw = JSON.stringify(next)
      if (Buffer.byteLength(raw) > maxAssignmentBytes) fail('CLOSURE_ENVELOPE_SIZE_LIMIT', 413)
      if (current.raw !== expectedRaw || next.revision !== current.envelope.revision + 1) fail('CLOSURE_EXTERNAL_MODIFICATION')
      parseAssignments(raw, id); validateClosureEvidence(next); validateOrdinaryClosures(next)
      if (closureSourceHash(current.envelope) !== closureSourceHash(next)) fail('CLOSURE_DOCUMENTARY_MUTATION_FORBIDDEN')
      // All previous decisions and operations are immutable; only PREPARED -> COMMITTED may change.
      for (const p of current.envelope.closureProcesses || []) if (!next.closureProcesses.some(n => evidenceHash(n) === evidenceHash(p))) fail('CLOSURE_HISTORY_MUTATION_FORBIDDEN')
      for (const o of current.envelope.closureOperations || []) {
        const n = next.closureOperations.find(n => n.id === o.id)
        if (!n || evidenceHash({ ...n, phase: o.phase }) !== evidenceHash(o) || o.phase === 'COMMITTED' && n.phase !== 'COMMITTED') fail('CLOSURE_HISTORY_MUTATION_FORBIDDEN')
      }
      const n = current.node; n.properties['gd:asignaciones'] = raw; memory.set(id, n)
      if (faults.throwAfterPhase && next.closureOperations.at(-1)?.phase === faults.throwAfterPhase) {
        faults.throwAfterPhase = null; fail('CLOSURE_RESULT_UNCERTAIN', 502)
      }
      return store.read(id)
    },
  }
  branded.add(store)
  return Object.freeze(store)
}
