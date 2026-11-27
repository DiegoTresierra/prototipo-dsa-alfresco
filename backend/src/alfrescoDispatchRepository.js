import { randomUUID } from 'node:crypto'
import { buildAlfrescoUrl } from './alfrescoClient.js'
import { createDocumentQueue } from './documentQueue.js'
import { verifyPilotDocumentScope, verifyAttentionDocumentScope, belongsToFolder } from './dispatchPilotScope.js'
import { mapConcurrent } from './mapConcurrent.js'
import { assignmentIsActive, canAttendSession, canLinkResponse, ownsAssignment, attentionSummary } from './attentionPolicy.js'
import { documentIdentity } from './documentIdentity.js'
import { allowedRecipientRoles, dispatchRequestMatches, isDispatchUnitId } from './dispatchPolicy.js'
import { validateReviewProcesses, assertReviewResponseLink, reviewHash } from './responseReview.js'
import { decodeEmissionMetadata } from './officialEmissionContract.js'
import { listInstitutionalEmitted } from './emittedDocuments.js'
import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { validateProposalJournal } from './responseProposalJournal.js'
import { assertEnvelopeExtensionsPreserved, validateEnvelopeExtensions } from './envelopeExtensions.js'
import { assertInterventionMutable } from './closedInterventionPolicy.js'
import { createDeadlineSnapshot, isValidDeadlineSnapshot, withAssignmentDeadlines } from './assignmentDeadline.js'
import { responseTimesDefaults } from './responseTimesService.js'

export const assignmentProperty = 'gd:asignaciones'
export const responsibleProperty = 'gd:responsablesActuales'
export const dependencyProperty = 'gd:dependenciasResponsablesActuales'
export const maxAssignmentBytes = 256 * 1024 // Application limit; not a claimed repository limit.
const core = '/api/-default-/public/alfresco/versions/1'
const active = (assignment) => ['ASIGNADO', 'DESPACHADO'].includes(assignment.status)
const fail = (code, status = 503) => { throw Object.assign(new Error(code), { status }) }
const text = (value) => typeof value === 'string' && value.trim().length > 0
const date = (value) => text(value) && Number.isFinite(Date.parse(value))
const dependencies = ['dsa', 'dti']
const unitSnapshotMatches = (unit, unitId, dependency) =>
  unit?.id === unitId && unit.dependency === dependency && text(unit.name)
const sameProjection = (actual, expected) => actual === undefined && expected.length === 0 ||
  Array.isArray(actual) && JSON.stringify([...actual].sort()) === JSON.stringify(expected)

export function parseAssignments(raw, documentId) {
  if (raw === undefined) return { schemaVersion: 1, revision: 0, documentId, dispatches: [], history: [] }
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > maxAssignmentBytes) fail('DISPATCH_INVALID_ASSIGNMENTS')
  let value
  try { value = JSON.parse(raw) } catch { fail('DISPATCH_INVALID_ASSIGNMENTS') }
  if (value?.schemaVersion !== 1 || value.documentId !== documentId || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.dispatches) || !Array.isArray(value.history) || value.responses !== undefined && !Array.isArray(value.responses)) fail('DISPATCH_INVALID_ASSIGNMENTS')
  const ids = new Set()
  const keys = new Set()
  const assignments = new Map()
  for (const record of value.dispatches) {
    if (!record || typeof record !== 'object') fail('DISPATCH_INVALID_ASSIGNMENTS')
    const key = JSON.stringify([record.senderUserId, record.requestKey])
    if (!text(record.id) || ids.has(record.id) || keys.has(key) || record.documentId !== documentId ||
        !text(record.requestKey) || !text(record.senderUserId) || !dependencies.includes(record.senderDependency) ||
        !['direccion', 'jefe-unidad'].includes(record.senderRole) || !text(record.instruction) || record.instruction.length > 2000 ||
        !['Normal', 'Alta', 'Urgente'].includes(record.priority) || !date(record.createdAt) || record.status !== 'ASIGNADO' ||
        !Array.isArray(record.recipients) || !record.recipients.length ||
        (record.senderRole === 'direccion' ? record.originAssignmentId !== null : !text(record.originAssignmentId))) fail('DISPATCH_INVALID_ASSIGNMENTS')
    if (record.unitId !== undefined && (!isDispatchUnitId(record.unitId) || record.senderRole !== 'direccion')) {
      fail('DISPATCH_INVALID_ASSIGNMENTS')
    }
    ids.add(record.id)
    keys.add(key)
    const users = new Set()
    for (const recipient of record.recipients) {
      if (!recipient || typeof recipient !== 'object') fail('DISPATCH_INVALID_ASSIGNMENTS')
      if (!text(recipient.id) || assignments.has(recipient.id) || !text(recipient.userId) || users.has(recipient.userId) ||
          !['direccion', 'jefe-unidad', 'especialista'].includes(recipient.functionalRole) || recipient.dependency !== record.senderDependency ||
          record.senderRole === 'jefe-unidad' && recipient.functionalRole !== 'especialista' ||
          !['ASIGNADO', 'DESPACHADO', 'ATENDIDO', 'ANULADO'].includes(recipient.status) ||
          recipient.documentId !== documentId || recipient.dispatchId !== record.id || !date(recipient.createdAt) ||
          recipient.senderUserId !== record.senderUserId || recipient.senderRole !== record.senderRole ||
          recipient.senderDependency !== record.senderDependency || recipient.originAssignmentId !== record.originAssignmentId ||
          recipient.instruction !== record.instruction) fail('DISPATCH_INVALID_ASSIGNMENTS')
      if (recipient.unitId !== record.unitId ||
          record.unitId && !unitSnapshotMatches(recipient.unit, record.unitId, record.senderDependency)) {
        fail('DISPATCH_INVALID_ASSIGNMENTS')
      }
      if (recipient.deadlineSnapshot !== undefined && !isValidDeadlineSnapshot(recipient.deadlineSnapshot, record.priority)) fail('DISPATCH_INVALID_ASSIGNMENTS')
      users.add(recipient.userId)
      assignments.set(recipient.id, recipient)
      if (recipient.responses !== undefined && !Array.isArray(recipient.responses)) fail('DISPATCH_INVALID_ASSIGNMENTS')
      if (recipient.attendedAt !== undefined && (!date(recipient.attendedAt) || recipient.attendedByUserId !== recipient.userId || recipient.status !== 'ATENDIDO')) fail('DISPATCH_INVALID_ASSIGNMENTS')
      for (const response of recipient.responses || []) {
        if (!text(response.documentId) || response.documentId === documentId || response.originalDocumentId !== documentId ||
            response.linkedByUserId !== recipient.userId || !dependencies.includes(response.emitterDependency) ||
            !text(response.emittedByUserId) || !date(response.linkedAt)) fail('DISPATCH_INVALID_ASSIGNMENTS')
      }
    }
  }
  for (const record of value.dispatches) {
    if (!record.originAssignmentId) continue
    const origin = assignments.get(record.originAssignmentId)
    if (!origin || origin.userId !== record.senderUserId || origin.functionalRole !== 'jefe-unidad' ||
        origin.dependency !== record.senderDependency || origin.dispatchId === record.id ||
        Date.parse(origin.createdAt) > Date.parse(record.createdAt)) fail('DISPATCH_INVALID_ASSIGNMENTS')
  }
  const eventIds = new Set()
  const operationKeys = new Set()
  for (const response of value.responses || []) {
    if (!text(response.documentId) || response.documentId === documentId || response.originalDocumentId !== documentId ||
        !text(response.linkedByUserId) || response.emittedByUserId !== response.linkedByUserId ||
        !dependencies.includes(response.emitterDependency) || !date(response.linkedAt)) fail('DISPATCH_INVALID_ASSIGNMENTS')
  }
  for (const event of value.history) {
    if (!event || typeof event !== 'object') fail('DISPATCH_INVALID_ASSIGNMENTS')
    if (!text(event.id) || eventIds.has(event.id) || !text(event.actorUserId) || !date(event.at) ||
        !['DISPATCH_CREATED', 'ASSIGNMENT_ATTENDED', 'RESPONSE_LINKED', 'DOCUMENT_RESPONSE_LINKED'].includes(event.action) ||
        event.action !== 'DOCUMENT_RESPONSE_LINKED' && !ids.has(event.dispatchId) || !Array.isArray(event.assignmentIds) ||
        event.assignmentIds.some((id) => !assignments.has(id) || assignments.get(id).dispatchId !== event.dispatchId)) fail('DISPATCH_INVALID_ASSIGNMENTS')
    eventIds.add(event.id)
    if (event.action !== 'DISPATCH_CREATED') {
      const key = JSON.stringify([event.actorUserId, event.requestKey])
      if (operationKeys.has(key)) fail('DISPATCH_INVALID_ASSIGNMENTS')
      operationKeys.add(key)
    }
    if (event.action === 'DOCUMENT_RESPONSE_LINKED') {
      if (event.assignmentIds.length || !text(event.requestKey) || !value.responses?.some((response) => response.documentId === event.responseDocumentId && response.linkedByUserId === event.actorUserId && response.linkedAt === event.at)) fail('DISPATCH_INVALID_ASSIGNMENTS')
    } else if (event.action !== 'DISPATCH_CREATED') {
      const assignment = assignments.get(event.assignmentIds[0])
      if (event.assignmentIds.length !== 1 || !text(event.requestKey) || event.actorUserId !== assignment?.userId) fail('DISPATCH_INVALID_ASSIGNMENTS')
      if (event.action === 'ASSIGNMENT_ATTENDED' && (assignment.status !== 'ATENDIDO' || assignment.attendedAt !== event.at || assignment.attendedByUserId !== event.actorUserId)) fail('DISPATCH_INVALID_ASSIGNMENTS')
      if (event.action === 'RESPONSE_LINKED' && !assignment.responses?.some((response) => response.documentId === event.responseDocumentId && response.linkedAt === event.at)) fail('DISPATCH_INVALID_ASSIGNMENTS')
    }
  }
  // Every assignment must have a traceable creation event.
  for (const record of value.dispatches) {
    if (!value.history.some((event) => event.action === 'DISPATCH_CREATED' && event.dispatchId === record.id && event.actorUserId === record.senderUserId &&
      record.recipients.every((recipient) => event.assignmentIds.includes(recipient.id)))) fail('DISPATCH_INVALID_ASSIGNMENTS')
  }
  for (const response of value.responses || []) {
    if (!value.history.some((event) => event.action === 'DOCUMENT_RESPONSE_LINKED' && event.responseDocumentId === response.documentId && event.actorUserId === response.linkedByUserId && event.at === response.linkedAt)) fail('DISPATCH_INVALID_ASSIGNMENTS')
  }
  validateReviewProcesses(value.reviewProcesses, documentId, assignments)
  validateProposalJournal(value.reviewOperations, documentId)
  validateEnvelopeExtensions(value)
  return value
}

export function projections(envelope) {
  const recipients = envelope.dispatches.flatMap((record) => record.recipients).filter(active)
  return {
    [responsibleProperty]: [...new Set(recipients.map((recipient) => recipient.userId))].sort(),
    [dependencyProperty]: [...new Set(recipients.map((recipient) => recipient.dependency))].sort(),
  }
}

export function createAlfrescoDispatchRepository(settings, fetchImpl = (...args) => globalThis.fetch(...args), { readResponseTimes = responseTimesDefaults } = {}) {
  const withDocument = createDocumentQueue()
  const pilot = () => settings.dispatchPilot || {}
  const serviceAuthorization = () => {
    const service = settings.distributionService
    if (!service?.username || !service.password) fail('DISTRIBUTION_SERVICE_NOT_CONFIGURED')
    return `Basic ${Buffer.from(`${service.username}:${service.password}`).toString('base64')}`
  }
  async function request(path, { authorization = serviceAuthorization(), method = 'GET', body, query = '' } = {}) {
    let response
    try {
      const url = ['/service/api/classes/gd_tramite', '/service/api/classes/cm_referencing'].includes(path)
        ? `${settings.alfrescoTarget}/alfresco${path}` : buildAlfrescoUrl(settings.alfrescoTarget, path, query)
      response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json', Authorization: authorization, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch { fail(method === 'PUT' ? 'DISPATCH_WRITE_OUTCOME_UNKNOWN' : 'DISPATCH_ALFRESCO_UNAVAILABLE', 502) }
    if (!response.ok) {
      if (method === 'PUT') fail(response.status === 403 ? 'DISPATCH_NODE_UPDATE_DENIED' : 'DISPATCH_WRITE_OUTCOME_UNKNOWN', response.status === 403 ? 403 : 502)
      throw Object.assign(new Error(response.status === 403 ? 'DISPATCH_NODE_READ_DENIED' : 'DISPATCH_ALFRESCO_UNAVAILABLE'), {
        status: response.status === 403 ? 403 : 502, upstreamStatus: response.status,
      })
    }
    try { return await response.json() } catch { fail('DISPATCH_ALFRESCO_INVALID_RESPONSE', 502) }
  }
  async function assertModel() {
    const identity = (await request(`${core}/people/-me-`)).entry
    if (identity?.id !== settings.distributionService.username || identity.enabled !== true || identity.capabilities?.isAdmin !== false) fail('DISPATCH_WRITER_IDENTITY_INVALID')
    const definition = await request('/service/api/classes/gd_tramite')
    const properties = definition.properties
    for (const [name, multiple] of [[assignmentProperty, false], [responsibleProperty, true], [dependencyProperty, true]]) {
      const property = Array.isArray(properties) ? properties.find((item) => item.name === name) : properties?.[name]
      if (!property || property.dataType !== 'd:text' || property.multiValued !== multiple || property.protected === true ||
          property.mandatory === true || name === assignmentProperty && property.indexed !== false) fail('DISPATCH_ALFRESCO_MODEL_NOT_READY')
    }
  }
  async function read(documentId, authorization, verifyProjections = true) {
    const payload = await request(`${core}/nodes/${encodeURIComponent(documentId)}`, { authorization, query: '?include=properties,aspectNames,allowableOperations' })
    return decodeNode(payload.entry, documentId, verifyProjections)
  }
  function decodeNode(node, documentId, verifyProjections = true) {
    if (node?.id !== documentId || !node.isFile || node.content?.mimeType !== 'application/pdf') fail('DISPATCH_INVALID_DOCUMENT', 403)
    const raw = node.properties?.[assignmentProperty]
    if (raw !== undefined && !node.aspectNames?.includes('gd:tramite')) fail('DISPATCH_INVALID_ASSIGNMENTS')
    const envelope = parseAssignments(raw, documentId)
    if (raw !== undefined && verifyProjections && Object.entries(projections(envelope)).some(([name, expected]) =>
      !sameProjection(node.properties?.[name], expected))) fail('DISPATCH_ASSIGNMENTS_PROJECTION_MISMATCH', 409)
    return { node, raw, envelope }
  }
  function assertWriteEnabled() {
    if (!pilot().writesEnabled) fail('DISPATCH_ALFRESCO_WRITES_DISABLED')
  }
  async function createDispatch(input, session, { resolveDestination } = {}) {
    // Caller holds withDocument throughout business authorization and this R/M/W/verify.
    assertWriteEnabled()
    await assertModel()
    if (!session?.authorization || input.senderUserId !== (session.alfresco?.id || session.user?.id)) fail('SESSION_IDENTITY_REQUIRED', 403)
    if (input.senderRole !== session.functionalRole || input.senderDependency !== String(session.dependency).toLowerCase()) fail('DISPATCH_RECIPIENT_NOT_ALLOWED', 403)
    if (input.unitId !== undefined && (!isDispatchUnitId(input.unitId) || input.senderRole !== 'direccion' || typeof resolveDestination !== 'function')) {
      fail('DISPATCH_UNIT_NOT_ALLOWED', 403)
    }
    const actor = await read(input.documentId, session.authorization) // Actor ACL cannot be bypassed by the writer.
    await verifyPilotDocumentScope(settings, session, actor.node, request)
    const { node, envelope, raw } = await read(input.documentId)
    assertInterventionMutable(envelope, input.senderDependency)
    if (!node.allowableOperations?.includes('update')) fail('DISPATCH_NODE_UPDATE_DENIED', 403)
    const existing = envelope.dispatches.find((record) => record.senderUserId === input.senderUserId && record.requestKey === input.requestKey)
    if (existing) {
      if (!dispatchRequestMatches(existing, input)) fail('DISPATCH_REQUEST_CONFLICT', 409)
      return existing
    }
    if (input.senderRole === 'jefe-unidad') {
      const origin = envelope.dispatches.flatMap((record) => record.recipients).find((recipient) =>
        recipient.id === input.originAssignmentId && recipient.userId === input.senderUserId &&
        recipient.dependency === input.senderDependency && recipient.functionalRole === 'jefe-unidad' && active(recipient))
      if (!origin) fail('DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED', 403)
    }
    const getRecipients = async () => {
      const recipients = input.unitId ? await resolveDestination() : input.recipients
      if (!Array.isArray(recipients) || !recipients.length || recipients.some((recipient) =>
        !allowedRecipientRoles(session).includes(recipient.functionalRole) || recipient.dependency !== input.senderDependency)) {
        fail('DISPATCH_RECIPIENT_NOT_ALLOWED', 403)
      }
      if (input.unitId && (!Array.isArray(input.recipientUserIds) ||
          JSON.stringify(recipients.map((person) => person.id).sort()) !== JSON.stringify([...input.recipientUserIds].sort()) ||
          recipients.some((person) => !unitSnapshotMatches(person.unit, input.unitId, input.senderDependency)))) {
        fail('DISPATCH_UNIT_RECIPIENT_NOT_ALLOWED', 403)
      }
      return recipients
    }
    const recipients = await getRecipients()
    const responseTimeSettings = await readResponseTimes(String(input.senderDependency).toLowerCase())
    const id = randomUUID()
    const at = new Date().toISOString()
    const deadlineSnapshot = createDeadlineSnapshot({ priority: input.priority, startedAt: at, settings: responseTimeSettings })
    const record = {
      id, requestKey: input.requestKey, documentId: input.documentId, senderUserId: input.senderUserId,
      senderDependency: input.senderDependency, senderRole: input.senderRole, originAssignmentId: input.originAssignmentId || null,
      instruction: input.instruction, priority: input.priority, createdAt: at, status: 'ASIGNADO', assignmentCompletedAt: at,
      ...(input.unitId ? { unitId: input.unitId } : {}),
      recipients: recipients.map((recipient) => ({
        id: randomUUID(), dispatchId: id, documentId: input.documentId, userId: recipient.id,
        displayName: recipient.displayName || recipient.id, functionalRole: recipient.functionalRole, dependency: recipient.dependency,
        unit: recipient.unit || null, status: 'ASIGNADO', createdAt: at, assignedAt: at,
        deadlineSnapshot: { ...deadlineSnapshot },
        ...(input.unitId ? { unitId: input.unitId } : {}),
        senderUserId: input.senderUserId, senderRole: input.senderRole, senderDependency: input.senderDependency,
        instruction: input.instruction, originAssignmentId: input.originAssignmentId || null,
      })),
    }
    const next = { ...envelope, revision: envelope.revision + 1, dispatches: [...envelope.dispatches, record],
      history: [...envelope.history, { id: randomUUID(), action: 'DISPATCH_CREATED', at, actorUserId: input.senderUserId,
        dispatchId: id, assignmentIds: record.recipients.map((recipient) => recipient.id) }] }
    const destinationSnapshot = (people) => people.map(({ id, functionalRole, unit }) => [id, functionalRole, unit.id, unit.name, unit.code])
    await persistEnvelope(input.documentId, next, raw, input.unitId ? async () => {
      if (JSON.stringify(destinationSnapshot(await getRecipients())) !== JSON.stringify(destinationSnapshot(recipients))) {
        fail('DISPATCH_HIERARCHY_REVISION_CONFLICT', 409)
      }
    } : undefined)
    return record
  }
  async function persistEnvelope(documentId, next, raw, confirmDestination) {
    const serialized = JSON.stringify(next)
    if (Buffer.byteLength(serialized) > maxAssignmentBytes) fail('DISPATCH_ASSIGNMENTS_SIZE_LIMIT', 413)
    parseAssignments(serialized, documentId)
    if (confirmDestination) await confirmDestination()
    // Best-effort external-change detection, NOT compare-and-swap: a writer can still race after this GET.
    const current = await read(documentId)
    if (current.raw !== raw) fail('DISPATCH_EXTERNAL_MODIFICATION', 409)
    assertEnvelopeExtensionsPreserved(current.envelope, next)
    if (!current.node.allowableOperations?.includes('update')) fail('DISPATCH_NODE_UPDATE_DENIED', 403)
    const expected = { [assignmentProperty]: serialized, ...projections(next) }
    await request(`${core}/nodes/${encodeURIComponent(documentId)}`, { method: 'PUT', body: {
      ...(current.node.aspectNames?.includes('gd:tramite') ? {} : { aspectNames: [...(current.node.aspectNames || []), 'gd:tramite'] }), properties: expected,
    } })
    let verified
    try { verified = await read(documentId, undefined, false) } catch { fail('DISPATCH_WRITE_OUTCOME_UNKNOWN', 502) }
    if (!verified.node.aspectNames?.includes('gd:tramite') || verified.raw !== serialized ||
        Object.entries(projections(next)).some(([key, value]) => !sameProjection(verified.node.properties?.[key], value))) fail('DISPATCH_WRITE_VERIFICATION_FAILED', 409)
    return verified.envelope
  }
  async function documentRecords(documentId) {
    await assertModel()
    return (await read(documentId)).envelope.dispatches
  }
  async function prepareAttention(input, session) {
    assertWriteEnabled()
    if (!canAttendSession(session)) fail('ATTENTION_REQUIRED', 403)
    await assertModel()
    const actor = await read(input.documentId, session.authorization)
    await verifyAttentionDocumentScope(settings, session, actor.node, request)
    const stored = await read(input.documentId)
    assertInterventionMutable(stored.envelope, String(session.dependency).toLowerCase())
    if (!stored.node.allowableOperations?.includes('update')) fail('DISPATCH_NODE_UPDATE_DENIED', 403)
    const record = stored.envelope.dispatches.find((dispatch) => dispatch.recipients.some((recipient) => recipient.id === input.assignmentId))
    const assignment = record?.recipients.find((recipient) => recipient.id === input.assignmentId)
    if (!assignment || !ownsAssignment(assignment, session)) fail('ATTENTION_ASSIGNMENT_NOT_OWNED', 403)
    return { ...stored, record, assignment, actor: actor.node }
  }
  function previousOperation(value, input, session, action) {
    const event = value.envelope.history.find((entry) => entry.actorUserId === (session.alfresco?.id || session.user?.id) && entry.requestKey === input.requestKey)
    if (event && (event.action !== action || (event.assignmentIds[0] || null) !== (input.assignmentId || null) || (event.responseDocumentId || null) !== input.responseDocumentId)) fail('DISPATCH_REQUEST_CONFLICT', 409)
    return event
  }
  function attentionResult(value, envelope = value.envelope) {
    if (!value.record) return { dispatch: null, assignment: null, documentId: envelope.documentId, summary: attentionSummary(envelope) }
    const record = envelope.dispatches.find((entry) => entry.id === value.record.id)
    return { dispatch: { ...record, documentIdentity: documentIdentity(value.actor, settings) },
      assignment: record.recipients.find((recipient) => recipient.id === value.assignment.id), summary: attentionSummary(envelope) }
  }
  async function referenceTargets(responseId, authorization) {
    let skipCount = 0
    let more, total
    const ids = new Set()
    do {
      const payload = await request(`${core}/nodes/${encodeURIComponent(responseId)}/targets`, { authorization,
        query: `?where=${encodeURIComponent("(assocType='cm:references')")}&maxItems=100&skipCount=${skipCount}` })
      const list = payload?.list
      const p = list?.pagination
      if (!Array.isArray(list?.entries) || list.entries.length > 100 || typeof p?.hasMoreItems !== 'boolean' ||
          p.skipCount !== skipCount || p.count !== list.entries.length || !Number.isSafeInteger(p.totalItems) || p.totalItems < 0 ||
          total !== undefined && total !== p.totalItems) fail('RESPONSE_INVALID_ASSOCIATIONS', 502)
      total = p.totalItems
      for (const { entry } of list.entries) {
        if (!entry?.id || entry.association?.assocType !== 'cm:references') fail('RESPONSE_INVALID_ASSOCIATIONS', 502)
        ids.add(entry.id)
      }
      more = list.pagination.hasMoreItems
      skipCount += list.entries.length
      if (skipCount > total || more !== (skipCount < total) || skipCount > 10_000 || more && !list.entries.length) fail('RESPONSE_INVALID_ASSOCIATIONS', 502)
    } while (more)
    return [...ids]
  }
  async function referenceExists(responseId, originalId, authorization) {
    return (await referenceTargets(responseId, authorization)).includes(originalId)
  }
  async function validateResponse(input, session) {
    if (!canLinkResponse(session) || input.responseDocumentId === input.documentId || !input.responseDocumentId) fail('RESPONSE_EMISSION_NOT_ALLOWED', 403)
    const response = await read(input.responseDocumentId, session.authorization)
    const folder = settings.officeInboxNodeIds?.[String(session.dependency).toUpperCase()]?.emitidos
    if (response.node.nodeType !== 'cm:content' || response.node.createdByUser?.id !== (session.alfresco?.id || session.user?.id) || !folder ||
        !await belongsToFolder(response.node.id, [folder], session.authorization, request)) fail('RESPONSE_NOT_OWN_EMISSION', 403)
    const origin = response.node.properties?.['gd:dependenciaOrigen']
    if (origin && String(origin).toLowerCase() !== String(session.dependency).toLowerCase()) fail('RESPONSE_ORIGIN_CONFLICT', 409)
    let official
    try { official = decodeEmissionMetadata(response.node) } catch { fail('RESPONSE_OFFICIAL_DOCUMENT_REQUIRED', 409) }
    if (official.actorId !== response.node.createdByUser.id || !response.node.aspectNames?.includes('gd:identificacion') ||
        official.documentCode.split('-')[0] !== String(session.dependency).toUpperCase() ||
        !/^\d{4}-\d{2}-\d{2}$/.test(response.node.properties?.['gd:fechaDocumento'] || '')) fail('RESPONSE_OFFICIAL_DOCUMENT_REQUIRED', 409)
    let content
    try {
      content = await fetchImpl(buildAlfrescoUrl(settings.alfrescoTarget, `${core}/nodes/${encodeURIComponent(response.node.id)}/content`), {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: session.authorization } })
    } catch { fail('RESPONSE_CONTENT_UNVERIFIED', 502) }
    if (!content.ok) fail('RESPONSE_CONTENT_UNVERIFIED', content.status === 403 ? 403 : 502)
    const bytes = Buffer.from(await content.arrayBuffer())
    if (bytes.length < 5 || bytes.subarray(0, 5).toString() !== '%PDF-') fail('RESPONSE_CONTENT_UNVERIFIED', 409)
    return { node: response.node, contentSha256: reviewHash(bytes), fingerprint: reviewHash(JSON.stringify([official, response.node.properties['gd:fechaDocumento'], reviewHash(bytes)])) }
  }
  function assertResponseApproval(envelope, verified) {
    assertReviewResponseLink(envelope, verified.node.id)
    if (!envelope.reviewProcesses?.length) return // No universal approval for own official documents.
    const p = envelope.reviewProcesses.find(p => p.state === 'EMITIDA' && p.emissionDocumentId === verified.node.id)
    const receipt = p?.events.find(e => e.action === 'EMIT' && e.emission?.record.documentId === verified.node.id)?.emission
    if (receipt?.contentSha256 !== verified.contentSha256) fail('RESPONSE_APPROVED_CONTENT_CHANGED', 409)
  }
  async function ensureResponseReference(input, session, node) {
    if (await referenceExists(node.id, input.documentId, session.authorization)) return
    if (!node.allowableOperations?.includes('update')) fail('RESPONSE_UPDATE_DENIED', 403)
    const model = await request('/service/api/classes/cm_referencing')
    if (model.associations?.['cm:references']?.target?.class !== 'cm:content') fail('RESPONSE_REFERENCE_MODEL_REQUIRED')
    if (!node.aspectNames?.includes('cm:referencing')) {
      try {
        await request(`${core}/nodes/${encodeURIComponent(node.id)}`, { method: 'PUT', authorization: session.authorization,
          body: { aspectNames: [...(node.aspectNames || []), 'cm:referencing'] } })
      } catch (error) { if (error.status === 403) fail('RESPONSE_UPDATE_DENIED', 403); throw error }
    }
    // Existing generic Alfresco association; adds no permissions or document copies.
    try {
      await request(`${core}/nodes/${encodeURIComponent(node.id)}/targets`, { method: 'POST', authorization: session.authorization,
        body: { targetId: input.documentId, assocType: 'cm:references' } })
    } catch (error) {
      if (error.status === 403) fail('RESPONSE_REFERENCE_DENIED', 403)
      // A timeout or duplicate may already have created the association. Prove it by GET.
      if (!await referenceExists(node.id, input.documentId, session.authorization)) throw error
    }
    if (!await referenceExists(node.id, input.documentId, session.authorization)) fail('RESPONSE_LINK_PARTIAL', 502)
  }
  async function attendAssignment(input, session) {
    return withDocument(input.documentId, async () => {
      const value = await prepareAttention(input, session)
      if (previousOperation(value, input, session, 'ASSIGNMENT_ATTENDED')) return attentionResult(value)
      if (!assignmentIsActive(value.assignment)) fail('ASSIGNMENT_NOT_ACTIVE', 409)
      if (input.responseDocumentId) {
        const links = [...(value.envelope.responses || []), ...value.envelope.dispatches.flatMap((dispatch) => dispatch.recipients).flatMap((assignment) => assignment.responses || [])]
        if (!links.some((response) => response.documentId === input.responseDocumentId && response.linkedByUserId === value.assignment.userId)) fail('ATTENTION_RESPONSE_NOT_LINKED', 409)
        await read(input.responseDocumentId, session.authorization)
        if (!await referenceExists(input.responseDocumentId, input.documentId, session.authorization)) fail('ATTENTION_RESPONSE_NOT_LINKED', 409)
      }
      const next = structuredClone(value.envelope)
      const assignment = next.dispatches.flatMap((dispatch) => dispatch.recipients).find((entry) => entry.id === input.assignmentId)
      const at = new Date().toISOString()
      assignment.status = 'ATENDIDO'
      assignment.attendedAt = at
      assignment.attendedByUserId = session.alfresco?.id || session.user?.id
      next.revision++
      next.history.push({ id: randomUUID(), action: 'ASSIGNMENT_ATTENDED', at, actorUserId: assignment.userId,
        dispatchId: value.record.id, assignmentIds: [assignment.id], requestKey: input.requestKey,
        responseDocumentId: input.responseDocumentId, mode: input.responseDocumentId ? 'response' : 'direct' })
      await persistEnvelope(input.documentId, next, value.raw)
      return attentionResult(value, next)
    })
  }
  async function linkResponse(input, session) {
    if (!canLinkResponse(session)) fail('RESPONSE_EMISSION_NOT_ALLOWED', 403)
    if (!input.responseDocumentId || input.responseDocumentId === input.documentId) fail('INVALID_RESPONSE_DOCUMENT', 400)
    // Lock both UUIDs in stable order; never hold the same lock twice.
    const ids = [input.documentId, input.responseDocumentId].sort()
    return withDocument(ids[0], () => withDocument(ids[1], async () => {
      // An Emitidos user supplies the original UUID, never an assignment owner.
      // Resolve only an unambiguous own responsibility from Alfresco, including
      // the original assignment of an idempotent replay after explicit attendance.
      if (!input.assignmentId && session.functionalRole !== 'direccion') {
        const original = await read(input.documentId, session.authorization)
        const owned = original.envelope.dispatches.flatMap(d => d.recipients).filter(a => ownsAssignment(a, session))
        const replay = original.envelope.history.find(e => e.action === 'RESPONSE_LINKED' && e.actorUserId === session.alfresco.id && e.requestKey === input.requestKey)
        const candidates = replay ? owned.filter(a => replay.assignmentIds.includes(a.id)) : owned.filter(assignmentIsActive)
        if (candidates.length !== 1) fail(candidates.length ? 'RESPONSE_ASSIGNMENT_AMBIGUOUS' : 'ASSIGNMENT_NOT_OWNED', 403)
        input = { ...input, assignmentId: candidates[0].id }
      }
      let value
      if (input.assignmentId) value = await prepareAttention(input, session)
      else {
        assertWriteEnabled(); await assertModel()
        const actor = await read(input.documentId, session.authorization)
        await verifyPilotDocumentScope(settings, session, actor.node, request)
        value = { ...await read(input.documentId), actor: actor.node }
        if (!value.node.allowableOperations?.includes('update')) fail('DISPATCH_NODE_UPDATE_DENIED', 403)
      }
      const action = input.assignmentId ? 'RESPONSE_LINKED' : 'DOCUMENT_RESPONSE_LINKED'
      if (previousOperation(value, input, session, action)) {
        assertResponseApproval(value.envelope, await validateResponse(input, session))
        if (!await referenceExists(input.responseDocumentId, input.documentId, session.authorization)) fail('RESPONSE_LINK_PARTIAL', 409)
        return attentionResult(value)
      }
      if (value.assignment && !assignmentIsActive(value.assignment)) fail('ASSIGNMENT_NOT_ACTIVE', 409)
      assertReviewResponseLink(value.envelope, input.responseDocumentId)
      assertInterventionMutable(value.envelope, String(session.dependency).toLowerCase())
      const existing = [...(value.envelope.responses || []), ...value.envelope.dispatches.flatMap((dispatch) => dispatch.recipients).flatMap((assignment) => assignment.responses || [])]
      if (existing.some((response) => response.documentId === input.responseDocumentId)) fail('RESPONSE_ALREADY_LINKED', 409)
      const verified = await validateResponse(input, session)
      assertResponseApproval(value.envelope, verified)
      const response = verified.node
      const next = structuredClone(value.envelope)
      const assignment = input.assignmentId ? next.dispatches.flatMap((dispatch) => dispatch.recipients).find((entry) => entry.id === input.assignmentId) : null
      const at = new Date().toISOString()
      const owner = assignment || next
      owner.responses ||= []
      owner.responses.push({ documentId: response.id, originalDocumentId: input.documentId, linkedAt: at,
        linkedByUserId: session.alfresco?.id || session.user?.id, emitterDependency: String(session.dependency).toLowerCase(), emittedByUserId: response.createdByUser.id })
      next.revision++
      next.history.push({ id: randomUUID(), action, at, actorUserId: session.alfresco?.id || session.user?.id,
        dispatchId: value.record?.id || null, assignmentIds: assignment ? [assignment.id] : [], requestKey: input.requestKey, responseDocumentId: response.id })
      const serialized = JSON.stringify(next)
      if (Buffer.byteLength(serialized) > maxAssignmentBytes) fail('DISPATCH_ASSIGNMENTS_SIZE_LIMIT', 413)
      parseAssignments(serialized, input.documentId)
      await revalidateInstitutionalIdentity(settings, session, fetchImpl)
      await ensureResponseReference(input, session, response)
      try {
        await revalidateInstitutionalIdentity(settings, session, fetchImpl)
        if ((await validateResponse(input, session)).fingerprint !== verified.fingerprint) fail('RESPONSE_DOCUMENT_CHANGED', 409)
        await persistEnvelope(input.documentId, next, value.raw)
      } catch (error) {
        throw Object.assign(new Error('RESPONSE_LINK_PARTIAL'), { status: error.status || 502, responseDocumentId: response.id })
      }
      return attentionResult(value, next)
    }))
  }
  async function listResponseCandidates(session) {
    if (!canLinkResponse(session)) fail('RESPONSE_EMISSION_NOT_ALLOWED', 403)
    const snapshot = await listInstitutionalEmitted(settings, session, fetchImpl)
    if (snapshot.documentErrors.length) fail('RESPONSE_CANDIDATE_COVERAGE_INCOMPLETE', 503)
    const nodes = snapshot.documents.filter(n => n.createdByUser?.id === session.alfresco.id)
    const verified = []
    for (const node of new Map(nodes.map(n => [n.id, n])).values()) {
      try { verified.push((await validateResponse({ responseDocumentId: node.id }, session)).node) }
      catch (e) {
        if (['RESPONSE_OFFICIAL_DOCUMENT_REQUIRED', 'RESPONSE_ORIGIN_CONFLICT', 'RESPONSE_NOT_OWN_EMISSION'].includes(e.message)) continue
        throw e // unavailable content/ACL/paging must not masquerade as an empty official list
      }
    }
    return verified
  }
  async function relatedResponses(documentId, session) {
    const original = await read(documentId, session.authorization)
    const links = [...new Map([...(original.envelope.responses || []), ...original.envelope.dispatches.flatMap((dispatch) => dispatch.recipients)
      .flatMap((assignment) => assignment.responses || [])].map((response) => [response.documentId, response])).values()]
    const responses = await mapConcurrent(links, 4, async (link) => {
      try {
        const response = await read(link.documentId, session.authorization)
        const official = decodeEmissionMetadata(response.node)
        if (official.actorId !== link.emittedByUserId || official.documentCode.split('-')[0].toLowerCase() !== link.emitterDependency) throw new Error('RESPONSE_OFFICIAL_DOCUMENT_REQUIRED')
        const verified = await referenceExists(link.documentId, documentId, session.authorization)
        return { ...link, available: verified, ...(verified ? { node: response.node } : { error: 'RESPONSE_RELATION_NOT_VERIFIED' }) }
      } catch { return { ...link, available: false, error: 'RESPONSE_READ_UNAVAILABLE' } }
    })
    return { responses, summary: attentionSummary(original.envelope), documentIdentity: documentIdentity(original.node, settings) }
  }
  async function relatedOriginals(responseDocumentId, session, authorizeOriginal) {
    const source = await read(responseDocumentId, session.authorization)
    let official
    try { official = decodeEmissionMetadata(source.node) } catch { fail('RESPONSE_OFFICIAL_DOCUMENT_REQUIRED', 409) }
    if (official.actorId !== source.node.createdByUser?.id || !source.node.aspectNames?.includes('gd:identificacion')) fail('RESPONSE_OFFICIAL_DOCUMENT_REQUIRED', 409)
    const originals = [], documentErrors = [], seen = new Set()
    for (const id of await referenceTargets(responseDocumentId, session.authorization)) {
        const entry = { id }
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        try {
          if (!await authorizeOriginal?.(entry.id)) fail('DOCUMENT_READ_NOT_ALLOWED', 403)
          const target = await read(entry.id, session.authorization)
          const link = [...(target.envelope.responses || []), ...target.envelope.dispatches.flatMap(d => d.recipients).flatMap(a => a.responses || [])]
            .find(r => r.documentId === responseDocumentId && r.emittedByUserId === official.actorId && r.emitterDependency.toUpperCase() === official.documentCode.split('-')[0])
          if (!link) fail('RESPONSE_RELATION_NOT_VERIFIED', 409)
          originals.push({ ...link, relationType: 'response', direction: 'response-to-original', originalDocumentId: entry.id, node: target.node })
        } catch { documentErrors.push({ error: 'ORIGINAL_RESPONSE_RELATION_UNAVAILABLE' }) }
    }
    return { responseDocumentId, originals, documentErrors, complete: !documentErrors.length }
  }
  async function readSnapshot(session) {
    await assertModel()
    if (!session?.authorization) fail('SESSION_IDENTITY_REQUIRED', 403)
    const folders = [...new Set(Object.values(settings.officeInboxNodeIds || {}).flatMap((office) => Object.values(office)).filter(Boolean))]
    if (!folders.length) fail('DISPATCH_DISCOVERY_FOLDERS_REQUIRED')
    const ids = new Set()
    // Request-scoped only: these nodes are proven readable by THIS actor.
    const actorNodes = new Map()
    const institutionalMemberships = new Map()
    const discoveryErrors = []
    let scanned = 0
    await mapConcurrent(folders, 4, async (folder) => {
      try {
        let skip = 0
        let more
        let useServiceDiscovery = false
        do {
          let payload
          const options = { authorization: useServiceDiscovery ? serviceAuthorization() : session.authorization,
            query: `?include=properties,aspectNames,association&maxItems=100&skipCount=${skip}` }
          try { payload = await request(`${core}/nodes/${encodeURIComponent(folder)}/children`, options) } catch (error) {
            // Folder enumeration may be denied while individual documents remain readable.
            // Technical discovery is never an actor ACL proof; each such node needs actor GET.
            if (error.message !== 'DISPATCH_NODE_READ_DENIED' || useServiceDiscovery) throw error
            useServiceDiscovery = true
            payload = await request(`${core}/nodes/${encodeURIComponent(folder)}/children`, { ...options, authorization: serviceAuthorization() })
          }
          const list = payload.list
          if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') fail('DISPATCH_ALFRESCO_INVALID_RESPONSE', 502)
          for (const { entry } of list.entries) {
            if (entry?.isFile && entry.content?.mimeType === 'application/pdf' && entry.association?.assocType === 'cm:contains') {
              if (typeof entry.id !== 'string') fail('DISPATCH_ALFRESCO_INVALID_RESPONSE', 502)
              ids.add(entry.id)
              if (!institutionalMemberships.has(entry.id)) institutionalMemberships.set(entry.id, new Set())
              institutionalMemberships.get(entry.id).add(folder)
              if (!useServiceDiscovery && Object.hasOwn(entry, 'properties') && Array.isArray(entry.aspectNames)) {
                const previous = actorNodes.get(entry.id)
                if (!previous || !(Date.parse(previous.modifiedAt) > Date.parse(entry.modifiedAt))) actorNodes.set(entry.id, entry)
              }
            }
          }
          more = list.pagination.hasMoreItems
          skip += list.entries.length
          scanned += list.entries.length
          if (scanned > 10_000 || more && !list.entries.length) fail('DISPATCH_DISCOVERY_LIMIT_EXCEEDED')
        } while (more)
      } catch (error) {
        const ownFolders = Object.values(settings.officeInboxNodeIds?.[String(session.dependency).toUpperCase()] || {})
        if (ownFolders.includes(folder)) throw error
        discoveryErrors.push({ error: 'DISPATCH_DISCOVERY_PARTIAL', scope: 'other-dependency' })
      }
    })
    const batches = await mapConcurrent([...ids], 4, async (id) => {
      // Use actor credentials for authoritative reads: an assignment never bypasses Alfresco ACL.
      try {
        if (!actorNodes.has(id)) {
          const payload = await request(`${core}/nodes/${encodeURIComponent(id)}`, { authorization: session.authorization,
            query: '?include=properties,aspectNames,allowableOperations' })
          if (payload.entry?.id !== id) fail('DISPATCH_ALFRESCO_INVALID_RESPONSE', 502)
          actorNodes.set(id, payload.entry)
        }
        const value = decodeNode(actorNodes.get(id), id)
        actorNodes.set(id, value.node)
        return value.envelope.dispatches
      } catch (error) {
        if (error.message === 'DISPATCH_NODE_READ_DENIED' || error.upstreamStatus === 404) return []
        if (actorNodes.has(id)) {
          discoveryErrors.push({ documentId: id, error: 'DISPATCH_DOCUMENT_UNAVAILABLE' })
        } else {
          const diagnosticId = randomUUID()
          discoveryErrors.push({ error: 'DISPATCH_DISCOVERY_NODE_UNAVAILABLE', diagnosticId })
          if (settings.alfrescoDiagnostics) console.warn('[dispatch-discovery]', JSON.stringify({ diagnosticId,
            operation: 'actor-node-read', status: error.upstreamStatus || null, reason: 'READ_NOT_CONFIRMED' }))
        }
        return []
      }
    })
    return { institutionalMemberships, discoveryErrors, records: batches.flat().map((record) => ({ ...record, documentIdentity: documentIdentity(actorNodes.get(record.documentId), settings) })), actorNodes }
  }
  async function allRecords(session) {
    const snapshot = await readSnapshot(session)
    if (snapshot.discoveryErrors.length) fail('DISPATCH_DISCOVERY_PARTIAL', 503)
    return snapshot.records
  }
  const receivedRecords = (records, userId, role, dependency) => records.filter((record) => role === 'direccion'
    ? record.senderDependency === String(dependency).toLowerCase()
    : record.recipients.some((recipient) => recipient.userId === userId && recipient.functionalRole === role &&
        recipient.dependency === String(dependency).toLowerCase() && ['ASIGNADO', 'DESPACHADO', 'ATENDIDO'].includes(recipient.status)))
  const sentRecords = (records, userId, dependency) => records.filter((record) =>
    record.senderUserId === userId && record.senderDependency === String(dependency).toLowerCase())
  return {
    kind: 'alfresco', withDocument, createDispatch, assertModel, allRecords,
    attendAssignment, linkResponse, listResponseCandidates, relatedResponses, relatedOriginals,
    loadInbox: async (session) => {
      const snapshot = await readSnapshot(session)
      const userId = session.alfresco?.id || session.user?.id
      return { institutionalMemberships: snapshot.institutionalMemberships, discoveryErrors: snapshot.discoveryErrors,
        dispatches: receivedRecords(snapshot.records, userId, session.functionalRole, session.dependency).map(record => withAssignmentDeadlines(record)),
        sentDispatches: sentRecords(snapshot.records, userId, session.dependency).map(record => withAssignmentDeadlines(record)), actorNodes: snapshot.actorNodes }
    },
    findDispatch: async (userId, requestKey, documentId) => (await documentRecords(documentId)).find((record) => record.senderUserId === userId && record.requestKey === requestKey) || null,
    findAttentionAssignment: async (userId, documentId, dependency, assignmentId) => (await documentRecords(documentId))
      .flatMap((record) => record.recipients).find((recipient) => recipient.id === assignmentId && recipient.userId === userId &&
        recipient.functionalRole === 'jefe-unidad' && recipient.dependency === String(dependency).toLowerCase() && active(recipient)) || null,
    listDispatchesForUser: async (userId, role, dependency, session) => receivedRecords(await allRecords(session), userId, role, dependency),
    listSentDispatches: async (userId, dependency, session) => sentRecords(await allRecords(session), userId, dependency),
  }
}
