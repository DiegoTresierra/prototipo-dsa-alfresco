function failure(code, status = 503, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra })
}

function text(value, code, { optional = false, max = 240 } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw failure(code, 400)
  return value.trim()
}

function normalizeDependency(value) {
  const dependency = text(value, 'HIERARCHY_DEPENDENCY_REQUIRED', { max: 80 })
  if (!/^[A-Za-z0-9_-]+$/.test(dependency)) throw failure('HIERARCHY_DEPENDENCY_INVALID', 400)
  return dependency
}

export function createHierarchyUnitCreationService({ repository, auditRepository, writesEnabled = false } = {}) {
  if (!repository || !auditRepository) throw failure('HIERARCHY_UNIT_CREATION_DEPENDENCIES_REQUIRED', 500)

  async function record({ operationId, phase, action, dependency, actorId, unitId, details, errorCode }) {
    return auditRepository.createEvent({
      operationId,
      phase,
      action,
      dependency,
      actorId,
      ...(unitId ? { unitId } : {}),
      ...(details ? { afterData: details } : {}),
      ...(errorCode ? { errorCode } : {}),
    })
  }

  async function failPartial(error, { operationId, dependency, actorId, unit, details }) {
    const code = error.code || 'HIERARCHY_UNIT_CREATE_FAILED'
    let partial
    try {
      partial = await record({ operationId, phase: 'PARCIAL', action: 'OPERACION_PARCIAL', dependency, actorId,
        ...(unit?.id || error.unitId ? { unitId: unit?.id || error.unitId } : {}),
        details: details || (unit ? { entity: 'unidad', name: unit.name, code: unit.code } : { entity: 'unidad' }),
        errorCode: code })
    } catch (auditError) {
      throw failure('HIERARCHY_UNIT_OPERATION_PARTIAL', 503, {
        operationId,
        operationStatus: 'PARCIAL',
        ...(unit?.id || error.unitId ? { unitId: unit?.id || error.unitId } : {}),
        causeCode: code,
        auditErrorCode: auditError.code || 'HIERARCHY_AUDIT_RECORD_FAILED',
      })
    }
    throw failure(code, error.status || 503, {
      operationId,
      operationStatus: 'PARCIAL',
      ...(unit?.id || error.unitId ? { unitId: unit?.id || error.unitId } : {}),
      partialAuditEventId: partial.id,
    })
  }

  async function createUnit({ operationId, name, code = '', description = '', dependency, actorId } = {}) {
    if (writesEnabled !== true) throw failure('HIERARCHY_UNIT_WRITES_DISABLED', 403)
    const idempotencyKey = text(operationId, 'HIERARCHY_OPERATION_ID_INVALID', { max: 160 })
    if (idempotencyKey.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
      throw failure('HIERARCHY_OPERATION_ID_INVALID', 400)
    }
    const unitName = text(name, 'HIERARCHY_UNIT_NAME_REQUIRED')
    const unitCode = text(code, 'HIERARCHY_UNIT_CODE_INVALID', { optional: true, max: 80 })
    const unitDescription = text(description, 'HIERARCHY_UNIT_DESCRIPTION_INVALID', { optional: true, max: 1000 })
    const scope = normalizeDependency(dependency)
    const actor = text(actorId, 'HIERARCHY_ACTOR_REQUIRED', { max: 160 })
    try {
      await record({ operationId: idempotencyKey, phase: 'INICIADA', action: 'OPERACION_INICIADA', dependency: scope, actorId: actor,
        details: { entity: 'unidad', name: unitName, code: unitCode } })
    } catch (error) {
      throw failure('HIERARCHY_AUDIT_INITIATION_FAILED', error.status || 503, {
        operationId: idempotencyKey,
        auditErrorCode: error.code || 'HIERARCHY_AUDIT_RECORD_FAILED',
      })
    }

    let unit
    try {
      unit = await repository.createUnit({
        operationId: idempotencyKey,
        dependency: scope,
        name: unitName,
        code: unitCode,
        description: unitDescription,
        actorId: actor,
      })
    } catch (error) {
      return failPartial(error, { operationId: idempotencyKey, dependency: scope, actorId: actor })
    }
    let completed
    try {
      completed = await record({ operationId: idempotencyKey, phase: 'COMPLETADA', action: 'OPERACION_COMPLETADA',
        dependency: scope, actorId: actor, unitId: unit.id,
        details: { entity: 'unidad', name: unit.name, code: unit.code, status: unit.status } })
    } catch (error) {
      return failPartial(error, { operationId: idempotencyKey, dependency: scope, actorId: actor, unit })
    }
    return { operationId: idempotencyKey, status: 'COMPLETADA', unit, auditEventId: completed.id }
  }

  return { createUnit }
}
