import { applyReviewEvent, reviewHash, validateReviewEmission } from './responseReview.js'
import { verifyCurrentApproval } from './responseReviewDecisions.js'
import { officialEmissionPayloadHash, reviewedEmissionKey, officialEmissionMetadataWarnings } from './officialEmissionService.js'
import { stableJson } from './emissionReconciliation.js'
import { maxAssignmentBytes } from './alfrescoDispatchRepository.js'

const fail = (code, status = 409) => { throw Object.assign(new Error(code), { status }) }
export function createApprovedResponseEmission({ alfrescoAdapter, officialEmitter, institutionalProvider, resolveEmissionOptions, clock = () => new Date() } = {}) {
  async function emit(input, session, { reconcile = false } = {}) {
    const keys = ['documentId', 'processId', 'requestKey', 'expectedRevision', 'expectedVersionId']
    if (!input || Object.keys(input).length !== keys.length || Object.keys(input).some((k) => !keys.includes(k)) ||
        ![input.documentId, input.processId, input.requestKey].every((v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,250}$/.test(v)) ||
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.expectedVersionId !== 'string' || input.expectedVersionId.length > 250 || !/^[0-9]+\.[0-9]+$/.test(input.expectedVersionId)) fail('REVIEW_EMISSION_INVALID_INPUT', 422)
    if (!alfrescoAdapter?.reviewTransaction || !officialEmitter?.issueReviewed) fail('PROPOSAL_WRITES_DISABLED', 503)
    return alfrescoAdapter.reviewTransaction(input.documentId, session, async (context) => {
      let stored = context.original
      let p = stored.envelope.reviewProcesses?.find((p) => p.id === input.processId)
      if (!p) fail('REVIEW_PROCESS_NOT_AVAILABLE', 403)
      const actor = context.identity.person.id
      const id = reviewHash(JSON.stringify([input.documentId, actor, input.requestKey]))
      let op = stored.envelope.reviewOperations?.find((o) => o.id === id)
      if (op && (op.action !== 'EMIT' || op.processId !== p.id)) fail('REVIEW_IDEMPOTENCY_CONFLICT')
      if ((stored.envelope.reviewOperations || []).some((o) => o.id !== id && o.phase !== 'COMMITTED')) fail('REVIEW_RECONCILIATION_REQUIRED')
      if ((stored.envelope.reviewOperations || []).some((o) => o.id !== id && o.action === 'EMIT' && o.processId === p.id)) fail('REVIEW_EMISSION_ALREADY_STARTED')
      if (op && op.phase !== 'COMMITTED' && !reconcile) fail('REVIEW_RECONCILIATION_REQUIRED')
      if (reconcile && !op) fail('REVIEW_OPERATION_NOT_FOUND', 404)
      if (input.expectedRevision !== (op?.expectedRevision ?? p.revision)) fail('REVIEW_STALE_REVISION')
      if (input.expectedVersionId !== p.snapshot.versionId) fail('REVIEW_STALE_VERSION')
      const binding = await verifyCurrentApproval(p, context, institutionalProvider)
      if (p.state === 'EMITIDA' && !op) fail('REVIEW_EMISSION_ALREADY_STARTED')
      const source = await context.approvedContent(p)
      const title = source.properties['cm:title']; const description = source.properties['cm:description'] || ''
      const documentType = source.properties['gd:tipoDocumental']
      if (typeof documentType !== 'string' || !documentType.trim()) fail('REVIEW_APPROVED_DOCUMENT_TYPE_REQUIRED', 503)
      if (typeof title !== 'string' || !title.trim() || title !== title.trim() || description !== description.trim() || documentType !== documentType.trim()) fail('REVIEW_APPROVED_METADATA_FORMAT_REQUIRED', 503)
      let options = op?.emissionOptions
      if (!options) {
        if (typeof resolveEmissionOptions !== 'function') fail('REVIEW_EMISSION_POLICY_REQUIRED', 503)
        options = await resolveEmissionOptions({ identity: context.identity, process: structuredClone(p), properties: { ...source.properties }, original: context.original.node })
      }
      if (!options || Object.keys(options).sort().join(',') !== 'documentPeriod,priority,receiptCategory,recipientDependency' ||
          typeof options.documentPeriod !== 'string' || !options.documentPeriod.trim() || options.documentPeriod.length > 40 ||
          !['Normal', 'Alta', 'Urgente'].includes(options.priority) || !['DTI', 'DSA'].includes(options.recipientDependency) || options.recipientDependency === context.identity.dependency ||
          !['por-atender', 'por-conocimiento'].includes(options.receiptCategory)) fail('REVIEW_EMISSION_POLICY_REQUIRED', 503)
      const officialKey = reviewedEmissionKey(input.documentId, p.id, p.approval.eventId)
      const payload = { requestKey: officialKey, title, description, documentType, ...options, file: source.bytes }
      const hash = officialEmissionPayloadHash(actor, context.identity.dependency, payload, binding)
      const payloadHash = reviewHash(stableJson([binding, hash, input.expectedRevision, input.expectedVersionId]))
      if (op && op.payloadHash !== payloadHash) fail('REVIEW_IDEMPOTENCY_CONFLICT')
      const expected = { requestKey: officialKey, payloadHash: hash, contentSha256: binding.contentSha256, metadataSha256: binding.metadataSha256,
        recipientDependency: options.recipientDependency, receiptCategory: options.receiptCategory }
      const receipt = async (documentId, options = {}) => {
        const r = { schemaVersion: 1, ...binding, record: await context.officialReceipt(documentId, expected, options) }
        validateReviewEmission(r)
        return r
      }
      const checkpoint = async (phase, emission = op.emission) => {
        op = { ...op, phase, emission }
        stored = await context.save({ ...stored.envelope, revision: stored.envelope.revision + 1,
          reviewOperations: stored.envelope.reviewOperations.map((o) => o.id === id ? op : o) }, stored.raw)
      }
      const authorize = async () => {
        context.identity = await context.revalidate()
        const fresh = await context.read()
        if (fresh.raw !== stored.raw) fail('PROPOSAL_EXTERNAL_MODIFICATION')
        const process = fresh.envelope.reviewProcesses.find((v) => v.id === p.id)
        const actual = await verifyCurrentApproval(process, context, institutionalProvider)
        if (stableJson(actual) !== stableJson(binding)) fail('REVIEW_APPROVAL_OUTDATED')
        return actual
      }
      if (!op) {
        op = { schemaVersion: 1, id, requestKey: input.requestKey, actorUserId: actor, dependency: p.dependency, action: 'EMIT', payloadHash,
          expectedRevision: p.revision, processId: p.id, proposalDocumentId: p.proposalDocumentId, previousVersionIds: [p.snapshot.versionId],
          phase: 'PREPARED', at: clock().toISOString(), snapshot: structuredClone(p.snapshot), emission: null, emissionOptions: structuredClone(options) }
        const next = { ...stored.envelope, revision: stored.envelope.revision + 1, reviewOperations: [...(stored.envelope.reviewOperations || []), op] }
        // Reserve room for receipt/event/link before starting the official issuer.
        context.validate(next)
        if (Buffer.byteLength(JSON.stringify(next)) + 8192 > maxAssignmentBytes) fail('PROPOSAL_ENVELOPE_SIZE_LIMIT', 413)
        stored = await context.save(next, stored.raw)
      }
      try {
        if (op.phase === 'COMMITTED') {
          if (p.state !== 'EMITIDA' || p.emissionDocumentId !== op.emission?.record.documentId) fail('REVIEW_RESULT_UNCERTAIN', 502)
          const verified = await receipt(p.emissionDocumentId)
          if (stableJson(verified) !== stableJson(op.emission)) fail('REVIEW_OFFICIAL_IDENTITY_MISMATCH')
          await context.referenceOfficial(p.emissionDocumentId)
          return { process: p, emission: verified, repeated: true, metadataWarnings: [...officialEmissionMetadataWarnings] }
        }
        const result = await officialEmitter.issueReviewed(session, payload, authorize, { existingOnly: Boolean(reconcile) })
        if (!result?.officialEmission || typeof result.emittedEntry?.id !== 'string' || result.receivedEntry?.id !== result.emittedEntry.id) fail('REVIEW_OFFICIAL_RESULT_INCOMPLETE', 502)
        const verified = await receipt(result.emittedEntry.id)
        if (op.emission && stableJson(verified) !== stableJson(op.emission)) fail('REVIEW_OFFICIAL_IDENTITY_MISMATCH')
        await checkpoint('EMISSION_FOUND', verified)
        await context.referenceOfficial(verified.record.documentId)
        await authorize()
        const previous = p.events.find((event) => event.action === 'EMIT' && event.requestKey === input.requestKey && event.actorUserId === actor)
        if (previous && stableJson(previous.emission) !== stableJson(verified)) fail('REVIEW_OFFICIAL_IDENTITY_MISMATCH')
        const next = previous ? p : applyReviewEvent(p, { id: `${id}-event`, requestKey: input.requestKey, action: 'EMIT', actorUserId: actor,
          actorRole: context.identity.functionalRole, dependency: p.dependency, at: op.at, expectedRevision: input.expectedRevision,
          snapshot: null, reason: '', emissionDocumentId: verified.record.documentId, emission: verified }, { verified: true, emissionVerified: true })
        const link = { documentId: verified.record.documentId, originalDocumentId: input.documentId, linkedAt: op.at, linkedByUserId: actor,
          emitterDependency: p.dependency, emittedByUserId: actor }
        const alreadyLinked = (stored.envelope.responses || []).some((v) => v.documentId === link.documentId)
        const envelope = { ...stored.envelope, revision: stored.envelope.revision + 1,
          reviewProcesses: stored.envelope.reviewProcesses.map((v) => v.id === p.id ? next : v),
          responses: alreadyLinked ? stored.envelope.responses : [...(stored.envelope.responses || []), link],
          history: alreadyLinked ? stored.envelope.history : [...stored.envelope.history, { id: `${id}-link`, action: 'DOCUMENT_RESPONSE_LINKED', at: op.at,
            actorUserId: actor, dispatchId: null, assignmentIds: [], requestKey: `review-link-${id}`, responseDocumentId: link.documentId }],
          reviewOperations: stored.envelope.reviewOperations.map((o) => o.id === id ? { ...op, phase: 'COMMITTED' } : o) }
        stored = await context.save(envelope, stored.raw)
        p = stored.envelope.reviewProcesses.find((v) => v.id === p.id)
        await context.verify(p)
        if (stableJson(await receipt(p.emissionDocumentId)) !== stableJson(verified)) fail('REVIEW_OFFICIAL_IDENTITY_MISMATCH')
        return { process: p, emission: verified, repeated: Boolean(previous), metadataWarnings: [...officialEmissionMetadataWarnings] }
      } catch (error) {
        try {
          stored = await context.read()
          const found = await context.findOfficial(officialKey)
          let evidence = op.emission
          if (found) {
            const observed = await receipt(found, { requireDelivery: false })
            // Preserve the first verified identity. An external change in UUID,
            // number or cycle must not rewrite our historical receipt on retry.
            if (!evidence) evidence = observed
          }
          await checkpoint('UNCERTAIN', evidence)
        } catch { /* PREPARED/EMISSION_FOUND still requires reconciliation, never a new key. */ }
        throw Object.assign(new Error('REVIEW_EMISSION_RESULT_UNCERTAIN'), { status: 502, cause: error,
          ...(op.emission ? { emittedNodeId: op.emission.record.documentId, number: op.emission.record.number, cycle: op.emission.record.cycle } : {}) })
      }
    })
  }
  return { emit, reconcile: (input, session) => emit(input, session, { reconcile: true }) }
}
