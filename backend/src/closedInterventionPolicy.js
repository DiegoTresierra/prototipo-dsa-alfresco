import { validateOrdinaryClosures } from './ordinaryClosureContract.js'
export function assertInterventionMutable(envelope, dependency, { sharedDocument = false } = {}) {
  validateOrdinaryClosures(envelope)
  if ((envelope.closureOperations || []).some(o => o.executionMode === 'ALFRESCO' && o.phase !== 'COMMITTED' && (sharedDocument || o.dependency === dependency))) {
    throw Object.assign(new Error('DOCUMENT_INTERVENTION_CLOSURE_PENDING'), { status: 409 })
  }
  if ((envelope.closureProcesses || []).some(p => p.executionMode === 'ALFRESCO' && p.state === 'CERRADA' && (sharedDocument || p.dependency === dependency))) {
    throw Object.assign(new Error('DOCUMENT_INTERVENTION_CLOSED'), { status: 409 })
  }
}
