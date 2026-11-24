import { validateOrdinaryClosures, closureSourceHash } from './ordinaryClosureContract.js'

// Pure diagnostic, not an authorization or a retry policy. Envelope must be parsed already.
// NOT_EXECUTED requires positive, durable transport proof from a future trusted reader.
export function assessClosureRecovery({ envelope, intent, dispatchProof }) {
  const result = (state, reason) => ({ state, reason, mayAutomaticallyWrite: false, institutionalDecision: false })
  if (!intent || !envelope || intent.documentId !== envelope.documentId || !['dsa', 'dti'].includes(intent.dependency) ||
      !/^[a-f0-9]{64}$/.test(intent.operationId) || !/^[a-f0-9]{64}$/.test(intent.payloadHash) ||
      !/^[a-f0-9]{64}$/.test(intent.sourceHash) || !Number.isSafeInteger(intent.expectedEnvelopeRevision) || intent.expectedEnvelopeRevision < 0) {
    return result('CONFLICT', 'INVALID_RECOVERY_BINDING')
  }
  try { validateOrdinaryClosures(envelope) } catch { return result('CONFLICT', 'INVALID_CLOSURE_RECORDS') }
  const op = envelope.closureOperations?.find(o => o.id === intent.operationId)
  if (op) {
    if (op.executionMode !== 'ALFRESCO' || op.dependency !== intent.dependency || op.payloadHash !== intent.payloadHash ||
        op.sourceHash !== intent.sourceHash || op.expectedEnvelopeRevision !== intent.expectedEnvelopeRevision) return result('CONFLICT', 'OPERATION_IDENTITY_MISMATCH')
    if (op.phase === 'COMMITTED') return result('APPLIED', 'VERIFIED_COMMITTED_RECORD')
    if (closureSourceHash(envelope) !== intent.sourceHash || envelope.revision !== intent.expectedEnvelopeRevision + 1) return result('CONFLICT', 'SOURCE_CHANGED_AFTER_PREPARATION')
    return result('PENDING', 'VERIFIED_PREPARED_RECORD')
  }
  if (closureSourceHash(envelope) !== intent.sourceHash || envelope.revision !== intent.expectedEnvelopeRevision ||
      envelope.closureProcesses?.some(p => p.dependency === intent.dependency)) return result('CONFLICT', 'UNATTRIBUTED_DOCUMENT_CHANGE')
  if (dispatchProof?.schemaVersion === 1 && dispatchProof.source === 'durable-dispatch-journal' && dispatchProof.verified === true &&
      dispatchProof.state === 'NEVER_DISPATCHED' && dispatchProof.allPriorWritersStopped === true &&
      dispatchProof.documentId === intent.documentId && dispatchProof.operationId === intent.operationId && dispatchProof.payloadHash === intent.payloadHash &&
      typeof dispatchProof.reference === 'string' && dispatchProof.reference.trim()) return result('NOT_EXECUTED', 'POSITIVE_UNSENT_TRANSPORT_PROOF')
  return result('UNCERTAIN', 'ABSENCE_OF_RECORD_IS_NOT_PROOF')
}
