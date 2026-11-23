import { assertDescriptiveModel, descriptiveMetadata, emissionDate, verifyDescriptiveMetadata } from './emissionDescriptiveMetadata.js'
import fs from 'node:fs'
import { createAlfrescoNumberedIssuer, createInstitutionalEmissionReader } from './alfrescoNumbering.js'
import { decodeEmissionMetadata, encodeEmissionMetadata, assertEmissionModel } from './officialEmissionContract.js'
import { createDocumentQueue } from './documentQueue.js'
import { validatePilotEnvironment, acquirePilotLease } from './dispatchPilot.js'
import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { stableJson, sha256, validateReconciliation } from './emissionReconciliation.js'
import { parseAssignments } from './alfrescoDispatchRepository.js'
import { assertInterventionMutable } from './closedInterventionPolicy.js'

const core = '/alfresco/api/-default-/public/alfresco/versions/1'
const fail = (code, status = 503) => Object.assign(new Error(code), { status })
export const officialEmissionAck = 'single-instance-exclusive-writer-official-emission-dev'
export const officialEmissionMetadataWarnings = Object.freeze(['DOCUMENT_PRIORITY_NOT_PERSISTED', 'ACADEMIC_PERIOD_NOT_PERSISTED'])
export const officialEmissionName = (actorId, requestKey) => `emission-${sha256(stableJson({ actorId, requestKey }))}.pdf`
export const reviewedEmissionKey = (originalId, processId, approvalEventId) => `review-${sha256(stableJson([originalId, processId, approvalEventId]))}`
export function officialEmissionPayload(actorId, code, input, review = null) {
  return { version: 1, actorId, code, title: input.title.trim(), description: input.description.trim(), documentType: input.documentType.trim(),
    documentPeriod: input.documentPeriod.trim(), priority: input.priority, recipientDependency: String(input.recipientDependency).toUpperCase(),
    receiptCategory: input.receiptCategory, pdfSha256: sha256(input.file), ...(review ? { review } : {}) }
}
export const officialEmissionPayloadHash = (actorId, code, input, review = null) => sha256(stableJson(officialEmissionPayload(actorId, code, input, review)))

export function createOfficialEmissionService(settings, fetchImpl = (...args) => globalThis.fetch(...args), clock = () => new Date()) {
  const pilot = settings.officialEmission || {}
  let active = 0
  const uncertain = new Set()
  // Runtime liveness only, never numbering/authorization truth. After restart,
  // unconfirmed journals are not considered active and block new allocations.
  const reviewRequests = new Map()
  let releaseLease = () => {}
  let exclusion = async () => false
  if (pilot.writesEnabled) {
    validatePilotEnvironment(settings)
    if (settings.dispatchPilot.environment !== 'dev' || pilot.expectedTarget !== settings.alfrescoTarget || pilot.acknowledgement !== officialEmissionAck) throw fail('OFFICIAL_ENVIRONMENT_CONFIRMATION_REQUIRED')
    if (pilot.reconciliationPath || pilot.reconciliationSha256) {
      let raw
      try { raw = fs.readFileSync(pilot.reconciliationPath) } catch { throw fail('OFFICIAL_RECONCILIATION_APPROVAL_REQUIRED') }
      if (sha256(raw) !== pilot.reconciliationSha256) throw fail('OFFICIAL_RECONCILIATION_APPROVAL_REQUIRED')
      exclusion = validateReconciliation(JSON.parse(raw), settings, async (id) => {
        const account = settings.distributionService
        const response = await fetchImpl(settings.alfrescoTarget + core + `/nodes/${encodeURIComponent(id)}/content`, {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Basic ${Buffer.from(`${account.username}:${account.password}`).toString('base64')}` },
        })
        if (!response.ok) throw fail('OFFICIAL_RECONCILIATION_CONTENT_REQUIRED')
        return Buffer.from(await response.arrayBuffer())
      })
    }
    releaseLease = acquirePilotLease({ ...settings, dispatchPersistence: 'alfresco', dispatchPilot: { ...settings.dispatchPilot, leasePath: pilot.leasePath } })
  }
  const withRequest = createDocumentQueue()
  // One issuer/queue shared by ALL sessions. Context is supplied in payload.
  const issuer = createAlfrescoNumberedIssuer({
    assertReady: async () => {}, // per-request model/ACL/preflight below, no activation bypass
    reconcile: async ({ payload, requestKey }) => {
      const { context } = payload
      const entry = await context.lookup()
      if (!entry) return { state: 'absent' }
      const record = decodeEmissionMetadata(entry)
      if (record.actorId !== context.actorId || record.requestKey !== requestKey || record.payloadHash !== context.hash || record.documentCode !== context.code) throw fail('NUMBERING_RETRY_CONFLICT', 409)
      return { state: 'completed', record }
    },
    list: (scope, payload) => payload.context.reader.list(scope),
    emit: async (allocation, payload) => {
      const c = payload.context
      await c.assertReview?.()
      uncertain.add(c.name)
      const properties = encodeEmissionMetadata({ ...allocation, actorId: c.actorId, payloadHash: c.hash })
      const form = new FormData()
      form.set('filedata', new Blob([payload.file], { type: 'application/pdf' }), c.name)
      form.set('name', c.name)
      form.set('nodeType', 'cm:content')
      form.set('aspectnames', JSON.stringify(['gd:identificacion', 'gd:clasificacion']))
      form.set('autoRename', 'false')
      form.set('overwrite', 'false')
      form.set('cm:title', payload.title)
      form.set('cm:description', payload.description)
      for (const [key, value] of Object.entries({ ...properties, ...c.descriptive })) form.set(key, String(value))
      let entry
      try { entry = (await c.request(`/nodes/${encodeURIComponent(c.folder)}/children?autoRename=false`, c.authorization, { method: 'POST', body: form })).entry }
      catch (error) {
        if (error.status !== 409) throw error
        entry = await c.lookup() // deterministic name dedup; never another name
      }
      const record = decodeEmissionMetadata(entry)
      if (record.actorId !== c.actorId || record.requestKey !== allocation.requestKey || record.payloadHash !== c.hash) throw fail('NUMBERING_RETRY_CONFLICT', 409)
      return record
    },
    finalize: async (record, payload) => payload.context.distribute(record),
    verify: async (record, payload) => {
      await payload.context.assertReview?.()
      await payload.context.reader.verify(record)
      const node = (await payload.context.request(`/nodes/${encodeURIComponent(record.documentId)}?include=properties`, payload.context.authorization)).entry
      verifyDescriptiveMetadata(node, payload.context.descriptive)
      await payload.context.verifyContent(record)
    },
  })
  async function issue(session, input, reviewed = null) {
    if (session?.authorizationStatus !== 'active' || session.functionalRole !== 'direccion' ||
        !session.capabilities?.includes('documents:write') || !session.capabilities?.includes('documents:read')) throw fail('OFFICIAL_DIRECTION_REQUIRED', 403)
    if (!pilot.writesEnabled) throw fail('OFFICIAL_EMISSION_WRITES_DISABLED')
    if (!reviewed && Object.keys(input).some((k) => /review|approv|proposal|originalDocument|responseDocument/i.test(k))) throw fail('OFFICIAL_REVIEW_SERVICE_REQUIRED', 403)
    if (Object.keys(input).some((k) => !['requestKey', 'title', 'description', 'documentType', 'documentPeriod', 'priority', 'recipientDependency', 'receiptCategory', 'file'].includes(k))) throw fail('OFFICIAL_INVALID_REQUEST', 400)
    const actorId = session.alfresco?.id
    if (!actorId || !session.authorization) throw fail('OFFICIAL_DIRECTION_REQUIRED', 403)
    if (!Buffer.isBuffer(input.file) || input.file.length < 5 || input.file.length > 20 * 1024 * 1024 || input.file.subarray(0, 5).toString() !== '%PDF-') throw fail('PDF_UPLOAD_REQUIRED', 400)
    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(input.requestKey || '') || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500 ||
        typeof input.description !== 'string' || input.description.length > 10000 || typeof input.documentType !== 'string' || !input.documentType.trim() || input.documentType.length > 100 ||
        typeof input.documentPeriod !== 'string' || !input.documentPeriod.trim() || input.documentPeriod.length > 40 || !['Normal', 'Alta', 'Urgente'].includes(input.priority)) throw fail('OFFICIAL_INVALID_REQUEST', 400)
    const authorization = session.authorization
    const service = settings.distributionService
    if (!service?.username || !service.password) throw fail('DISTRIBUTION_SERVICE_NOT_CONFIGURED')
    const serviceAuthorization = `Basic ${Buffer.from(`${service.username}:${service.password}`).toString('base64')}`
    const request = async (path, auth, options = {}) => {
      let result
      try { result = await fetchImpl(settings.alfrescoTarget + core + path, { method: 'GET', ...options,
        redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', Authorization: auth, ...options.headers } }) }
      catch { throw fail('OFFICIAL_UPSTREAM_UNCERTAIN', 502) }
      if (!result.ok) throw fail('OFFICIAL_ALFRESCO_REJECTED', result.status)
      try { return await result.json() } catch { throw fail('OFFICIAL_INVALID_RESPONSE', 502) }
    }
    const identity = await revalidateInstitutionalIdentity(settings, session, fetchImpl)
    const serviceMe = (await request('/people/-me-', serviceAuthorization)).entry
    if (serviceMe?.id !== service.username || serviceMe.enabled !== true || ['admin', 'administrator'].includes(service.username.toLowerCase())) throw fail('OFFICIAL_SERVICE_IDENTITY_REJECTED', 403)
    const dependency = String(session.dependency || '').toUpperCase()
    if (identity.authorizationStatus !== 'active' || identity.functionalRole !== 'direccion' || identity.dependency !== dependency || !['DTI', 'DSA'].includes(dependency)) throw fail('OFFICIAL_DIRECTION_REQUIRED', 403)
    // Direction's institution code is the verified institutional dependency.
    // Unit/person codes are NOT inferred or opened to unauthorized roles.
    const code = dependency
    const folder = settings.officeInboxNodeIds?.[dependency]?.emitidos
    const recipientDependency = String(input.recipientDependency || '').toUpperCase()
    const category = input.receiptCategory
    const recipientFolder = settings.officeInboxNodeIds?.[recipientDependency]?.[category === 'por-atender' ? 'porAtender' : 'porConocimiento']
    const recipientGroup = settings.officeGroupIds?.[recipientDependency]
    if (!folder || !['DTI', 'DSA'].includes(recipientDependency) || recipientDependency === dependency || !['por-atender', 'por-conocimiento'].includes(category) || !recipientFolder || !recipientGroup) throw fail('DIRECTOR_RECIPIENT_NOT_ALLOWED', 403)
    const canonical = officialEmissionPayload(actorId, code, input, reviewed?.binding)
    const hash = sha256(stableJson(canonical))
    const name = officialEmissionName(actorId, input.requestKey)
    return withRequest(name, async () => {
      active++
      try {
        const source = (await request(`/nodes/${encodeURIComponent(folder)}?include=allowableOperations`, authorization)).entry
        if (source?.id !== folder || source.isFolder !== true || !source.allowableOperations?.includes('create')) throw fail('OFFICIAL_EMITIDOS_CREATE_FORBIDDEN', 403)
        const target = (await request(`/nodes/${encodeURIComponent(recipientFolder)}?include=allowableOperations`, serviceAuthorization)).entry
        if (target?.id !== recipientFolder || !target.isFolder || !target.allowableOperations?.includes('create')) throw fail('DIRECTOR_MULTIFILING_PERMISSION_REQUIRED', 403)
        let model
        try {
          const result = await fetchImpl(settings.alfrescoTarget + '/alfresco/service/api/classes/gd_identificacion', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', Authorization: serviceAuthorization } })
          if (!result.ok) throw fail('OFFICIAL_MODEL_REQUIRED')
          model = await result.json()
        } catch { throw fail('OFFICIAL_MODEL_REQUIRED') }
        assertEmissionModel(model.properties)
        const classificationResponse = await fetchImpl(settings.alfrescoTarget + '/alfresco/service/api/classes/gd_clasificacion', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', Authorization: serviceAuthorization } })
        if (!classificationResponse.ok) throw fail('OFFICIAL_DESCRIPTIVE_MODEL_REQUIRED')
        assertDescriptiveModel(model, await classificationResponse.json())
        const reader = createInstitutionalEmissionReader({ folderId: folder, get: (path) => request(path, serviceAuthorization), modelProperties: model.properties,
          decode: async (node) => await exclusion(node) ? null : decodeEmissionMetadata(node) })
        const lookup = async () => {
          const matches = new Map()
          // Actor/key identity is global to institutional Emitidos, even if the
          // actor later changes dependency. Any failed GET blocks reconciliation.
          for (const dep of ['DTI', 'DSA']) {
            const root = settings.officeInboxNodeIds[dep].emitidos
            try {
              const entry = (await request(`/nodes/${encodeURIComponent(root)}?relativePath=${encodeURIComponent(name)}&include=properties`, serviceAuthorization)).entry
              if (!entry?.id) throw fail('OFFICIAL_INVALID_RESPONSE', 502)
              matches.set(entry.id, entry)
            } catch (error) { if (error.status !== 404) throw error }
          }
          if (matches.size > 1) throw fail('NUMBERING_RETRY_CONFLICT', 409)
          return [...matches.values()][0] || null
        }
        const existing = await lookup()
        let previous
        if (existing) {
          previous = decodeEmissionMetadata(existing)
          if (previous.actorId !== actorId || previous.requestKey !== input.requestKey || previous.payloadHash !== hash || previous.documentCode !== code) throw fail('NUMBERING_RETRY_CONFLICT', 409)
        }
        if (reviewed?.existingOnly && !existing) throw fail('OFFICIAL_RECONCILIATION_REQUIRED', 409)
        if (!existing) {
          // Direct GETs, never the search index. Unknown/partial coverage fails closed.
          const seen = new Set()
          for (const root of new Set(Object.values(settings.officeInboxNodeIds[dependency]))) {
            let skip = 0
            let total
            const rootSeen = new Set()
            for (;;) {
              const { list } = await request(`/nodes/${encodeURIComponent(root)}/children?include=association&maxItems=100&skipCount=${skip}`, serviceAuthorization)
              const page = list?.pagination
              if (!Array.isArray(list?.entries) || list.entries.length > 100 || typeof page?.hasMoreItems !== 'boolean' ||
                  page.skipCount !== skip || page.count !== list.entries.length || !Number.isSafeInteger(page.totalItems) || page.totalItems < 0 ||
                  total !== undefined && page.totalItems !== total) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED')
              total = page.totalItems
              for (const { entry } of list.entries) {
                if (!entry?.id || entry.association?.assocType !== 'cm:contains' || rootSeen.has(entry.id)) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED')
                rootSeen.add(entry.id)
                if (seen.has(entry.id)) continue
                seen.add(entry.id)
                if (seen.size > 10000) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED')
                const n = (await request(`/nodes/${encodeURIComponent(entry.id)}?include=properties`, serviceAuthorization)).entry
                if (n?.id !== entry.id) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED')
                if (!n.isFile) continue
                const envelope = parseAssignments(n.properties?.['gd:asignaciones'], n.id)
                if (reviewed?.binding.originalDocumentId === n.id) assertInterventionMutable(envelope, dependency.toLowerCase())
                for (const o of envelope.reviewOperations || []) {
                  if (o.phase === 'COMMITTED') continue
                  if (!reviewed) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED')
                  if (o.action !== 'EMIT') continue
                  const current = n.id === reviewed.binding.originalDocumentId && o.processId === reviewed.binding.processId && o.actorUserId === actorId
                  const p = envelope.reviewProcesses?.find((p) => p.id === o.processId)
                  const liveKey = `${o.actorUserId}:${reviewedEmissionKey(n.id, o.processId, p?.approval?.eventId)}`
                  if (!current && !(o.phase === 'PREPARED' && reviewRequests.has(liveKey))) throw fail('OFFICIAL_REVIEW_RECONCILIATION_REQUIRED', 409)
                }
                const snapshots = [...(envelope.reviewOperations || []).map((o) => o.snapshot), ...(envelope.reviewProcesses || []).flatMap((p) => [p.snapshot, ...p.events.map((e) => e.snapshot || e.review?.snapshot)])]
                if (!reviewed && snapshots.some((s) => s?.contentSha256 === canonical.pdfSha256)) throw fail('OFFICIAL_REVIEW_SERVICE_REQUIRED', 403)
                // A different hash is not evidence that an uploaded PDF is
                // unrelated: changing one byte cannot exempt it from review.
                // Existing emission retries were reconciled above and remain usable.
                if (!reviewed && (envelope.reviewProcesses?.length || envelope.reviewOperations?.length)) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED', 409)
              }
              skip += list.entries.length
              if (skip > total || page.hasMoreItems !== (skip < total)) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED')
              if (!list.pagination.hasMoreItems) break
              if (!list.entries.length || skip > 10000) throw fail('OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED')
            }
          }
        }
        if (reviewed && stableJson(await reviewed.authorize()) !== stableJson(reviewed.binding)) throw fail('OFFICIAL_APPROVAL_CHANGED', 409)
        // A single reference instant drives all temporal fields of a new issue.
        // Replays use their persisted cycle/date, never the current clock.
        const referenceTime = previous ? null : clock()
        const context = { actorId, code, folder, name, hash, authorization, request, reader, lookup,
          assertReview: reviewed ? async () => {
            if (stableJson(await reviewed.authorize()) !== stableJson(reviewed.binding)) throw fail('OFFICIAL_APPROVAL_CHANGED', 409)
          } : null,
          descriptive: descriptiveMetadata(canonical, previous ? existing.properties?.['gd:fechaDocumento'] : emissionDate(referenceTime)),
          verifyContent: async (record) => {
            let response
            try { response = await fetchImpl(settings.alfrescoTarget + core + `/nodes/${encodeURIComponent(record.documentId)}/content`, {
              method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: authorization },
            }) } catch { throw fail('OFFICIAL_CONTENT_VERIFICATION_FAILED', 502) }
            if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== canonical.pdfSha256) throw fail('OFFICIAL_CONTENT_VERIFICATION_FAILED', 502)
          },
          distribute: async (record) => {
            const actual = (await request(`/nodes/${encodeURIComponent(record.documentId)}?include=properties,permissions`, authorization)).entry
            if (actual?.id !== record.documentId || actual.parentId !== folder || actual.createdByUser?.id !== actorId) throw fail('OFFICIAL_CREATED_NODE_SCOPE_REJECTED', 403)
            if (!hasInstitutionalRead(actual.permissions, recipientGroup)) throw Object.assign(fail('OFFICIAL_RECIPIENT_NODE_READ_REQUIRED', 409), { emittedNodeId: record.documentId })
            const contains = async () => {
              let count = 0
              for (;;) {
                const list = (await request(`/nodes/${encodeURIComponent(recipientFolder)}/children?where=%28assocType%3D%27cm%3Acontains%27%29&include=association&maxItems=100&skipCount=${count}`, serviceAuthorization)).list
                if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') throw fail('OFFICIAL_INVALID_RESPONSE', 502)
                if (list.entries.some(({ entry }) => entry.id === record.documentId && entry.association?.assocType === 'cm:contains')) return true
                if (!list.pagination.hasMoreItems) return false
                if (!list.entries.length) throw fail('OFFICIAL_INVALID_RESPONSE', 502)
                count += list.entries.length
              }
            }
            if (!await contains()) {
              try { await request(`/nodes/${encodeURIComponent(recipientFolder)}/secondary-children`, serviceAuthorization, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ childId: record.documentId, assocType: 'cm:contains' }) }) }
              catch (error) { if (error.status !== 409) throw error }
            }
            if (!await contains()) throw fail('DIRECTOR_MULTIFILING_PARTIAL', 502)
          } }
        const payload = { ...canonical, file: input.file, context }
        // Replays retain their recorded cycle even across the January 2 boundary.
        const result = await issuer({ documentCode: code, requestKey: input.requestKey, payload,
          now: previous ? new Date(Date.UTC(previous.cycle, 6, 1)) : referenceTime })
        const entry = (await request(`/nodes/${encodeURIComponent(result.documentId)}?include=properties`, authorization)).entry
        uncertain.delete(name)
        return { emittedEntry: entry, receivedEntry: entry, officialEmission: true, metadataWarnings: [...officialEmissionMetadataWarnings] }
      } catch (error) {
        if (error.cause?.message === 'OFFICIAL_RECIPIENT_NODE_READ_REQUIRED') {
          error.message = error.cause.message
          error.emittedNodeId = error.cause.emittedNodeId
          error.status = 409
        }
        if (error.message === 'OFFICIAL_RECIPIENT_NODE_READ_REQUIRED') uncertain.add(name)
        if (uncertain.has(name) || error.message === 'NUMBERING_RESULT_UNCERTAIN') { error.uncertain = true; error.status = error.status === 409 ? 409 : 502 }
        throw error
      } finally { active-- }
    })
  }
  return { issue: (session, input) => issue(session, input),
    // Internal function capability, never a JSON flag or HTTP argument.
    issueReviewed: async (session, input, authorize, { existingOnly = false } = {}) => {
      if (typeof authorize !== 'function') throw fail('OFFICIAL_REVIEW_SERVICE_REQUIRED', 403)
      const key = `${session?.alfresco?.id}:${input.requestKey}`
      reviewRequests.set(key, (reviewRequests.get(key) || 0) + 1)
      try {
        const binding = await authorize()
        if (!binding || Object.keys(binding).sort().join(',') !== 'approvalEventId,contentSha256,metadataSha256,originalDocumentId,processId,proposalDocumentId,versionId' || binding.contentSha256 !== sha256(input.file) ||
            input.requestKey !== reviewedEmissionKey(binding.originalDocumentId, binding.processId, binding.approvalEventId)) throw fail('OFFICIAL_APPROVAL_CHANGED', 409)
        return await issue(session, input, { binding, authorize, existingOnly })
      } finally {
        const count = reviewRequests.get(key) - 1
        if (count) reviewRequests.set(key, count); else reviewRequests.delete(key)
      }
    }, release: () => { if (!active && !uncertain.size) releaseLease() },
    status: () => ({ enabled: Boolean(pilot.writesEnabled), uncertain: uncertain.size, active }) }
}

export function hasInstitutionalRead(permissions, groupId) {
  if (!permissions || typeof permissions.isInheritanceEnabled !== 'boolean') return false
  const entries = [...(permissions.locallySet || []), ...(permissions.isInheritanceEnabled ? permissions.inherited || [] : [])].filter((p) => p.authorityId === groupId)
  return !entries.some((p) => p.accessStatus === 'DENIED') && entries.some((p) => p.accessStatus === 'ALLOWED' && ['Consumer', 'Contributor', 'Collaborator', 'Editor', 'Coordinator'].includes(p.name))
}
