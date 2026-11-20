import { isClosureSimulationStore } from './closureSimulationStore.js'
import { createClosurePreflight } from './closurePreflight.js'
import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { evidenceHash } from './closureEvidenceContract.js'
import { closureOperationId, closureProcessId, closureIntentHash, closureSourceHash } from './ordinaryClosureContract.js'

const fail = (code, status = 409) => { throw Object.assign(new Error(code), { status }) }
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 250
const evaluationHash = r => { const { evaluatedAt, envelopeRevision, ...data } = r; return evidenceHash(data) }

export function createOrdinaryClosureEngine(settings, { store, fetchImpl, institutionalProvider, clock = () => new Date() } = {}) {
  if (!isClosureSimulationStore(store) || typeof fetchImpl !== 'function' || fetchImpl === globalThis.fetch ||
      !new URL(settings.alfrescoTarget).hostname.endsWith('.invalid')) fail('CLOSURE_REAL_WRITES_DISABLED', 503)
  const preflight = createClosurePreflight(settings, { fetchImpl, institutionalProvider, clock })
  async function execute(input, session, reconcile) {
    if (!input || Object.keys(input).sort().join(',') !== 'documentId,expectedEnvelopeRevision,reason,requestKey,scope' ||
        !text(input.documentId) || !/^[A-Za-z0-9-]+$/.test(input.documentId) || !text(input.requestKey) ||
        typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 ||
        !Number.isSafeInteger(input.expectedEnvelopeRevision) || input.expectedEnvelopeRevision < 0) fail('CLOSURE_INVALID_DECISION', 400)
    if (input.scope?.type !== 'dependency' || Object.keys(input.scope).sort().join(',') !== 'dependency,type' || !['dsa', 'dti'].includes(input.scope.dependency)) fail('CLOSURE_INTEGRAL_DISABLED', 403)
    const dependency = input.scope.dependency
    return store.withDocument(input.documentId, async () => {
      async function authorize(revision) {
        const identity = await revalidateInstitutionalIdentity(settings, session, fetchImpl)
        if (identity.functionalRole !== 'direccion' || identity.dependency.toLowerCase() !== dependency || !session.capabilities?.includes('documents:read')) fail('CLOSURE_DIRECTION_REQUIRED', 403)
        if (typeof institutionalProvider?.authorizeOrdinaryClosure !== 'function') fail('CLOSURE_INSTITUTIONAL_PROVIDER_PENDING', 503)
        const a = await institutionalProvider.authorizeOrdinaryClosure({ documentId: input.documentId, dependency, actorUserId: identity.person.id,
          action: 'CLOSE_INTERVENTION', envelopeRevision: revision, authorization: session.authorization })
        if (a?.verified !== true || a.source !== 'alfresco' || !text(a.reference) || a.documentId !== input.documentId ||
            a.dependency !== dependency || a.actorUserId !== identity.person.id || a.action !== 'CLOSE_INTERVENTION' || a.envelopeRevision !== revision ||
            !Array.isArray(a.groupIds) || !a.groupIds.length || !a.groupIds.every(g => identity.groups.includes(g))) fail('CLOSURE_AUTHORITY_NOT_VERIFIED', 403)
        return { userId: identity.person.id, functionalRole: 'direccion', dependency, reference: a.reference, groupIds: [...a.groupIds] }
      }
      let current = await store.read(input.documentId)
      let authority = await authorize(current.envelope.revision)
      const id = closureOperationId(input.documentId, authority.userId, input.requestKey)
      let op = current.envelope.closureOperations?.find(o => o.id === id)
      const intent = { documentId: input.documentId, dependency, actorUserId: authority.userId, requestKey: input.requestKey,
        reason: input.reason, expectedEnvelopeRevision: input.expectedEnvelopeRevision }
      if (op && op.payloadHash !== closureIntentHash(intent)) fail('CLOSURE_IDEMPOTENCY_CONFLICT')
      // Replays still revalidate ACL and institutional scope, not just possession of an operation key.
      let evaluated = await preflight({ documentId: input.documentId, scope: input.scope }, session)
      if (evaluated.envelopeRevision !== current.envelope.revision) fail('CLOSURE_STALE_EVALUATION')
      if (op?.phase === 'COMMITTED') {
        const process = current.envelope.closureProcesses.find(p => p.id === op.processId)
        return { process, repeated: true, simulationOnly: true, writesEnabled: false }
      }
      if (op && !reconcile) fail('CLOSURE_RECONCILIATION_REQUIRED')
      if (reconcile && !op) fail('CLOSURE_OPERATION_NOT_FOUND')
      if ((current.envelope.closureOperations || []).some(o => o.id !== id && o.phase !== 'COMMITTED')) fail('CLOSURE_RECONCILIATION_REQUIRED')
      if (current.envelope.closureProcesses?.some(p => p.dependency === dependency)) fail('CLOSURE_ALREADY_CLOSED')
      if (evaluated.preliminaryCompliance !== 'MET' || evaluated.blockingReasons.length || evaluated.knowledgeSummary.exclusivelyKnowledge) fail('CLOSURE_REQUIREMENTS_NOT_MET')
      if (!op && current.envelope.revision !== input.expectedEnvelopeRevision) fail('CLOSURE_STALE_REVISION')
      if (op && (current.envelope.revision !== op.expectedEnvelopeRevision + 1 || closureSourceHash(current.envelope) !== op.sourceHash || evaluationHash(evaluated) !== op.evaluationHash)) fail('CLOSURE_RECONCILIATION_CONFLICT')
      if (!op) {
        op = { schemaVersion: 1, executionMode: 'SIMULATED', id, processId: closureProcessId(input.documentId, dependency), ...intent, phase: 'PREPARED', at: clock().toISOString(),
          payloadHash: closureIntentHash(intent), sourceHash: closureSourceHash(current.envelope), evaluationHash: evaluationHash(evaluated) }
        current = await store.save(input.documentId, { ...current.envelope, revision: current.envelope.revision + 1,
          closureProcesses: current.envelope.closureProcesses || [], closureOperations: [...(current.envelope.closureOperations || []), op] }, current.raw)
      }
      // Own journal changes are excluded from evidence hashes, never documentary changes.
      authority = await authorize(current.envelope.revision)
      evaluated = await preflight({ documentId: input.documentId, scope: input.scope }, session)
      const fresh = await store.read(input.documentId)
      if (fresh.raw !== current.raw || evaluated.envelopeRevision !== current.envelope.revision || closureSourceHash(fresh.envelope) !== op.sourceHash ||
          evaluated.preliminaryCompliance !== 'MET' || evaluated.blockingReasons.length || evaluationHash(evaluated) !== op.evaluationHash) fail('CLOSURE_STALE_EVALUATION')
      const process = { schemaVersion: 1, executionMode: 'SIMULATED', id: op.processId, documentId: input.documentId, dependency, state: 'CERRADA', authority,
        at: op.at, reason: op.reason, sourceEnvelopeRevision: op.expectedEnvelopeRevision, committedEnvelopeRevision: current.envelope.revision + 1,
        evidence: { sourceHash: op.sourceHash, evaluationHash: op.evaluationHash,
          assignmentIds: current.envelope.dispatches.flatMap(d => d.recipients).filter(a => a.dependency === dependency).map(a => a.id) },
        events: [{ id: `${id}-closed`, operationId: id, action: 'CLOSE_INTERVENTION', actorUserId: authority.userId, at: op.at, requestKey: op.requestKey, payloadHash: op.payloadHash }] }
      const next = { ...current.envelope, revision: current.envelope.revision + 1,
        closureProcesses: [...current.envelope.closureProcesses, process], closureOperations: current.envelope.closureOperations.map(o => o.id === id ? { ...o, phase: 'COMMITTED' } : o) }
      await store.save(input.documentId, next, current.raw)
      const verified = await store.read(input.documentId)
      if (verified.raw !== JSON.stringify(next)) fail('CLOSURE_RESULT_UNCERTAIN', 502)
      return { process: verified.envelope.closureProcesses.find(p => p.id === process.id), repeated: false, simulationOnly: true, writesEnabled: false }
    })
  }
  return { decide: (input, session) => execute(input, session, false), reconcile: (input, session) => execute(input, session, true) }
}
