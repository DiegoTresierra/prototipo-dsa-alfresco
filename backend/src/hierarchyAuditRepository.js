import { createHash } from 'node:crypto'
import { createHierarchyServiceClient } from './hierarchyServiceClient.js'

const eventType = 'gdo:eventoJerarquia'
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const eventProperties = [
  'claveEvento', 'idOperacionEvento', 'faseEvento', 'accionEvento', 'dependenciaEvento',
  'idUnidadEvento', 'idAsignacionEvento', 'idUsuarioEvento', 'actorEvento', 'fechaEvento',
  'datosAntesEvento', 'datosDespuesEvento', 'revisionAntesEvento', 'revisionDespuesEvento', 'codigoErrorEvento',
]
const requiredProperties = [
  'claveEvento', 'idOperacionEvento', 'faseEvento', 'accionEvento', 'dependenciaEvento', 'actorEvento', 'fechaEvento',
]
const phases = new Set(['INICIADA', 'CAMBIO_APLICADO', 'COMPLETADA', 'PARCIAL', 'RECONCILIACION'])
const actions = new Set([
  'UNIDAD_CREADA', 'UNIDAD_ACTUALIZADA', 'UNIDAD_EDITADA', 'JEFE_ASIGNADO', 'JEFE_DESACTIVADO',
  'ESPECIALISTA_ASIGNADO', 'ESPECIALISTA_REASIGNADO', 'ASIGNACION_DESACTIVADA',
  'OPERACION_INICIADA', 'OPERACION_COMPLETADA', 'OPERACION_PARCIAL', 'RECONCILIACION_REQUERIDA',
])
const operationTypes = new Set(['unidad', 'edicion-unidad', 'asignacion-jefe', 'cambio-jefe', 'asignacion-especialista', 'reasignacion-especialista'])
const sensitiveKey = /(password|token|authorization|secret|credential|ticket|cookie)/i

function failure(code, status = 502, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra })
}

function requiredText(value, code, max = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw failure(code, 400)
  return value.trim()
}

function optionalText(value, code, max = 240) {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, code, max)
}

function safeJson(value, code) {
  if (value === undefined || value === null) return undefined
  let encoded
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw failure(code, 400)
  }
  if (encoded.length > 4000) throw failure(code, 400)
  function scan(item) {
    if (!item || typeof item !== 'object') return
    for (const [key, nested] of Object.entries(item)) {
      if (sensitiveKey.test(key)) throw failure('HIERARCHY_AUDIT_SENSITIVE_DATA_REJECTED', 400)
      scan(nested)
    }
  }
  scan(value)
  return encoded
}

function normalizeTimestamp(value) {
  const date = value === undefined ? new Date() : new Date(value)
  if (Number.isNaN(date.getTime())) throw failure('HIERARCHY_AUDIT_TIMESTAMP_INVALID', 400)
  return date.toISOString()
}

function operationKey(operationId, phase, action, dependency, unitId, assignmentId, userId) {
  return `HEVT_${createHash('sha256').update(JSON.stringify([operationId, phase, action, dependency, unitId || '', assignmentId || '', userId || ''])).digest('hex')}`
}

function nodeName(key) {
  return `GD_EVENT_${createHash('sha256').update(key).digest('hex')}`
}

function mapEvent(entry) {
  if (!entry || entry.nodeType !== eventType || !entry.id) throw failure('HIERARCHY_AUDIT_EVENT_INVALID', 502)
  const source = entry.properties || {}
  const properties = Object.fromEntries(eventProperties
    .filter((name) => source[`gdo:${name}`] !== undefined)
    .map((name) => [name, source[`gdo:${name}`]]))
  if (requiredProperties.some((name) => typeof properties[name] !== 'string' || !properties[name])) {
    throw failure('HIERARCHY_AUDIT_EVENT_PROPERTIES_INVALID', 502)
  }
  if (!phases.has(properties.faseEvento) || !actions.has(properties.accionEvento)) {
    throw failure('HIERARCHY_AUDIT_EVENT_ENUM_INVALID', 502)
  }
  return {
    id: entry.id,
    name: entry.name,
    parentId: entry.parentId,
    nodeType: entry.nodeType,
    ...properties,
    modifiedAt: entry.modifiedAt || null,
  }
}

function eventData(value) {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function operationType(event) {
  const before = eventData(event.datosAntesEvento)
  const after = eventData(event.datosDespuesEvento)
  const kind = after.kind || before.kind
  if (kind === 'edicion-unidad' || event.accionEvento === 'UNIDAD_EDITADA') return 'edicion-unidad'
  if (kind === 'cambio-jefe' || event.accionEvento === 'JEFE_DESACTIVADO' ||
      (event.accionEvento === 'JEFE_ASIGNADO' && event.faseEvento === 'CAMBIO_APLICADO')) return 'cambio-jefe'
  if (kind === 'reasignacion-especialista' || event.accionEvento === 'ESPECIALISTA_REASIGNADO' ||
      (event.accionEvento === 'ASIGNACION_DESACTIVADA' && (after.destinationUnitId || before.destinationUnitId))) return 'reasignacion-especialista'
  const role = after.role || before.role
  const entity = after.entity || before.entity
  if (entity === 'unidad' || event.accionEvento === 'UNIDAD_CREADA' || event.accionEvento === 'UNIDAD_ACTUALIZADA') return 'unidad'
  if (role === 'jefe-unidad' || event.accionEvento === 'JEFE_ASIGNADO') return 'asignacion-jefe'
  if (role === 'especialista' || event.accionEvento === 'ESPECIALISTA_ASIGNADO') return 'asignacion-especialista'
  return null
}

function dateFilter(value, code) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw failure(code, 400)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw failure(code, 400)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && date.toISOString().slice(0, 10) !== value) throw failure(code, 400)
  return date.toISOString()
}

function buildPayload(input) {
  const operationId = requiredText(input?.operationId, 'HIERARCHY_AUDIT_OPERATION_ID_REQUIRED', 160)
  const phase = requiredText(input?.phase, 'HIERARCHY_AUDIT_PHASE_REQUIRED', 40)
  const action = requiredText(input?.action, 'HIERARCHY_AUDIT_ACTION_REQUIRED', 60)
  if (!phases.has(phase)) throw failure('HIERARCHY_AUDIT_PHASE_INVALID', 400)
  if (!actions.has(action)) throw failure('HIERARCHY_AUDIT_ACTION_INVALID', 400)
  const dependency = requiredText(input?.dependency, 'HIERARCHY_AUDIT_DEPENDENCY_REQUIRED', 80)
  if (!/^[A-Za-z0-9_-]+$/.test(dependency)) throw failure('HIERARCHY_AUDIT_DEPENDENCY_INVALID', 400)
  const actorId = requiredText(input?.actorId, 'HIERARCHY_AUDIT_ACTOR_REQUIRED', 160)
  const unitId = optionalText(input.unitId, 'HIERARCHY_AUDIT_UNIT_ID_INVALID', 160)
  const assignmentId = optionalText(input.assignmentId, 'HIERARCHY_AUDIT_ASSIGNMENT_ID_INVALID', 160)
  const userId = optionalText(input.userId, 'HIERARCHY_AUDIT_USER_ID_INVALID', 160)
  const eventId = operationKey(operationId, phase, action, dependency, unitId, assignmentId, userId)
  const occurredAtProvided = input.occurredAt !== undefined
  const values = {
    'gdo:claveEvento': eventId,
    'gdo:idOperacionEvento': operationId,
    'gdo:faseEvento': phase,
    'gdo:accionEvento': action,
    'gdo:dependenciaEvento': dependency,
    'gdo:actorEvento': actorId,
    'gdo:fechaEvento': normalizeTimestamp(input.occurredAt),
  }
  const optional = {
    idUnidadEvento: unitId,
    idAsignacionEvento: assignmentId,
    idUsuarioEvento: userId,
    datosAntesEvento: safeJson(input.beforeData, 'HIERARCHY_AUDIT_BEFORE_DATA_INVALID'),
    datosDespuesEvento: safeJson(input.afterData, 'HIERARCHY_AUDIT_AFTER_DATA_INVALID'),
    revisionAntesEvento: optionalText(input.beforeRevision, 'HIERARCHY_AUDIT_REVISION_INVALID', 128),
    revisionDespuesEvento: optionalText(input.afterRevision, 'HIERARCHY_AUDIT_REVISION_INVALID', 128),
    codigoErrorEvento: optionalText(input.errorCode, 'HIERARCHY_AUDIT_ERROR_CODE_INVALID', 120),
  }
  for (const [property, value] of Object.entries(optional)) {
    if (value !== undefined) values[`gdo:${property}`] = value
  }
  return {
    eventId,
    operationId,
    phase,
    action,
    occurredAtProvided,
    name: nodeName(eventId),
    properties: values,
  }
}

function sameEvent(actual, expected, { ignoreTimestamp = false } = {}) {
  return actual.nodeType === eventType && actual.name === expected.name && eventProperties.every((property) => {
    const key = `gdo:${property}`
    return (ignoreTimestamp && key === 'gdo:fechaEvento') ||
      (actual.properties?.[key] ?? undefined) === expected.properties[key]
  })
}

export function createHierarchyAuditRepository(settings, {
  fetchImpl = globalThis.fetch,
  allowWrites = false,
} = {}) {
  const service = createHierarchyServiceClient(settings, fetchImpl)
  const hierarchy = settings?.hierarchyService || {}
  const auditContainerId = hierarchy.auditContainerNodeId
  let containerPromise

  function assertConfigured({ writing = false } = {}) {
    if (hierarchy.storage !== 'alfresco') throw failure('HIERARCHY_STORAGE_MUST_BE_ALFRESCO', 503)
    if (!uuidPattern.test(auditContainerId || '') || !uuidPattern.test(hierarchy.containerNodeId || '') ||
        writing && !uuidPattern.test(hierarchy.labContainerNodeId || '')) {
      throw failure('HIERARCHY_AUDIT_CONTAINER_CONFIGURATION_INVALID', 503)
    }
    const ids = [auditContainerId, hierarchy.containerNodeId, ...(writing ? [hierarchy.labContainerNodeId] : [])].map((id) => id.toLowerCase())
    if (new Set(ids).size !== ids.length) throw failure('HIERARCHY_CONTAINERS_MUST_BE_DISTINCT', 409)
  }

  function assertWritesEnabled() {
    assertConfigured({ writing: true })
    if (allowWrites !== true) throw failure('HIERARCHY_AUDIT_WRITES_DISABLED', 403)
  }

  async function getContainer() {
    assertConfigured()
    if (!containerPromise) {
      containerPromise = service.getNode(auditContainerId).then((entry) => {
        const name = entry.name || entry.properties?.['cm:name']
        if (entry.id !== auditContainerId || name !== 'GD_JERARQUIAS_AUDITORIA' || entry.nodeType !== 'cm:folder' || entry.isFolder !== true) {
          throw failure('HIERARCHY_AUDIT_CONTAINER_INVALID', 409)
        }
        return entry
      }).catch((error) => {
        containerPromise = undefined
        throw error
      })
    }
    return containerPromise
  }

  async function listAllRaw() {
    const container = await getContainer()
    const entries = []
    const ids = new Set()
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const page = await service.listNodeChildren(container.id, { maxItems: 100, skipCount })
      for (const entry of page.entries) {
        if (ids.has(entry.id)) throw failure('HIERARCHY_AUDIT_PAGINATION_INVALID', 502)
        ids.add(entry.id)
      }
      entries.push(...page.entries.filter((entry) => entry.nodeType === eventType))
      hasMoreItems = page.hasMoreItems
      if (hasMoreItems && page.entries.length === 0) throw failure('HIERARCHY_AUDIT_PAGINATION_INVALID', 502)
      skipCount += page.entries.length
      if (skipCount > 100_000) throw failure('HIERARCHY_AUDIT_EVENT_LIMIT_EXCEEDED', 502)
    }
    return entries
  }

  function verifyEvent(entry, expected, { ignoreTimestamp = false } = {}) {
    if (entry.parentId !== auditContainerId || !sameEvent(entry, expected, { ignoreTimestamp })) {
      throw failure('HIERARCHY_AUDIT_DUPLICATE_CONFLICT', 409)
    }
    const mapped = mapEvent(entry)
    return { ...mapped, reused: true }
  }

  async function findExisting(expected) {
    const matching = (await listAllRaw()).filter((entry) =>
      entry.name === expected.name || entry.properties?.['gdo:claveEvento'] === expected.eventId)
    if (!matching.length) return null
    if (matching.length !== 1) throw failure('HIERARCHY_AUDIT_DUPLICATE_CONFLICT', 409)
    const verified = await service.getNode(matching[0].id)
    return verifyEvent(verified, expected, { ignoreTimestamp: !expected.occurredAtProvided })
  }

  async function getEvent(eventNodeId, { dependency } = {}) {
    assertConfigured()
    if (!uuidPattern.test(eventNodeId || '')) throw failure('HIERARCHY_AUDIT_EVENT_ID_INVALID', 400)
    const scopedDependency = requiredText(dependency, 'HIERARCHY_AUDIT_DEPENDENCY_REQUIRED', 80)
    const entry = await service.getNode(eventNodeId)
    if (entry.parentId !== auditContainerId || entry.nodeType !== eventType) throw failure('HIERARCHY_AUDIT_EVENT_OUT_OF_SCOPE', 404)
    const event = mapEvent(entry)
    if (event.dependenciaEvento !== scopedDependency) throw failure('HIERARCHY_AUDIT_EVENT_OUT_OF_SCOPE', 404)
    return event
  }

  async function listEvents({ dependency, operationId, operationType: typeFilter, phase, from, to, page = 1, pageSize = 50 } = {}) {
    assertConfigured()
    const scopedDependency = requiredText(dependency, 'HIERARCHY_AUDIT_DEPENDENCY_REQUIRED', 80)
    const operationFilter = optionalText(operationId, 'HIERARCHY_AUDIT_OPERATION_ID_INVALID', 160)
    if (typeFilter !== undefined && !operationTypes.has(typeFilter)) throw failure('HIERARCHY_AUDIT_OPERATION_TYPE_INVALID', 400)
    if (phase !== undefined && !phases.has(phase)) throw failure('HIERARCHY_AUDIT_PHASE_INVALID', 400)
    const fromDate = dateFilter(from, 'HIERARCHY_AUDIT_FROM_INVALID')
    const toDate = dateFilter(to, 'HIERARCHY_AUDIT_TO_INVALID')
    if (fromDate && toDate && fromDate > toDate) throw failure('HIERARCHY_AUDIT_DATE_RANGE_INVALID', 400)
    const inclusiveTo = to && /^\d{4}-\d{2}-\d{2}$/.test(to)
      ? new Date(`${to}T23:59:59.999Z`).toISOString()
      : toDate
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw failure('HIERARCHY_AUDIT_PAGINATION_INVALID', 400)
    }
    const entries = await listAllRaw()
    const events = entries.map((entry) => {
      if (entry.parentId !== auditContainerId) throw failure('HIERARCHY_AUDIT_EVENT_OUT_OF_SCOPE', 409)
      return mapEvent(entry)
    }).map((event) => ({ ...event, operationType: operationType(event) }))
      .filter((event) => event.dependenciaEvento.toLowerCase() === scopedDependency.toLowerCase() &&
      (!operationFilter || event.idOperacionEvento === operationFilter) &&
      (!typeFilter || event.operationType === typeFilter) &&
      (!phase || event.faseEvento === phase) &&
      (!fromDate || event.fechaEvento >= fromDate) &&
      (!inclusiveTo || event.fechaEvento <= inclusiveTo))
      .sort((left, right) => right.fechaEvento.localeCompare(left.fechaEvento) || left.id.localeCompare(right.id))
    const start = (page - 1) * pageSize
    const pageEvents = events.slice(start, start + pageSize)
    const totalPages = Math.ceil(events.length / pageSize)
    return {
      events: pageEvents,
      pagination: { page, pageSize, totalItems: events.length, totalPages, hasMoreItems: page < totalPages },
    }
  }

  async function createEvent(input) {
    assertWritesEnabled()
    const expected = buildPayload(input)
    const container = await getContainer()
    const existing = await findExisting(expected)
    if (existing) return existing
    if (!container.allowableOperations?.includes('create')) throw failure('HIERARCHY_AUDIT_CREATE_FORBIDDEN', 403)
    try {
      const created = await service.createChild(container.id, { name: expected.name, nodeType: eventType, properties: expected.properties })
      const verified = await service.getNode(created.id)
      if (verified.parentId !== container.id || !sameEvent(verified, expected)) {
        throw failure('HIERARCHY_AUDIT_WRITE_VERIFICATION_FAILED', 409)
      }
      return { ...mapEvent(verified), reused: false }
    } catch (error) {
      if (error.code === 'HIERARCHY_WRITE_OUTCOME_UNKNOWN' || error.status === 409) {
        try {
          const recovered = await findExisting(expected)
          if (recovered) return { ...recovered, outcomeRecovered: true }
        } catch {
          // Keep the original uncertain result; a later retry can reconcile by its deterministic key.
        }
      }
      if (error.partialCommit) throw error
      if (error.code === 'HIERARCHY_WRITE_OUTCOME_UNKNOWN') throw error
      if (error.status === 401 || error.status === 403 || error.status === 409) throw error
      throw failure(error.code || 'HIERARCHY_AUDIT_WRITE_FAILED', error.status || 502, { partialCommit: true, operationId: expected.operationId })
    }
  }

  return { getContainer, createEvent, getEvent, listEvents }
}

export { eventProperties as HIERARCHY_AUDIT_PROPERTIES, eventType as HIERARCHY_AUDIT_EVENT_TYPE }
