function failure(code, status = 503, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra })
}

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function requiredText(value, code, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw failure(code, 400)
  return value.trim()
}

export function createHierarchyHeadAssignmentService({ repository, auditRepository, writesEnabled = false } = {}) {
  if (!repository || !auditRepository) throw failure('HIERARCHY_HEAD_ASSIGNMENT_DEPENDENCIES_REQUIRED', 500)

  async function record({ operationId, phase, action, dependency, actorId, unitId, userId, assignmentId, errorCode }) {
    return auditRepository.createEvent({
      operationId,
      phase,
      action,
      dependency,
      actorId,
      ...(unitId ? { unitId } : {}),
      ...(userId ? { userId } : {}),
      ...(assignmentId ? { assignmentId } : {}),
      afterData: { entity: 'asignacion', role: 'jefe-unidad', unitId, userId },
      ...(errorCode ? { errorCode } : {}),
    })
  }

  async function failPartial(error, context) {
    const code = error.code || 'HIERARCHY_HEAD_ASSIGNMENT_FAILED'
    try {
      const event = await record({ ...context, phase: 'PARCIAL', action: 'OPERACION_PARCIAL', errorCode: code })
      throw failure(code, error.status || 503, {
        operationId: context.operationId,
        operationStatus: 'PARCIAL',
        ...(context.unitId ? { unitId: context.unitId } : {}),
        ...(context.userId ? { userId: context.userId } : {}),
        ...(error.assignmentId ? { assignmentId: error.assignmentId } : {}),
        partialAuditEventId: event.id,
      })
    } catch (auditError) {
      if (auditError?.code === code && auditError?.operationId === context.operationId) throw auditError
      throw failure('HIERARCHY_HEAD_ASSIGNMENT_PARTIAL', 503, {
        operationId: context.operationId,
        operationStatus: 'PARCIAL',
        ...(context.unitId ? { unitId: context.unitId } : {}),
        ...(context.userId ? { userId: context.userId } : {}),
        causeCode: code,
        auditErrorCode: auditError.code || 'HIERARCHY_AUDIT_RECORD_FAILED',
      })
    }
  }

  async function assignHead({ operationId, unitId, userId, dependency, actorId } = {}) {
    if (writesEnabled !== true) throw failure('HIERARCHY_HEAD_WRITES_DISABLED', 403)
    const operation = requiredText(operationId, 'HIERARCHY_OPERATION_ID_INVALID')
    if (operation.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(operation)) throw failure('HIERARCHY_OPERATION_ID_INVALID', 400)
    const unit = requiredText(unitId, 'HIERARCHY_UNIT_ID_INVALID')
    if (!uuidPattern.test(unit)) throw failure('HIERARCHY_UNIT_ID_INVALID', 400)
    const user = requiredText(userId, 'HIERARCHY_USER_REQUIRED')
    const scope = requiredText(dependency, 'HIERARCHY_DEPENDENCY_REQUIRED', 80)
    if (!/^[A-Za-z0-9_-]+$/.test(scope)) throw failure('HIERARCHY_DEPENDENCY_INVALID', 400)
    const actor = requiredText(actorId, 'HIERARCHY_ACTOR_REQUIRED')
    const context = { operationId: operation, unitId: unit, userId: user, dependency: scope, actorId: actor }

    try {
      await record({ ...context, phase: 'INICIADA', action: 'OPERACION_INICIADA' })
    } catch (error) {
      throw failure('HIERARCHY_AUDIT_INITIATION_FAILED', error.status || 503, {
        operationId: operation,
        auditErrorCode: error.code || 'HIERARCHY_AUDIT_RECORD_FAILED',
      })
    }

    let assignment
    try {
      assignment = await repository.createAssignment({
        operationId: operation,
        unitId: unit,
        userId: user,
        dependency: scope,
        role: 'jefe-unidad',
        actorId: actor,
      })
    } catch (error) {
      return failPartial(error, context)
    }

    try {
      const completed = await record({ ...context, phase: 'COMPLETADA', action: 'JEFE_ASIGNADO', assignmentId: assignment.id })
      return { operationId: operation, status: 'COMPLETADA', assignment, auditEventId: completed.id }
    } catch (error) {
      return failPartial(Object.assign(error, { assignmentId: assignment.id }), context)
    }
  }

  return { assignHead }
}
