const operationTypes = new Set(['unidad', 'edicion-unidad', 'asignacion-jefe', 'cambio-jefe', 'asignacion-especialista', 'reasignacion-especialista'])
const phases = new Set(['INICIADA', 'CAMBIO_APLICADO', 'COMPLETADA', 'PARCIAL', 'RECONCILIACION'])
const safeDataKeys = new Set([
  'entity', 'kind', 'name', 'code', 'description', 'status', 'role', 'unitId', 'sourceUnitId',
  'destinationUnitId', 'userId', 'previousHeadUserId', 'newHeadUserId', 'previousAssignmentId', 'newAssignmentId',
])

function fail(code, status = 400) {
  return Object.assign(new Error(code), { code, status })
}

function scalar(value, code) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw fail(code)
  return value.trim()
}

function dateValue(value, code, endOfDay = false) {
  const input = scalar(value, code)
  if (!input) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw fail(code)
  const parsed = new Date(`${input}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input) throw fail(code)
  return parsed.toISOString()
}

function parseData(serialized) {
  if (typeof serialized !== 'string') return {}
  try {
    const data = JSON.parse(serialized)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function cleanData(serialized) {
  const source = parseData(serialized)
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => safeDataKeys.has(key) &&
    ['string', 'number', 'boolean'].includes(typeof value)))
}

function mapForClient(event) {
  const beforeData = cleanData(event.datosAntesEvento)
  const afterData = cleanData(event.datosDespuesEvento)
  const data = { ...beforeData, ...afterData }
  return {
    id: event.id,
    occurredAt: event.fechaEvento,
    operationType: event.operationType,
    phase: event.faseEvento,
    actor: event.actorEvento,
    unitId: event.idUnidadEvento || data.unitId || data.sourceUnitId || data.destinationUnitId || null,
    unitName: data.name || null,
    unitCode: data.code || null,
    userId: event.idUsuarioEvento || data.userId || data.newHeadUserId || null,
    beforeData,
    afterData,
  }
}

export function createHierarchyAuditReadService(repository) {
  if (!repository || typeof repository.listEvents !== 'function') throw new TypeError('Hierarchy audit repository is required')

  async function list({ dependency, query = {} } = {}) {
    if (typeof dependency !== 'string' || !dependency.trim()) throw fail('HIERARCHY_AUDIT_DEPENDENCY_REQUIRED', 403)
    const pageText = scalar(query.page, 'HIERARCHY_AUDIT_PAGINATION_INVALID')
    const pageSizeText = scalar(query.pageSize, 'HIERARCHY_AUDIT_PAGINATION_INVALID')
    const page = pageText === undefined ? 1 : Number(pageText)
    const pageSize = pageSizeText === undefined ? 25 : Number(pageSizeText)
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw fail('HIERARCHY_AUDIT_PAGINATION_INVALID')
    }
    const operationType = scalar(query.operationType, 'HIERARCHY_AUDIT_OPERATION_TYPE_INVALID')
    const phase = scalar(query.phase, 'HIERARCHY_AUDIT_PHASE_INVALID')
    const from = dateValue(query.from, 'HIERARCHY_AUDIT_FROM_INVALID')
    const to = dateValue(query.to, 'HIERARCHY_AUDIT_TO_INVALID', true)
    if (operationType && !operationTypes.has(operationType)) throw fail('HIERARCHY_AUDIT_OPERATION_TYPE_INVALID')
    if (phase && !phases.has(phase)) throw fail('HIERARCHY_AUDIT_PHASE_INVALID')
    if (from && to && from > to) throw fail('HIERARCHY_AUDIT_DATE_RANGE_INVALID')

    const result = await repository.listEvents({ dependency, page, pageSize, operationType, phase, from, to })
    return {
      events: result.events.map(mapForClient),
      pagination: result.pagination,
    }
  }

  return { list }
}
