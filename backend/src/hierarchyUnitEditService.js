const sameDependency = (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()

function fail(code, status = 503, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra })
}

function text(value, code, { optional = false, max = 240 } = {}) {
  if (optional && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) return ''
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(code, 400)
  return value.trim()
}

function parsedData(value) {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function unitData(unit, kind = 'edicion-unidad') {
  return { entity: 'unidad', kind, name: unit.name, code: unit.code || '', description: unit.description || '', status: unit.status }
}

function matchesUnitData(actual, expected) {
  return ['entity', 'kind', 'name', 'code', 'description', 'status'].every((key) => actual[key] === expected[key])
}

function equalValues(left, right) {
  return left.name === right.name && left.code === right.code && left.description === right.description
}

function normalizeValues(unit) {
  return { name: unit.name, code: unit.code || '', description: unit.description || '' }
}

export function createHierarchyUnitEditService({ repository, auditRepository, writesEnabled = false } = {}) {
  if (!repository || !auditRepository) throw fail('HIERARCHY_UNIT_EDIT_DEPENDENCIES_REQUIRED', 500)

  async function record({ operationId, phase, action, dependency, actorId, unitId, beforeData, afterData, errorCode }) {
    return auditRepository.createEvent({ operationId, phase, action, dependency, actorId, unitId, beforeData, afterData, errorCode })
  }

  async function partial({ operationId, dependency, actorId, unitId, beforeData, afterData, error }) {
    try {
      await record({ operationId, phase: 'PARCIAL', action: 'OPERACION_PARCIAL', dependency, actorId, unitId, beforeData, afterData,
        errorCode: error.code || 'HIERARCHY_UNIT_EDIT_PARTIAL' })
    } catch {
      // Preserve the incomplete state in the response; a retry will reconcile through Alfresco and the operation id.
    }
    throw fail(error.code || 'HIERARCHY_UNIT_EDIT_PARTIAL', error.status || 503, {
      operationId, operationStatus: 'PARCIAL', unitId, partialCommit: true,
    })
  }

  async function editUnit({ unitId, name, code = '', description = '', operationId, expectedRevision, dependency, actorId } = {}) {
    if (writesEnabled !== true) throw fail('HIERARCHY_UNIT_EDITS_DISABLED', 403)
    const operation = text(operationId, 'HIERARCHY_OPERATION_ID_INVALID', { max: 160 })
    const unitUuid = text(unitId, 'HIERARCHY_UNIT_ID_INVALID', { max: 64 })
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(unitUuid)) throw fail('HIERARCHY_UNIT_ID_INVALID', 400)
    const scope = text(dependency, 'HIERARCHY_DEPENDENCY_REQUIRED', { max: 80 })
    const actor = text(actorId, 'HIERARCHY_ACTOR_REQUIRED', { max: 160 })
    const values = {
      name: text(name, 'HIERARCHY_UNIT_NAME_REQUIRED'),
      code: text(code, 'HIERARCHY_UNIT_CODE_INVALID', { optional: true, max: 80 }),
      description: text(description, 'HIERARCHY_UNIT_DESCRIPTION_INVALID', { optional: true, max: 1000 }),
    }
    if (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !/^[a-f\d]{64}$/i.test(expectedRevision))) {
      throw fail('HIERARCHY_REVISION_INVALID', 400)
    }

    const unit = await repository.getUnit(unitUuid)
    if (!sameDependency(unit.dependency, scope)) throw fail('HIERARCHY_DEPENDENCY_MISMATCH', 403)
    if (unit.status !== 'ACTIVA') throw fail('HIERARCHY_UNIT_INACTIVE', 409)
    const beforeValues = normalizeValues(unit)
    const beforeData = unitData(unit)
    const afterUnit = { ...unit, ...values }
    const afterData = unitData(afterUnit)
    const allUnits = await repository.listUnits({ dependency: scope, includeInactive: true })
    const normalizedCode = values.code.normalize('NFKC').trim().toLocaleLowerCase('es')
    if (normalizedCode && allUnits.units.some((candidate) => candidate.id !== unit.id &&
        sameDependency(candidate.dependency, scope) && candidate.code.normalize('NFKC').trim().toLocaleLowerCase('es') === normalizedCode)) {
      throw fail('HIERARCHY_UNIT_CODE_DUPLICATE', 409)
    }

    const previousEvents = await auditRepository.listEvents({ dependency: scope, operationId: operation, page: 1, pageSize: 200 })
    const operationEvents = previousEvents.events
    const started = operationEvents.find((event) => event.faseEvento === 'INICIADA' && event.accionEvento === 'OPERACION_INICIADA')
    const completed = operationEvents.find((event) => event.faseEvento === 'COMPLETADA')
    const partialEvent = [...operationEvents].reverse().find((event) => event.faseEvento === 'PARCIAL')
    if (operationEvents.length && (!started || started.actorEvento !== actor || started.idUnidadEvento !== unit.id ||
        !matchesUnitData(parsedData(started.datosDespuesEvento), afterData))) {
      throw fail('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409, { operationId: operation })
    }
    if (completed) {
      if (!matchesUnitData(parsedData(completed.datosDespuesEvento), afterData) || !equalValues(beforeValues, values)) {
        throw fail('HIERARCHY_OPERATION_RESULT_CONFLICT', 409, { operationId: operation })
      }
      return { status: 'COMPLETADA', operationId: operation, unit, reused: true }
    }
    if (!operationEvents.length && equalValues(beforeValues, values)) return { status: 'SIN_CAMBIOS', operationId: operation, unit, reused: true }
    if (partialEvent && !matchesUnitData(parsedData(partialEvent.datosDespuesEvento), afterData)) {
      throw fail('HIERARCHY_OPERATION_RESULT_CONFLICT', 409, { operationId: operation, operationStatus: 'PARCIAL' })
    }
    if (started && !completed) {
      const recordedBefore = parsedData(started.datosAntesEvento)
      const originalValues = { name: recordedBefore.name, code: recordedBefore.code || '', description: recordedBefore.description || '' }
      if (!equalValues(beforeValues, values) && !equalValues(beforeValues, originalValues)) {
        throw fail('HIERARCHY_OPERATION_RESULT_CONFLICT', 409, { operationId: operation, operationStatus: 'PARCIAL' })
      }
      if (equalValues(beforeValues, values)) {
        const verified = await repository.getUnit(unitUuid)
        const completedEvent = await record({ operationId: operation, phase: 'COMPLETADA', action: 'UNIDAD_EDITADA', dependency: scope, actorId: actor, unitId: unitUuid, beforeData: recordedBefore, afterData })
        return { status: 'COMPLETADA', operationId: operation, unit: verified, auditEventId: completedEvent.id, reused: true }
      }
    }
    if (!started && expectedRevision !== undefined && await repository.getRevision() !== expectedRevision) {
      throw fail('HIERARCHY_REVISION_CONFLICT', 409, { operationId: operation })
    }

    if (!started) {
      try {
        await record({ operationId: operation, phase: 'INICIADA', action: 'OPERACION_INICIADA', dependency: scope, actorId: actor, unitId: unitUuid, beforeData, afterData })
      } catch (error) {
        throw fail('HIERARCHY_AUDIT_INITIATION_FAILED', 503, { operationId: operation, causeCode: error.code || 'HIERARCHY_AUDIT_RECORD_FAILED' })
      }
    }

    let updated
    try {
      updated = await repository.updateUnit({ unitId: unitUuid, dependency: scope, changes: values, expectedRevision: started || partialEvent ? undefined : expectedRevision })
      const verified = await repository.getUnit(unitUuid)
      if (verified.id !== unit.id || verified.status !== 'ACTIVA' || !equalValues(normalizeValues(verified), values)) {
        throw fail('HIERARCHY_WRITE_VERIFICATION_FAILED', 409)
      }
      const completedEvent = await record({ operationId: operation, phase: 'COMPLETADA', action: 'UNIDAD_EDITADA', dependency: scope, actorId: actor, unitId: unitUuid, beforeData, afterData })
      return { status: 'COMPLETADA', operationId: operation, unit: updated.outcomeRecovered ? verified : updated, auditEventId: completedEvent.id, reused: Boolean(updated.outcomeRecovered) }
    } catch (error) {
      return partial({ operationId: operation, dependency: scope, actorId: actor, unitId: unitUuid, beforeData, afterData, error })
    }
  }

  return { editUnit }
}
