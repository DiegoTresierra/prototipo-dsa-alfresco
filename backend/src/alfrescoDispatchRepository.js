import { randomUUID } from 'node:crypto'
import { buildAlfrescoUrl } from './alfrescoClient.js'
import { createDocumentQueue } from './documentQueue.js'
import { verifyPilotDocumentScope } from './dispatchPilotScope.js'
import { mapConcurrent } from './mapConcurrent.js'

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
const sameProjection = (actual, expected) => actual === undefined && expected.length === 0 ||
  Array.isArray(actual) && JSON.stringify([...actual].sort()) === JSON.stringify(expected)

export function parseAssignments(raw, documentId) {
  if (raw === undefined) return { schemaVersion: 1, revision: 0, documentId, dispatches: [], history: [] }
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > maxAssignmentBytes) fail('DISPATCH_INVALID_ASSIGNMENTS')
  let value
  try { value = JSON.parse(raw) } catch { fail('DISPATCH_INVALID_ASSIGNMENTS') }
  if (value?.schemaVersion !== 1 || value.documentId !== documentId || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.dispatches) || !Array.isArray(value.history)) fail('DISPATCH_INVALID_ASSIGNMENTS')
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
    ids.add(record.id)
    keys.add(key)
    const users = new Set()
    for (const recipient of record.recipients) {
      if (!recipient || typeof recipient !== 'object') fail('DISPATCH_INVALID_ASSIGNMENTS')
      if (!text(recipient.id) || assignments.has(recipient.id) || !text(recipient.userId) || users.has(recipient.userId) ||
          !['jefe-unidad', 'especialista'].includes(recipient.functionalRole) || recipient.dependency !== record.senderDependency ||
          record.senderRole === 'jefe-unidad' && recipient.functionalRole !== 'especialista' ||
          !['ASIGNADO', 'DESPACHADO', 'ATENDIDO', 'ANULADO'].includes(recipient.status) ||
          recipient.documentId !== documentId || recipient.dispatchId !== record.id || !date(recipient.createdAt) ||
          recipient.senderUserId !== record.senderUserId || recipient.senderRole !== record.senderRole ||
          recipient.senderDependency !== record.senderDependency || recipient.originAssignmentId !== record.originAssignmentId ||
          recipient.instruction !== record.instruction) fail('DISPATCH_INVALID_ASSIGNMENTS')
      users.add(recipient.userId)
      assignments.set(recipient.id, recipient)
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
  for (const event of value.history) {
    if (!event || typeof event !== 'object') fail('DISPATCH_INVALID_ASSIGNMENTS')
    if (!text(event.id) || eventIds.has(event.id) || !text(event.actorUserId) || !date(event.at) ||
        event.action !== 'DISPATCH_CREATED' || !ids.has(event.dispatchId) || !Array.isArray(event.assignmentIds) ||
        event.assignmentIds.some((id) => !assignments.has(id) || assignments.get(id).dispatchId !== event.dispatchId)) fail('DISPATCH_INVALID_ASSIGNMENTS')
    eventIds.add(event.id)
  }
  // Every assignment must have a traceable creation event.
  for (const record of value.dispatches) {
    if (!value.history.some((event) => event.dispatchId === record.id && event.actorUserId === record.senderUserId &&
      record.recipients.every((recipient) => event.assignmentIds.includes(recipient.id)))) fail('DISPATCH_INVALID_ASSIGNMENTS')
  }
  return value
}

export function projections(envelope) {
  const recipients = envelope.dispatches.flatMap((record) => record.recipients).filter(active)
  return {
    [responsibleProperty]: [...new Set(recipients.map((recipient) => recipient.userId))].sort(),
    [dependencyProperty]: [...new Set(recipients.map((recipient) => recipient.dependency))].sort(),
  }
}

function matches(record, input) {
  return record.documentId === input.documentId && record.instruction === input.instruction && record.priority === input.priority &&
    record.senderRole === input.senderRole && record.senderDependency === input.senderDependency &&
    record.originAssignmentId === (input.originAssignmentId || null) &&
    JSON.stringify(record.recipients.map((recipient) => [recipient.userId, recipient.functionalRole]).sort()) ===
      JSON.stringify(input.recipients.map((recipient) => [recipient.id, recipient.functionalRole]).sort())
}

export function createAlfrescoDispatchRepository(settings, fetchImpl = (...args) => globalThis.fetch(...args)) {
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
      const url = path === '/service/api/classes/gd_tramite'
        ? `${settings.alfrescoTarget}/alfresco${path}` : buildAlfrescoUrl(settings.alfrescoTarget, path, query)
      response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json', Authorization: authorization, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch { fail(method === 'PUT' ? 'DISPATCH_WRITE_OUTCOME_UNKNOWN' : 'DISPATCH_ALFRESCO_UNAVAILABLE', 502) }
    if (!response.ok) {
      if (method === 'PUT') fail(response.status === 403 ? 'DISPATCH_NODE_UPDATE_DENIED' : 'DISPATCH_WRITE_OUTCOME_UNKNOWN', response.status === 403 ? 403 : 502)
      fail(response.status === 403 ? 'DISPATCH_NODE_READ_DENIED' : 'DISPATCH_ALFRESCO_UNAVAILABLE', response.status === 403 ? 403 : 502)
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
  async function createDispatch(input, session) {
    // Caller holds withDocument throughout business authorization and this R/M/W/verify.
    assertWriteEnabled()
    await assertModel()
    if (!session?.authorization || input.senderUserId !== (session.alfresco?.id || session.user?.id)) fail('SESSION_IDENTITY_REQUIRED', 403)
    const actor = await read(input.documentId, session.authorization) // Actor ACL cannot be bypassed by the writer.
    await verifyPilotDocumentScope(settings, session, actor.node, request)
    const { node, envelope, raw } = await read(input.documentId)
    if (!node.allowableOperations?.includes('update')) fail('DISPATCH_NODE_UPDATE_DENIED', 403)
    const existing = envelope.dispatches.find((record) => record.senderUserId === input.senderUserId && record.requestKey === input.requestKey)
    if (existing) {
      if (!matches(existing, input)) fail('DISPATCH_REQUEST_CONFLICT', 409)
      return existing
    }
    if (input.senderRole === 'jefe-unidad') {
      const origin = envelope.dispatches.flatMap((record) => record.recipients).find((recipient) =>
        recipient.id === input.originAssignmentId && recipient.userId === input.senderUserId &&
        recipient.dependency === input.senderDependency && recipient.functionalRole === 'jefe-unidad' && active(recipient))
      if (!origin) fail('DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED', 403)
    }
    const id = randomUUID()
    const at = new Date().toISOString()
    const record = {
      id, requestKey: input.requestKey, documentId: input.documentId, senderUserId: input.senderUserId,
      senderDependency: input.senderDependency, senderRole: input.senderRole, originAssignmentId: input.originAssignmentId || null,
      instruction: input.instruction, priority: input.priority, createdAt: at, status: 'ASIGNADO', assignmentCompletedAt: at,
      recipients: input.recipients.map((recipient) => ({
        id: randomUUID(), dispatchId: id, documentId: input.documentId, userId: recipient.id,
        displayName: recipient.displayName || recipient.id, functionalRole: recipient.functionalRole, dependency: recipient.dependency,
        unit: recipient.unit || null, status: 'ASIGNADO', createdAt: at, assignedAt: at,
        senderUserId: input.senderUserId, senderRole: input.senderRole, senderDependency: input.senderDependency,
        instruction: input.instruction, originAssignmentId: input.originAssignmentId || null,
      })),
    }
    const next = { ...envelope, revision: envelope.revision + 1, dispatches: [...envelope.dispatches, record],
      history: [...envelope.history, { id: randomUUID(), action: 'DISPATCH_CREATED', at, actorUserId: input.senderUserId,
        dispatchId: id, assignmentIds: record.recipients.map((recipient) => recipient.id) }] }
    const serialized = JSON.stringify(next)
    if (Buffer.byteLength(serialized) > maxAssignmentBytes) fail('DISPATCH_ASSIGNMENTS_SIZE_LIMIT', 413)
    parseAssignments(serialized, input.documentId)
    // Best-effort external-change detection, NOT compare-and-swap: a writer can still race after this GET.
    const current = await read(input.documentId)
    if (current.raw !== raw) fail('DISPATCH_EXTERNAL_MODIFICATION', 409)
    if (!current.node.allowableOperations?.includes('update')) fail('DISPATCH_NODE_UPDATE_DENIED', 403)
    const expected = { [assignmentProperty]: serialized, ...projections(next) }
    await request(`${core}/nodes/${encodeURIComponent(input.documentId)}`, { method: 'PUT', body: {
      ...(current.node.aspectNames?.includes('gd:tramite') ? {} : { aspectNames: [...(current.node.aspectNames || []), 'gd:tramite'] }), properties: expected,
    } })
    let verified
    try { verified = await read(input.documentId, undefined, false) } catch { fail('DISPATCH_WRITE_OUTCOME_UNKNOWN', 502) }
    if (!verified.node.aspectNames?.includes('gd:tramite') || verified.raw !== serialized ||
        Object.entries(projections(next)).some(([key, value]) => !sameProjection(verified.node.properties?.[key], value))) fail('DISPATCH_WRITE_VERIFICATION_FAILED', 409)
    return record
  }
  async function documentRecords(documentId) {
    await assertModel()
    return (await read(documentId)).envelope.dispatches
  }
  async function readSnapshot(session) {
    await assertModel()
    if (!session?.authorization) fail('SESSION_IDENTITY_REQUIRED', 403)
    const folders = [...new Set(Object.values(settings.officeInboxNodeIds || {}).flatMap((office) => Object.values(office)).filter(Boolean))]
    if (!folders.length) fail('DISPATCH_DISCOVERY_FOLDERS_REQUIRED')
    const ids = new Set()
    // Request-scoped only: these nodes are proven readable by THIS actor.
    const actorNodes = new Map()
    let scanned = 0
    await mapConcurrent(folders, 4, async (folder) => {
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
    })
    const batches = await mapConcurrent([...ids], 4, async (id) => {
      // Use actor credentials for authoritative reads: an assignment never bypasses Alfresco ACL.
      try {
        const value = actorNodes.has(id) ? decodeNode(actorNodes.get(id), id) : await read(id, session.authorization)
        actorNodes.set(id, value.node)
        return value.envelope.dispatches
      } catch (error) {
        if (error.message === 'DISPATCH_NODE_READ_DENIED') return []
        throw error
      }
    })
    return { records: batches.flat(), actorNodes }
  }
  async function allRecords(session) { return (await readSnapshot(session)).records }
  const receivedRecords = (records, userId, role, dependency) => records.filter((record) => role === 'direccion'
    ? record.senderDependency === String(dependency).toLowerCase()
    : record.recipients.some((recipient) => recipient.userId === userId && recipient.functionalRole === role &&
      recipient.dependency === String(dependency).toLowerCase() && active(recipient)))
  const sentRecords = (records, userId, dependency) => records.filter((record) =>
    record.senderUserId === userId && record.senderDependency === String(dependency).toLowerCase())
  return {
    kind: 'alfresco', withDocument, createDispatch, assertModel, allRecords,
    loadInbox: async (session) => {
      const snapshot = await readSnapshot(session)
      const userId = session.alfresco?.id || session.user?.id
      return { dispatches: receivedRecords(snapshot.records, userId, session.functionalRole, session.dependency),
        sentDispatches: sentRecords(snapshot.records, userId, session.dependency), actorNodes: snapshot.actorNodes }
    },
    findDispatch: async (userId, requestKey, documentId) => (await documentRecords(documentId)).find((record) => record.senderUserId === userId && record.requestKey === requestKey) || null,
    findAttentionAssignment: async (userId, documentId, dependency, assignmentId) => (await documentRecords(documentId))
      .flatMap((record) => record.recipients).find((recipient) => recipient.id === assignmentId && recipient.userId === userId &&
        recipient.functionalRole === 'jefe-unidad' && recipient.dependency === String(dependency).toLowerCase() && active(recipient)) || null,
    listDispatchesForUser: async (userId, role, dependency, session) => receivedRecords(await allRecords(session), userId, role, dependency),
    listSentDispatches: async (userId, dependency, session) => sentRecords(await allRecords(session), userId, dependency),
  }
}
