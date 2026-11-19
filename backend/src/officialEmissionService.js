import { assertDescriptiveModel, descriptiveMetadata, emissionDate, verifyDescriptiveMetadata } from './emissionDescriptiveMetadata.js'
import fs from 'node:fs'
import { createAlfrescoNumberedIssuer, createInstitutionalEmissionReader } from './alfrescoNumbering.js'
import { decodeEmissionMetadata, encodeEmissionMetadata, assertEmissionModel } from './officialEmissionContract.js'
import { createDocumentQueue } from './documentQueue.js'
import { validatePilotEnvironment, acquirePilotLease } from './dispatchPilot.js'
import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { stableJson, sha256, validateReconciliation } from './emissionReconciliation.js'

const core = '/alfresco/api/-default-/public/alfresco/versions/1'
const fail = (code, status = 503) => Object.assign(new Error(code), { status })
export const officialEmissionAck = 'single-instance-exclusive-writer-official-emission-dev'

export function createOfficialEmissionService(settings, fetchImpl = (...args) => globalThis.fetch(...args), clock = () => new Date()) {
  const pilot = settings.officialEmission || {}
  let active = 0
  const uncertain = new Set()
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
      await payload.context.reader.verify(record)
      const node = (await payload.context.request(`/nodes/${encodeURIComponent(record.documentId)}?include=properties`, payload.context.authorization)).entry
      verifyDescriptiveMetadata(node, payload.context.descriptive)
      await payload.context.verifyContent(record)
    },
  })
  async function issue(session, input) {
    if (session?.authorizationStatus !== 'active' || session.functionalRole !== 'direccion' ||
        !session.capabilities?.includes('documents:write') || !session.capabilities?.includes('documents:read')) throw fail('OFFICIAL_DIRECTION_REQUIRED', 403)
    if (!pilot.writesEnabled) throw fail('OFFICIAL_EMISSION_WRITES_DISABLED')
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
    const canonical = { version: 1, actorId, code, title: input.title.trim(), description: input.description.trim(),
      documentType: input.documentType.trim(), documentPeriod: input.documentPeriod.trim(), priority: input.priority, recipientDependency, receiptCategory: category, pdfSha256: sha256(input.file) }
    const hash = sha256(stableJson(canonical))
    const name = `emission-${sha256(stableJson({ actorId, requestKey: input.requestKey }))}.pdf`
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
        // A single reference instant drives all temporal fields of a new issue.
        // Replays use their persisted cycle/date, never the current clock.
        const referenceTime = previous ? null : clock()
        const context = { actorId, code, folder, name, hash, authorization, request, reader, lookup,
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
        return { emittedEntry: entry, receivedEntry: entry, officialEmission: true, metadataWarnings: ['DOCUMENT_PRIORITY_NOT_PERSISTED', 'ACADEMIC_PERIOD_NOT_PERSISTED'] }
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
  return { issue, release: () => { if (!active && !uncertain.size) releaseLease() },
    status: () => ({ enabled: Boolean(pilot.writesEnabled), uncertain: uncertain.size, active }) }
}

export function hasInstitutionalRead(permissions, groupId) {
  if (!permissions || typeof permissions.isInheritanceEnabled !== 'boolean') return false
  const entries = [...(permissions.locallySet || []), ...(permissions.isInheritanceEnabled ? permissions.inherited || [] : [])].filter((p) => p.authorityId === groupId)
  return !entries.some((p) => p.accessStatus === 'DENIED') && entries.some((p) => p.accessStatus === 'ALLOWED' && ['Consumer', 'Contributor', 'Collaborator', 'Editor', 'Coordinator'].includes(p.name))
}
