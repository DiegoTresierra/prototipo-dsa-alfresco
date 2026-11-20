import { applyReviewEvent } from './responseReview.js'

// No production enable flag exists. The REST adapter remains quarantined to
// fixture transports; the pure simulation engine also covers future decisions.
export function createResponseProposalOperations({ withDocument, simulationAdapter, alfrescoAdapter, decisionService, emissionService } = {}) {
  async function execute(process, event, authority) {
    if (!simulationAdapter || simulationAdapter.simulationOnly !== true || !withDocument) {
      throw Object.assign(new Error('PROPOSAL_WRITES_DISABLED'), { status: 503 })
    }
    return withDocument(process.originalDocumentId, async () => {
      const current = await simulationAdapter.read(process.id)
      const next = applyReviewEvent(current || process, event, authority)
      if (next === current) return current
      await simulationAdapter.save(next)
      const verified = await simulationAdapter.read(process.id)
      if (JSON.stringify(verified) !== JSON.stringify(next)) throw new Error('PROPOSAL_RESULT_UNCERTAIN')
      return verified
    })
  }
  const invoke = (action, input, session) => {
    if (!alfrescoAdapter) throw Object.assign(new Error('PROPOSAL_WRITES_DISABLED'), { status: 503 })
    return alfrescoAdapter.execute({ ...input, action }, session)
  }
  return { execute, create: (input, session) => invoke('CREATE', input, session), revise: (input, session) => invoke('REVISE', input, session),
    decide: (input, session) => {
      if (!decisionService) throw Object.assign(new Error('PROPOSAL_WRITES_DISABLED'), { status: 503 })
      return decisionService.decide(input, session)
    },
    reconcileDecision: (input, session) => {
      if (!decisionService) throw Object.assign(new Error('PROPOSAL_WRITES_DISABLED'), { status: 503 })
      return decisionService.reconcile(input, session)
    },
    emitApproved: (input, session) => {
      if (!emissionService) throw Object.assign(new Error('PROPOSAL_WRITES_DISABLED'), { status: 503 })
      return emissionService.emit(input, session)
    },
    reconcileEmission: (input, session) => {
      if (!emissionService) throw Object.assign(new Error('PROPOSAL_WRITES_DISABLED'), { status: 503 })
      return emissionService.reconcile(input, session)
    },
    reconcile: (input, session) => {
      if (!alfrescoAdapter) throw Object.assign(new Error('PROPOSAL_WRITES_DISABLED'), { status: 503 })
      return alfrescoAdapter.reconcile(input, session)
    } }
}
