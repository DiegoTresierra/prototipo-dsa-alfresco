import { evidenceHash, validateClosureEvidence } from './closureEvidenceContract.js'
import { validateOrdinaryClosures } from './ordinaryClosureContract.js'

const owned = new Set(['schemaVersion', 'documentId', 'revision', 'dispatches', 'history', 'responses', 'reviewProcesses', 'reviewOperations'])
export function validateEnvelopeExtensions(envelope) {
  validateClosureEvidence(envelope)
  validateOrdinaryClosures(envelope)
}
// Documentary writers own only their established sections. Unknown extensions are opaque.
export function assertEnvelopeExtensionsPreserved(previous, next) {
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (!owned.has(key) && (Object.hasOwn(previous, key) !== Object.hasOwn(next, key) ||
        evidenceHash(previous[key]) !== evidenceHash(next[key]))) {
      throw Object.assign(new Error('DOCUMENT_EXTENSION_MODIFICATION_FORBIDDEN'), { status: 409 })
    }
  }
  validateEnvelopeExtensions(next)
}
