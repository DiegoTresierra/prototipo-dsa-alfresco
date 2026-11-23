import { createClosureAuthority } from './closureAuthority.js'
import { createClosurePreflight } from './closurePreflight.js'
import { createAlfrescoClosureStore, assertClosureWritesEnabled } from './alfrescoClosureStore.js'
import { createAlfrescoOrdinaryClosureEngine } from './ordinaryClosureEngine.js'
export function installClosureRoutes(app, settings, { repository, requireSession, requireCsrf, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const provider = createClosureAuthority(settings, fetchImpl)
  const preflight = createClosurePreflight(settings, { fetchImpl, institutionalProvider: provider })
  const store = createAlfrescoClosureStore(settings, { withDocument: repository.withDocument, fetchImpl })
  const engine = createAlfrescoOrdinaryClosureEngine(settings, { store, fetchImpl, institutionalProvider: provider })
  const error = (response, e) => response.status(e.status || 503).json({ error: /^[A-Z_]+$/.test(e.message) ? e.message : 'CLOSURE_UNAVAILABLE', uncertain: e.message === 'CLOSURE_RESULT_UNCERTAIN' })
  app.get('/api/documents/closure', requireSession, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try {
      if (request.session.functionalRole !== 'direccion' || repository.kind !== 'alfresco') throw Object.assign(new Error('CLOSURE_DIRECTION_REQUIRED'), { status: 403 })
      if (Object.keys(request.query).join(',') !== 'documentId') throw Object.assign(new Error('CLOSURE_INVALID_REQUEST'), { status: 400 })
      const scope = { type: 'dependency', dependency: String(request.session.dependency).toLowerCase() }
      const evaluation = await preflight({ documentId: request.query.documentId, scope }, request.session)
      const current = await store.forSession(request.session).read(evaluation.documentId)
      if (current.envelope.revision !== evaluation.envelopeRevision) throw Object.assign(new Error('CLOSURE_STALE_EVALUATION'), { status: 409 })
      await provider.authorizeOrdinaryClosure({ documentId: evaluation.documentId, dependency: scope.dependency, actorUserId: request.session.alfresco.id,
        authorization: request.session.authorization, action: 'CLOSE_INTERVENTION', envelopeRevision: current.envelope.revision })
      let enabled = false
      try { assertClosureWritesEnabled(settings); enabled = true } catch { /* read-only evaluation */ }
      const closed = current.envelope.closureProcesses?.find(p => p.executionMode === 'ALFRESCO' && p.dependency === scope.dependency)
      const pending = current.envelope.closureOperations?.filter(o => o.phase !== 'COMMITTED') || []
      const own = pending.find(o => o.dependency === scope.dependency && o.actorUserId === request.session.alfresco.id)
      return response.json({ evaluation, writesEnabled: enabled, uncertain: store.hasUncertain(evaluation.documentId), closed: Boolean(closed), closedAt: closed?.at || null,
        canClose: enabled && !store.hasUncertain(evaluation.documentId) && !closed && !pending.length && evaluation.preliminaryCompliance === 'MET' && !evaluation.blockingReasons.length && !evaluation.knowledgeSummary.exclusivelyKnowledge,
        pendingOperation: own ? { requestKey: own.requestKey, reason: own.reason, expectedEnvelopeRevision: own.expectedEnvelopeRevision } : null })
    } catch (e) { return error(response, e) }
  })
  app.post(['/api/documents/closure', '/api/documents/closure/reconcile'], requireSession, requireCsrf, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try {
      assertClosureWritesEnabled(settings)
      if (repository.kind !== 'alfresco' || request.session.functionalRole !== 'direccion') throw Object.assign(new Error('CLOSURE_DIRECTION_REQUIRED'), { status: 403 })
      const body = request.body
      if (!body || Object.keys(body).sort().join(',') !== 'documentId,expectedEnvelopeRevision,reason,requestKey') throw Object.assign(new Error('CLOSURE_INVALID_REQUEST'), { status: 400 })
      const input = { ...body, scope: { type: 'dependency', dependency: String(request.session.dependency).toLowerCase() } }
      return response.json(await engine[request.path.endsWith('/reconcile') ? 'reconcile' : 'decide'](input, request.session))
    } catch (e) { return error(response, e) }
  })
}
