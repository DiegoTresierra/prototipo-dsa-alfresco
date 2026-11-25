import { parseAssignments, maxAssignmentBytes } from './alfrescoDispatchRepository.js'
import { applyReviewEvent, reviewHash, proposalMetadataHash, verifyProposalPdf } from './responseReview.js'
import { revalidateInstitutionalIdentity, readInstitutionalGroups } from './institutionalIdentity.js'
import { resolveRole } from './roleResolver.js'
import { createResponseProposalReader } from './responseProposalReader.js'
import { decodeEmissionMetadata } from './officialEmissionContract.js'
import { officialEmissionName } from './officialEmissionService.js'
import { belongsToFolder } from './dispatchPilotScope.js'
import { canAttendSession, ownsAssignment, assignmentIsActive } from './attentionPolicy.js'
import { assertEnvelopeExtensionsPreserved } from './envelopeExtensions.js'
import { assertInterventionMutable } from './closedInterventionPolicy.js'

const core = '/alfresco/api/-default-/public/alfresco/versions/1'
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { status }) }
const e = encodeURIComponent
const operationMarker = (id) => `proposal-operation:${id}`

// Real REST contract, deliberately quarantined: mutations only against an injected
// fixture transport and a reserved .invalid host. No production flag or route.
export function createAlfrescoProposalAdapter(settings, { fetchImpl = globalThis.fetch, withDocument, simulationOnly = false, clock = () => new Date() } = {}) {
  const allowed = () => simulationOnly === true && fetchImpl !== globalThis.fetch && new URL(settings.alfrescoTarget).hostname.endsWith('.invalid')
  async function request(path, session, { method = 'GET', body, binary = false, missing = false } = {}) {
    if (method !== 'GET' && !allowed()) fail('PROPOSAL_WRITES_DISABLED', 503)
    const headers = { Authorization: session.authorization }
    if (body && !(body instanceof FormData) && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json'
    if (Buffer.isBuffer(body)) headers['Content-Type'] = 'application/pdf'
    const r = await fetchImpl(settings.alfrescoTarget + core + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers,
      ...(body ? { body: body instanceof FormData || Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}) })
    if (missing && r.status === 404) return null
    if (!r.ok) fail(r.status === 403 || r.status === 401 ? 'PROPOSAL_ACL_DENIED' : 'PROPOSAL_UPSTREAM_REJECTED', r.status === 403 || r.status === 401 ? 403 : 502)
    if (!binary) return r.json()
    const chunks = []; let length = 0
    for await (const chunk of r.body) {
      length += chunk.length
      if (length > 25 * 1024 * 1024) fail('PROPOSAL_SIZE_LIMIT', 413)
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
  async function node(id, session) { return (await request(`/nodes/${e(id)}?include=properties,allowableOperations`, session)).entry }
  async function entries(path, session) {
    let skip = 0; const all = []
    for (;;) {
      const { list } = await request(`${path}${path.includes('?') ? '&' : '?'}maxItems=100&skipCount=${skip}`, session)
      if (!Array.isArray(list?.entries) || list.pagination?.skipCount !== skip || typeof list.pagination.hasMoreItems !== 'boolean') fail('PROPOSAL_INVALID_LIST', 502)
      all.push(...list.entries.map((v) => v.entry)); skip += list.entries.length
      if (skip > 10000 || list.pagination.hasMoreItems && !list.entries.length) fail('PROPOSAL_INVALID_LIST', 502)
      if (!list.pagination.hasMoreItems) return all
    }
  }
  async function readOriginal(id, session) {
    const n = await node(id, session)
    if (n.id !== id || n.nodeType !== 'cm:content' || !n.isFile || n.content?.mimeType !== 'application/pdf' || !n.allowableOperations?.includes('update')) fail('PROPOSAL_ORIGINAL_FORBIDDEN', 403)
    const envelope = parseAssignments(n.properties?.['gd:asignaciones'], id)
    assertInterventionMutable(envelope, String(session.dependency).toLowerCase())
    return { node: n, raw: n.properties?.['gd:asignaciones'], envelope }
  }
  async function save(id, envelope, raw, session) {
    const serialized = JSON.stringify(envelope)
    if (Buffer.byteLength(serialized) > maxAssignmentBytes) fail('PROPOSAL_ENVELOPE_SIZE_LIMIT', 413)
    parseAssignments(serialized, id)
    const current = await readOriginal(id, session)
    if (current.raw !== raw) fail('PROPOSAL_EXTERNAL_MODIFICATION')
    assertEnvelopeExtensionsPreserved(current.envelope, envelope)
    await request(`/nodes/${e(id)}`, session, { method: 'PUT', body: {
      aspectNames: [...new Set([...(current.node.aspectNames || []), 'gd:tramite'])], properties: { 'gd:asignaciones': serialized },
    } })
    const after = await readOriginal(id, session)
    if (after.raw !== serialized) fail('PROPOSAL_RESULT_UNCERTAIN', 502)
    return after
  }
  async function versions(id, session) { return entries(`/nodes/${e(id)}/versions`, session) }
  async function verifyPdf(n, session, expected, metadataHash) {
    if (!n?.id || !n.isFile || n.nodeType !== 'cm:content' || n.content?.mimeType !== 'application/pdf' || !n.aspectNames?.includes('cm:versionable') ||
        !/^[0-9]+\.[0-9]+$/.test(n.properties?.['cm:versionLabel']) || proposalMetadataHash(n) !== metadataHash) fail('PROPOSAL_EXTERNAL_MODIFICATION')
    const id = n.properties['cm:versionLabel']
    const { entry: historical } = await request(`/nodes/${e(n.id)}/versions/${e(id)}?include=properties`, session)
    if (historical?.id !== id || !historical.properties || proposalMetadataHash(historical) !== metadataHash) fail('PROPOSAL_VERSION_METADATA_REQUIRED')
    verifyProposalPdf(await request(`/nodes/${e(n.id)}/content`, session, { binary: true }), expected)
    verifyProposalPdf(await request(`/nodes/${e(n.id)}/versions/${e(id)}/content`, session, { binary: true }), expected)
    return { versionId: id, contentSha256: expected, metadataSha256: metadataHash }
  }
  async function linked(id, original, session) {
    return (await entries(`/nodes/${e(id)}/targets?where=(assocType='cm:references')&include=association`, session))
      .some((n) => n.id === original && n.association?.assocType === 'cm:references')
  }
  async function assertModel(session) {
    const models = {}
    for (const name of ['cm_versionable', 'cm_referencing', 'gd_identificacion', 'gd_tramite']) {
      const r = await fetchImpl(settings.alfrescoTarget + '/alfresco/service/api/classes/' + name, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: session.authorization },
      })
      if (!r.ok) fail('PROPOSAL_MODEL_REQUIRED', 503)
      models[name] = await r.json()
    }
    if (models.cm_versionable.name !== 'cm:versionable' || models.cm_referencing.associations?.['cm:references']?.target?.class !== 'cm:content' ||
        models.gd_identificacion.properties?.['gd:dependenciaOrigen']?.dataType !== 'd:text' ||
        models.gd_tramite.properties?.['gd:asignaciones']?.dataType !== 'd:text') fail('PROPOSAL_MODEL_REQUIRED', 503)
  }
  async function scope(id, folders, session) {
    return belongsToFolder(id, folders, session.authorization, (path, options = {}) => request(path.replace('/api/-default-/public/alfresco/versions/1', '') + (options.query || ''), session))
  }

  async function execute(input, session, { reconcile = false } = {}) {
    if (!allowed() || !withDocument) fail('PROPOSAL_WRITES_DISABLED', 503)
    const permitted = ['action', 'documentId', 'processId', 'assignmentId', 'requestKey', 'expectedRevision', 'file', 'title', 'description']
    if (!input || Object.keys(input).some((k) => !permitted.includes(k)) || !['CREATE', 'REVISE'].includes(input.action) ||
        ![input.documentId, input.requestKey].every((v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,250}$/.test(v)) ||
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !Buffer.isBuffer(input.file) ||
        input.file.length > 25 * 1024 * 1024 || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 250 ||
        typeof input.description !== 'string' || input.description.length > 4000) fail('PROPOSAL_INVALID_INPUT', 422)
    if (input.action === 'CREATE' && input.processId != null || input.action === 'REVISE' && (typeof input.processId !== 'string' || input.processId.length > 250)) fail('PROPOSAL_INVALID_INPUT', 422)
    verifyProposalPdf(input.file, reviewHash(input.file))
    return withDocument(input.documentId, async () => {
      const identity = await revalidateInstitutionalIdentity(settings, session, fetchImpl)
      if (!canAttendSession(session)) fail('PROPOSAL_AUTHOR_FORBIDDEN', 403)
      const actor = identity.person.id; const dependency = identity.dependency.toLowerCase()
      const role = identity.functionalRole
      await assertModel(session)
      let original = await readOriginal(input.documentId, session)
      const folders = Object.values(settings.officeInboxNodeIds?.[identity.dependency] || {})
      if (!folders.length || !await scope(input.documentId, folders, session)) fail('PROPOSAL_ORIGINAL_FORBIDDEN', 403)
      const folder = settings.proposalFolderNodeIds?.[identity.dependency]
      if (!folder || folders.includes(folder)) fail('PROPOSAL_DRAFT_FOLDER_REQUIRED', 503)
      const draftFolder = await node(folder, session)
      if (draftFolder.id !== folder || !draftFolder.isFolder || !draftFolder.allowableOperations?.includes('create')) fail('PROPOSAL_FOLDER_FORBIDDEN', 403)
      const id = reviewHash(JSON.stringify([input.documentId, actor, input.requestKey]))
      const payloadHash = reviewHash(JSON.stringify([input.action, input.processId || null, input.assignmentId || null, input.expectedRevision, actor, role, dependency, input.title, input.description, reviewHash(input.file)]))
      let op = original.envelope.reviewOperations?.find((o) => o.id === id)
      const newOperation = !op
      if (reconcile && !op) fail('PROPOSAL_OPERATION_NOT_FOUND', 404)
      if (op && op.payloadHash !== payloadHash) fail('PROPOSAL_IDEMPOTENCY_CONFLICT')
      if (op?.phase === 'UNCERTAIN' && !reconcile) fail('PROPOSAL_RECONCILIATION_REQUIRED')
      if ((original.envelope.reviewOperations || []).some((o) => o.id !== id && o.phase !== 'COMMITTED')) fail('PROPOSAL_RECONCILIATION_REQUIRED')
      let p = original.envelope.reviewProcesses?.find((p) => p.id === (op?.processId || input.processId))
      const recorded = p?.events.find((event) => event.actorUserId === actor && event.requestKey === input.requestKey)
      if (p && (p.authorUserId !== actor || p.authorRole !== role || p.dependency !== dependency)) fail('PROPOSAL_AUTHOR_FORBIDDEN', 403)
      if (p && input.assignmentId != null && input.assignmentId !== p.assignmentId) fail('PROPOSAL_ASSIGNMENT_FORBIDDEN', 403)
      const assignmentId = p?.assignmentId || input.assignmentId || null
      if (assignmentId) {
        const assignment = original.envelope.dispatches.flatMap((d) => d.recipients).find((a) => a.id === assignmentId)
        if (!assignment || !ownsAssignment(assignment, session) || !assignmentIsActive(assignment)) fail('PROPOSAL_ASSIGNMENT_FORBIDDEN', 403)
      } else if (role !== 'direccion') fail('PROPOSAL_ASSIGNMENT_FORBIDDEN', 403)
      if (!recorded && (input.action === 'REVISE' && (!p || !['BORRADOR', 'OBSERVADA'].includes(p.state) || p.revision !== input.expectedRevision) || input.action === 'CREATE' && (input.expectedRevision !== 0 || p))) fail('PROPOSAL_STALE_REVISION')
      const meta = { 'cm:title': input.title, 'cm:description': input.description, 'gd:dependenciaOrigen': dependency.toUpperCase() }
      const metadataHash = proposalMetadataHash({ properties: meta })
      let n
      if (!op) {
        if (input.action === 'REVISE') {
          n = await node(p.proposalDocumentId, session)
          if (!n.allowableOperations?.includes('update') || !await scope(n.id, [folder], session)) fail('PROPOSAL_UPDATE_FORBIDDEN', 403)
          if (!await linked(n.id, input.documentId, session)) fail('PROPOSAL_REFERENCE_REQUIRED')
          if (n.properties?.['cm:autoVersion'] !== true) fail('PROPOSAL_VERSIONING_REQUIRED')
          await verifyPdf(n, session, p.snapshot.contentSha256, p.snapshot.metadataSha256)
          if (n.properties['cm:versionLabel'] !== p.snapshot.versionId) fail('PROPOSAL_EXTERNAL_MODIFICATION')
          if (reviewHash(input.file) === p.snapshot.contentSha256 || metadataHash !== p.snapshot.metadataSha256) fail('PROPOSAL_CONTENT_ONLY_REVISION_REQUIRED', 422)
        }
        op = { schemaVersion: 1, id, requestKey: input.requestKey, actorUserId: actor, dependency, action: input.action,
          payloadHash, expectedRevision: input.expectedRevision, processId: p?.id || `proposal-${id}`, proposalDocumentId: p?.proposalDocumentId || null,
          previousVersionIds: p ? (await versions(p.proposalDocumentId, session)).map((v) => v.id) : [], phase: 'PREPARED', at: clock().toISOString(), snapshot: null }
        const envelope = { ...original.envelope, revision: original.envelope.revision + 1, reviewOperations: [...(original.envelope.reviewOperations || []), op] }
        // Reserve bounded headroom before creating any PDF; never truncate the envelope.
        if (Buffer.byteLength(JSON.stringify(envelope)) + 8192 > maxAssignmentBytes) fail('PROPOSAL_ENVELOPE_SIZE_LIMIT', 413)
        original = await save(input.documentId, envelope, original.raw, session)
      }
      const checkpoint = async (phase) => {
        op = { ...op, phase }
        original = await save(input.documentId, { ...original.envelope, revision: original.envelope.revision + 1,
          reviewOperations: original.envelope.reviewOperations.map((o) => o.id === id ? op : o) }, original.raw, session)
      }
      try {
        // Replay of an older committed operation verifies its historical receipt;
        // it must never overwrite or poison a newer legitimate revision.
        if (recorded && p.snapshot.versionId !== recorded.snapshot?.versionId) {
          n = await node(p.proposalDocumentId, session)
          await verifyPdf(n, session, p.snapshot.contentSha256, p.snapshot.metadataSha256)
          const { entry: historical } = await request(`/nodes/${e(n.id)}/versions/${e(recorded.snapshot.versionId)}?include=properties`, session)
          if (!historical?.properties || proposalMetadataHash(historical) !== recorded.snapshot.metadataSha256 || !await linked(n.id, input.documentId, session)) fail('PROPOSAL_RESULT_UNCERTAIN', 502)
          verifyProposalPdf(await request(`/nodes/${e(n.id)}/versions/${e(recorded.snapshot.versionId)}/content`, session, { binary: true }), recorded.snapshot.contentSha256)
          return p
        }
        if (input.action === 'CREATE') {
          const name = `proposal-${id}.pdf`
          const found = await request(`/nodes/${e(folder)}?relativePath=${e(name)}&include=properties,allowableOperations`, session, { missing: true })
          n = found?.entry
          if (!n) {
            if (!newOperation || reconcile || op.phase !== 'PREPARED') fail('PROPOSAL_RECONCILIATION_REQUIRED')
            const form = new FormData()
            form.set('filedata', new Blob([input.file], { type: 'application/pdf' }), name)
            form.set('name', name); form.set('nodeType', 'cm:content'); form.set('autoRename', 'false')
            form.set('aspectNames', JSON.stringify(['cm:titled', 'cm:versionable', 'cm:referencing', 'gd:identificacion']))
            form.set('cm:autoVersion', 'true'); form.set('cm:initialVersion', 'true'); form.set('cm:autoVersionOnUpdateProps', 'false')
            for (const [k, v] of Object.entries(meta)) form.set(k, v)
            await request(`/nodes/${e(folder)}/children`, session, { method: 'POST', body: form })
            n = (await request(`/nodes/${e(folder)}?relativePath=${e(name)}&include=properties,allowableOperations`, session)).entry
          }
          if (n.createdByUser?.id !== actor || n.name !== name || !await scope(n.id, [folder], session)) fail('PROPOSAL_EXTERNAL_MODIFICATION')
        } else {
          n = await node(op.proposalDocumentId, session)
          if (!n.allowableOperations?.includes('update') || !await scope(n.id, [folder], session)) fail('PROPOSAL_UPDATE_FORBIDDEN', 403)
          if (n.properties?.['cm:autoVersion'] !== true) fail('PROPOSAL_VERSIONING_REQUIRED')
          const currentVersions = await versions(n.id, session)
          if (currentVersions.map((v) => v.id).sort().join() === [...op.previousVersionIds].sort().join()) {
            if (!newOperation || reconcile || op.phase !== 'PREPARED') fail('PROPOSAL_RECONCILIATION_REQUIRED')
            await verifyPdf(n, session, p.snapshot.contentSha256, p.snapshot.metadataSha256)
            if (n.properties['cm:versionLabel'] !== p.snapshot.versionId) fail('PROPOSAL_EXTERNAL_MODIFICATION')
            await request(`/nodes/${e(n.id)}/content?majorVersion=false&versionComment=${e(operationMarker(id))}`, session, { method: 'PUT', body: input.file })
            n = await node(n.id, session)
          }
          const after = await versions(n.id, session)
          const added = after.filter((v) => !op.previousVersionIds.includes(v.id))
          if (added.length !== 1 || after.length !== op.previousVersionIds.length + 1 ||
              !op.previousVersionIds.every((v) => after.some((a) => a.id === v)) || added[0].id !== n.properties?.['cm:versionLabel'] ||
              added[0].description !== operationMarker(id)) fail('PROPOSAL_EXTERNAL_MODIFICATION')
          const prior = p.events.filter((event) => event.snapshot && op.previousVersionIds.includes(event.snapshot.versionId)).at(-1)?.snapshot
          if (!prior) fail('PROPOSAL_EXTERNAL_MODIFICATION')
          verifyProposalPdf(await request(`/nodes/${e(n.id)}/versions/${e(prior.versionId)}/content`, session, { binary: true }), prior.contentSha256)
        }
        op = { ...op, proposalDocumentId: n.id, snapshot: await verifyPdf(n, session, reviewHash(input.file), metadataHash) }
        if (recorded) {
          if (!p || recorded.snapshot?.versionId !== op.snapshot.versionId || recorded.snapshot?.contentSha256 !== op.snapshot.contentSha256 ||
              recorded.snapshot?.metadataSha256 !== op.snapshot.metadataSha256 || !await linked(n.id, input.documentId, session)) fail('PROPOSAL_RESULT_UNCERTAIN', 502)
          if (op.phase !== 'COMMITTED') await checkpoint('COMMITTED')
          return p
        }
        await checkpoint('PDF_VERIFIED')
        if (!await linked(n.id, input.documentId, session)) {
          if (!n.aspectNames?.includes('cm:referencing') || !n.allowableOperations?.includes('update')) fail('PROPOSAL_REFERENCE_FORBIDDEN', 403)
          try { await request(`/nodes/${e(n.id)}/targets`, session, { method: 'POST', body: { targetId: input.documentId, assocType: 'cm:references' } }) }
          catch (error) { if (!await linked(n.id, input.documentId, session)) throw error }
        }
        if (!await linked(n.id, input.documentId, session)) fail('PROPOSAL_RESULT_UNCERTAIN', 502)
        await checkpoint('RELATED')
        const base = p || { schemaVersion: 1, id: op.processId, originalDocumentId: input.documentId, proposalDocumentId: n.id,
          authorUserId: actor, authorRole: role, dependency, assignmentId, revision: 0, state: 'BORRADOR', snapshot: null, events: [], approval: null, emissionDocumentId: null }
        const next = applyReviewEvent(base, { id: `${id}-event`, requestKey: input.requestKey, action: input.action,
          actorUserId: actor, actorRole: role, dependency, at: op.at, expectedRevision: input.expectedRevision,
          snapshot: op.snapshot, reason: '', emissionDocumentId: null }, { verified: true })
        op = { ...op, phase: 'COMMITTED' }
        original = await save(input.documentId, { ...original.envelope, revision: original.envelope.revision + 1,
          reviewProcesses: [...(original.envelope.reviewProcesses || []).filter((v) => v.id !== next.id), next],
          reviewOperations: original.envelope.reviewOperations.map((o) => o.id === id ? op : o) }, original.raw, session)
        if (!await linked(n.id, input.documentId, session)) fail('PROPOSAL_RESULT_UNCERTAIN', 502)
        return original.envelope.reviewProcesses.find((v) => v.id === next.id)
      } catch (error) {
        // Best effort only: if journaling itself times out, PREPARED is already
        // durable and reconciliation must inspect repository state before retry.
        try {
          original = await readOriginal(input.documentId, session)
          if (original.envelope.reviewOperations.find((o) => o.id === id)?.phase !== 'COMMITTED') await checkpoint('UNCERTAIN')
        } catch { /* never erase the original outcome */ }
        throw Object.assign(new Error('PROPOSAL_RECONCILIATION_REQUIRED'), { status: 409, cause: error })
      }
    })
  }
  // Internal capability only. No HTTP endpoint receives this callback or context.
  async function reviewTransaction(documentId, session, operation) {
    if (!allowed() || !withDocument) fail('PROPOSAL_WRITES_DISABLED', 503)
    return withDocument(documentId, async () => {
      const identity = await revalidateInstitutionalIdentity(settings, session, fetchImpl)
      if (!canAttendSession(session)) fail('REVIEW_AUTHORITY_REQUIRED', 403)
      const original = await readOriginal(documentId, session)
      const folders = Object.values(settings.officeInboxNodeIds?.[identity.dependency] || {})
      if (!folders.length || !await scope(documentId, folders, session)) fail('PROPOSAL_ORIGINAL_FORBIDDEN', 403)
      return operation({ identity, original,
        revalidate: () => revalidateInstitutionalIdentity(settings, session, fetchImpl),
        validate(envelope) {
          const serialized = JSON.stringify(envelope)
          if (Buffer.byteLength(serialized) > maxAssignmentBytes) fail('PROPOSAL_ENVELOPE_SIZE_LIMIT', 413)
          parseAssignments(serialized, documentId)
        },
        async person(userId) {
          const { entry } = await request(`/people/${e(userId)}`, session)
          if (entry?.id !== userId || entry.enabled !== true) fail('REVIEW_REVIEWER_NOT_VERIFIED', 403)
          const groups = await readInstitutionalGroups(settings.alfrescoTarget, userId, session.authorization, fetchImpl)
          const resolved = resolveRole(groups, settings.groupMappings, userId)
          if (resolved.authorizationStatus !== 'active') fail('REVIEW_REVIEWER_NOT_VERIFIED', 403)
          return { userId, functionalRole: resolved.functionalRole, dependency: resolved.dependency.toLowerCase(), groups }
        },
        async verify(process, snapshot = process.snapshot) {
          const reader = createResponseProposalReader(settings, fetchImpl)
          await reader.content(documentId, process.id, snapshot.versionId, session)
          verifyProposalPdf(await request(`/nodes/${e(process.proposalDocumentId)}/content`, session, { binary: true }), process.snapshot.contentSha256)
        },
        async approvedContent(process) {
          const bytes = await createResponseProposalReader(settings, fetchImpl).content(documentId, process.id, process.snapshot.versionId, session)
          const n = await node(process.proposalDocumentId, session)
          if (proposalMetadataHash(n) !== process.snapshot.metadataSha256) fail('PROPOSAL_EXTERNAL_MODIFICATION')
          return { bytes, properties: n.properties }
        },
        async findOfficial(requestKey) {
          const folder = settings.officeInboxNodeIds?.[identity.dependency]?.emitidos
          if (!folder) fail('OFFICIAL_EMITIDOS_CONFIGURATION_REQUIRED', 503)
          const result = await request(`/nodes/${e(folder)}?relativePath=${e(officialEmissionName(identity.person.id, requestKey))}&include=properties`, session, { missing: true })
          return result?.entry?.id || null
        },
        async officialReceipt(id, expected, { requireDelivery = true } = {}) {
          const n = await node(id, session)
          const record = decodeEmissionMetadata(n)
          const folder = settings.officeInboxNodeIds?.[identity.dependency]?.emitidos
          if (!folder || n.parentId !== folder || n.createdByUser?.id !== identity.person.id ||
              record.actorId !== identity.person.id || record.requestKey !== expected.requestKey || record.payloadHash !== expected.payloadHash || record.documentCode !== identity.dependency ||
              !await scope(id, [folder], session)) fail('REVIEW_OFFICIAL_IDENTITY_MISMATCH')
          verifyProposalPdf(await request(`/nodes/${e(id)}/content`, session, { binary: true }), expected.contentSha256)
          if (proposalMetadataHash(n) !== expected.metadataSha256) fail('REVIEW_OFFICIAL_METADATA_MISMATCH')
          // A partial identity receipt preserves UUID/number after creation,
          // but cannot certify delivery or be used to mark EMITIDA.
          if (!requireDelivery) return record
          const receivingFolder = settings.officeInboxNodeIds?.[expected.recipientDependency]?.[expected.receiptCategory === 'por-atender' ? 'porAtender' : 'porConocimiento']
          if (!receivingFolder || n.properties?.['gd:dependenciaDestino'] !== expected.recipientDependency) fail('REVIEW_OFFICIAL_DELIVERY_UNVERIFIED')
          // Actor ACL over the official node was checked above. Only membership
          // discovery uses the already configured non-admin distribution identity;
          // the source actor need not read the other Direction's entire inbox.
          const service = settings.distributionService
          if (!service?.username || !service.password || ['admin', 'administrator'].includes(service.username.toLowerCase())) fail('REVIEW_OFFICIAL_DELIVERY_UNVERIFIED')
          const discovery = { authorization: 'Basic ' + Buffer.from(`${service.username}:${service.password}`).toString('base64') }
          const { entry: me } = await request('/people/-me-', discovery)
          if (me?.id !== service.username || me.enabled !== true || me.capabilities?.isAdmin !== false || !await scope(id, [receivingFolder], discovery)) fail('REVIEW_OFFICIAL_DELIVERY_UNVERIFIED')
          return record
        },
        async referenceOfficial(id) {
          const n = await node(id, session)
          if (await linked(id, documentId, session)) return
          if (!n.allowableOperations?.includes('update')) fail('PROPOSAL_REFERENCE_FORBIDDEN', 403)
          if (!n.aspectNames?.includes('cm:referencing')) {
            await request(`/nodes/${e(id)}`, session, { method: 'PUT', body: { aspectNames: [...new Set([...(n.aspectNames || []), 'cm:referencing'])] } })
          }
          if (!await linked(id, documentId, session)) {
            try { await request(`/nodes/${e(id)}/targets`, session, { method: 'POST', body: { targetId: documentId, assocType: 'cm:references' } }) }
            catch (error) { if (!await linked(id, documentId, session)) throw error }
          }
          if (!await linked(id, documentId, session)) fail('PROPOSAL_RESULT_UNCERTAIN', 502)
        },
        save: (envelope, raw) => save(documentId, envelope, raw, session),
        read: () => readOriginal(documentId, session),
      })
    })
  }
  return { execute, reviewTransaction, reconcile: (input, session) => execute(input, session, { reconcile: true }) }
}
