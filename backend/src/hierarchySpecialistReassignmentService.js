import { assertNoDocumentResponsibilities, withHierarchyChange } from './hierarchyResponsibilityGuard.js'
function failure(code, status = 503, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra })
}

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function requiredText(value, code, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw failure(code, 400)
  return value.trim()
}

function jsonObject(value) {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function createHierarchySpecialistReassignmentService({ repository, directory, auditRepository, responsibilityCheck, writesEnabled = false } = {}) {
  if (!repository || !directory || !auditRepository) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_DEPENDENCIES_REQUIRED', 500)

  async function listOperationEvents(dependency, operationId) {
    const events = []
    let page = 1
    let totalPages = 1
    while (page <= totalPages) {
      const result = await auditRepository.listEvents({ dependency, operationId, page, pageSize: 200 })
      events.push(...result.events.filter((event) => event.idOperacionEvento === operationId))
      totalPages = result.pagination.totalPages
      page += 1
      if (page > 501) throw failure('HIERARCHY_AUDIT_EVENT_LIMIT_EXCEEDED', 503)
    }
    return events
  }

  async function findPendingUserOperation(dependency, userId) {
    let page = 1
    let totalPages = 1
    const starts = []
    while (page <= totalPages) {
      const result = await auditRepository.listEvents({ dependency, page, pageSize: 200 })
      starts.push(...result.events.filter((event) => event.accionEvento === 'OPERACION_INICIADA' && event.faseEvento === 'INICIADA' &&
        jsonObject(event.datosDespuesEvento).kind === 'reasignacion-especialista' && jsonObject(event.datosDespuesEvento).userId === userId))
      totalPages = result.pagination.totalPages
      page += 1
      if (page > 501) throw failure('HIERARCHY_AUDIT_EVENT_LIMIT_EXCEEDED', 503)
    }
    for (const start of starts) {
      const events = await listOperationEvents(dependency, start.idOperacionEvento)
      if (!events.some((event) => event.faseEvento === 'COMPLETADA')) return start
    }
    return null
  }

  async function listPendingReassignments(dependency) {
    let page = 1
    let totalPages = 1
    const starts = []
    while (page <= totalPages) {
      const result = await auditRepository.listEvents({ dependency, page, pageSize: 200 })
      starts.push(...result.events.filter((event) => event.accionEvento === 'OPERACION_INICIADA' && event.faseEvento === 'INICIADA' &&
        jsonObject(event.datosDespuesEvento).kind === 'reasignacion-especialista'))
      totalPages = result.pagination.totalPages
      page += 1
      if (page > 501) throw failure('HIERARCHY_AUDIT_EVENT_LIMIT_EXCEEDED', 503)
    }
    const pending = []
    for (const start of starts) {
      const events = await listOperationEvents(dependency, start.idOperacionEvento)
      if (events.some((event) => event.faseEvento === 'COMPLETADA')) continue
      const before = jsonObject(start.datosAntesEvento)
      const after = jsonObject(start.datosDespuesEvento)
      pending.push({
        operationId: start.idOperacionEvento,
        userId: after.userId,
        sourceUnitId: before.sourceUnitId,
        destinationUnitId: after.destinationUnitId,
        status: events.some((event) => event.faseEvento === 'PARCIAL') ? 'PARCIAL' : 'INICIADA',
      })
    }
    return pending
  }

  async function assertNoPendingReassignment({ dependency, userId, operationId } = {}) {
    const pending = await findPendingUserOperation(dependency, userId)
    if (pending && pending.idOperacionEvento !== operationId) {
      throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_PENDING_RECONCILIATION', 409, {
        operationId: pending.idOperacionEvento,
        userId,
        sourceUnitId: jsonObject(pending.datosAntesEvento).sourceUnitId,
      })
    }
    return true
  }

  async function record(context, { phase, action, unitId, assignmentId, beforeData, afterData, errorCode, beforeRevision, afterRevision } = {}) {
    return auditRepository.createEvent({
      operationId: context.operationId,
      phase,
      action,
      dependency: context.dependency,
      actorId: context.actorId,
      unitId,
      assignmentId,
      userId: context.userId,
      beforeData,
      afterData,
      ...(errorCode ? { errorCode } : {}),
      ...(beforeRevision ? { beforeRevision } : {}),
      ...(afterRevision ? { afterRevision } : {}),
    })
  }

  async function failPartial(error, context, sourceAssignmentId, destinationAssignmentId) {
    const code = error.code || 'HIERARCHY_SPECIALIST_REASSIGNMENT_FAILED'
    try {
      const event = await record(context, {
        phase: 'PARCIAL', action: 'OPERACION_PARCIAL', unitId: context.sourceUnitId,
        assignmentId: destinationAssignmentId || sourceAssignmentId, errorCode: code,
        beforeData: { sourceUnitId: context.sourceUnitId, sourceAssignmentId },
        afterData: { kind: 'reasignacion-especialista', userId: context.userId, destinationUnitId: context.destinationUnitId,
          sourceAssignmentId, destinationAssignmentId, state: 'RECONCILIACION_REQUERIDA' },
      })
      throw failure(code, error.status || 503, {
        operationId: context.operationId, operationStatus: 'PARCIAL', userId: context.userId,
        sourceUnitId: context.sourceUnitId, destinationUnitId: context.destinationUnitId,
        ...(sourceAssignmentId ? { sourceAssignmentId } : {}),
        ...(destinationAssignmentId ? { destinationAssignmentId } : {}), partialAuditEventId: event.id,
      })
    } catch (auditError) {
      if (auditError?.code === code && auditError?.operationId === context.operationId) throw auditError
      throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_PARTIAL', 503, {
        operationId: context.operationId, operationStatus: 'PARCIAL', userId: context.userId,
        sourceUnitId: context.sourceUnitId, destinationUnitId: context.destinationUnitId,
        causeCode: code, auditErrorCode: auditError.code || 'HIERARCHY_AUDIT_RECORD_FAILED',
      })
    }
  }

  async function reassign({ operationId, userId, destinationUnitId, dependency, actorId, expectedRevision } = {}) {
    if (writesEnabled !== true) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENTS_DISABLED', 403)
    const operation = requiredText(operationId, 'HIERARCHY_OPERATION_ID_INVALID')
    if (operation.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(operation)) throw failure('HIERARCHY_OPERATION_ID_INVALID', 400)
    const user = requiredText(userId, 'HIERARCHY_USER_REQUIRED')
    const destinationId = requiredText(destinationUnitId, 'HIERARCHY_UNIT_ID_INVALID')
    if (!uuidPattern.test(destinationId)) throw failure('HIERARCHY_UNIT_ID_INVALID', 400)
    const scope = requiredText(dependency, 'HIERARCHY_DEPENDENCY_REQUIRED', 80)
    if (!/^[A-Za-z0-9_-]+$/.test(scope)) throw failure('HIERARCHY_DEPENDENCY_INVALID', 400)
    const actor = requiredText(actorId, 'HIERARCHY_ACTOR_REQUIRED')
    if (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedRevision))) {
      throw failure('HIERARCHY_REVISION_INVALID', 400)
    }

    const operationEvents = await listOperationEvents(scope, operation)
    const start = operationEvents.find((event) => event.accionEvento === 'OPERACION_INICIADA' && event.faseEvento === 'INICIADA' &&
      jsonObject(event.datosDespuesEvento).kind === 'reasignacion-especialista')
    if (operationEvents.length && !start) throw failure('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409)
    const prior = jsonObject(start?.datosDespuesEvento)
    const before = jsonObject(start?.datosAntesEvento)
    if (start && (prior.userId !== user || prior.destinationUnitId !== destinationId || !before.sourceAssignmentId || !before.sourceUnitId)) {
      throw failure('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409)
    }
    await assertNoPendingReassignment({ dependency: scope, userId: user, operationId: operation })
    const revisionBefore = await repository.getRevision()
    if (expectedRevision !== undefined && !start && expectedRevision !== revisionBefore) throw failure('HIERARCHY_REVISION_CONFLICT', 409)

    const { assignments: allAssignments } = await repository.listAssignments({ includeInactive: true })
    const dependencyAssignments = allAssignments.filter((item) => String(item.dependency || '').toLowerCase() === scope.toLowerCase())
    const foreignActive = allAssignments.find((item) => item.userId === user && item.role === 'especialista' && item.status === 'ACTIVA' &&
      String(item.dependency || '').toLowerCase() !== scope.toLowerCase())
    if (foreignActive) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_CROSS_DEPENDENCY_CONFLICT', 409)
    const active = dependencyAssignments.filter((item) => item.userId === user && item.role === 'especialista' && item.status === 'ACTIVA')
    let sourceAssignment
    if (start) {
      sourceAssignment = dependencyAssignments.find((item) => item.id === before.sourceAssignmentId && item.unitId === before.sourceUnitId &&
        item.userId === user && item.role === 'especialista')
      if (!sourceAssignment) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_STATE_CONFLICT', 409)
    } else {
      if (active.length !== 1) throw failure(active.length ? 'HIERARCHY_SPECIALIST_MULTIPLE_ACTIVE_UNITS' : 'HIERARCHY_SPECIALIST_ASSIGNMENT_NOT_FOUND', 409)
      sourceAssignment = active[0]
    }
    const sourceUnitId = start ? before.sourceUnitId : sourceAssignment.unitId
    if (sourceUnitId === destinationId) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_SAME_UNIT', 409)

    const [sourceUnit, destinationUnit] = await Promise.all([repository.getUnit(sourceUnitId), repository.getUnit(destinationId)])
    if (sourceUnit.dependency !== scope || sourceAssignment.dependency !== scope) throw failure('HIERARCHY_DEPENDENCY_MISMATCH', 403)
    if (destinationUnit.dependency !== scope) throw failure('HIERARCHY_DEPENDENCY_MISMATCH', 403)
    if (destinationUnit.status !== 'ACTIVA') throw failure('HIERARCHY_UNIT_INACTIVE', 409)
    if (!start && active[0].unitId === destinationId) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_SAME_UNIT', 409)

    const completedEvent = operationEvents.find((event) => event.faseEvento === 'COMPLETADA')
    if (completedEvent) {
      if (jsonObject(completedEvent.datosDespuesEvento).kind !== 'reasignacion-especialista') {
        throw failure('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409)
      }
      if (sourceAssignment.status !== 'INACTIVA' || active.length !== 1 || active[0].unitId !== destinationId) {
        throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_COMPLETION_CONFLICT', 409)
      }
      return { operationId: operation, status: 'COMPLETADA', userId: user, sourceUnitId, destinationUnitId: destinationId,
        sourceAssignmentId: sourceAssignment.id, assignment: active[0], auditEventId: completedEvent.id, reused: true }
    }

    const candidate = await directory.validateAssignmentCandidate(user, { dependency: scope, role: 'especialista' })
    if (candidate?.id !== user || candidate.enabled !== true || candidate.dependency !== scope || candidate.role !== 'especialista') {
      throw failure('HIERARCHY_DIRECTORY_VALIDATION_FAILED', 403)
    }

    if (start) {
      const stateCanResume = active.length === 0 || (active.length === 1 &&
        (active[0].id === sourceAssignment.id || active[0].unitId === destinationId))
      if (!stateCanResume) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_STATE_CONFLICT', 409)
    } else if (active.length !== 1 || active[0].id !== sourceAssignment.id) {
      throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_STATE_CONFLICT', 409)
    }

    const context = { operationId: operation, userId: user, sourceUnitId, destinationUnitId: destinationId, dependency: scope, actorId: actor }
    const responsibilityScope = { unitId: sourceUnitId, userId: user, dependency: scope, revision: revisionBefore }
    await assertNoDocumentResponsibilities(responsibilityCheck, responsibilityScope)
    const sourceAssignmentId = sourceAssignment.id
    let destinationAssignment
    if (!start) {
      try {
        await record(context, {
          phase: 'INICIADA', action: 'OPERACION_INICIADA', unitId: sourceUnitId, assignmentId: sourceAssignmentId,
          beforeRevision: revisionBefore,
          beforeData: { sourceUnitId, sourceAssignmentId, sourceStatus: sourceAssignment.status },
          afterData: { kind: 'reasignacion-especialista', userId: user, sourceUnitId, sourceAssignmentId, destinationUnitId: destinationId },
        })
      } catch (error) {
        throw failure('HIERARCHY_AUDIT_INITIATION_FAILED', error.status || 503, {
          operationId: operation, auditErrorCode: error.code || 'HIERARCHY_AUDIT_RECORD_FAILED',
        })
      }
    }
    try {
      let currentAssignments = (await repository.listAssignments({ dependency: scope, includeInactive: true })).assignments
      const currentSource = currentAssignments.find((item) => item.id === sourceAssignmentId)
      if (!currentSource) throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_STATE_CONFLICT', 409)
      if (currentSource.status === 'ACTIVA') {
        await assertNoDocumentResponsibilities(responsibilityCheck, responsibilityScope)
        await repository.deactivateAssignment({ assignmentId: sourceAssignmentId, dependency: scope, actorId: actor, operationId: `${operation}:deactivate` })
      } else if (currentSource.status !== 'INACTIVA') {
        throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_STATE_CONFLICT', 409)
      }
      await record(context, {
        phase: 'CAMBIO_APLICADO', action: 'ASIGNACION_DESACTIVADA', unitId: sourceUnitId, assignmentId: sourceAssignmentId,
        beforeData: { sourceUnitId, sourceAssignmentId, status: 'ACTIVA' },
        afterData: { sourceUnitId, sourceAssignmentId, status: 'INACTIVA', destinationUnitId: destinationId },
      })

      destinationAssignment = await repository.createAssignment({
        operationId: `${operation}:create`, unitId: destinationId, userId: user, dependency: scope, role: 'especialista', actorId: actor,
      })
      const { assignments: verifiedAll } = await repository.listAssignments({ dependency: scope, includeInactive: false })
      const verifiedActive = verifiedAll.filter((item) => item.userId === user && item.role === 'especialista' && item.status === 'ACTIVA')
      if (verifiedActive.length !== 1 || verifiedActive[0].id !== destinationAssignment.id || verifiedActive[0].unitId !== destinationId) {
        throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_FINAL_STATE_INVALID', 409)
      }
      const verifiedDestination = await repository.getUnit(destinationId)
      if (verifiedDestination.status !== 'ACTIVA' || verifiedDestination.dependency !== scope) {
        throw failure('HIERARCHY_SPECIALIST_REASSIGNMENT_FINAL_STATE_INVALID', 409)
      }
      await record(context, {
        phase: 'CAMBIO_APLICADO', action: 'ESPECIALISTA_REASIGNADO', unitId: destinationId, assignmentId: destinationAssignment.id,
        beforeData: { sourceUnitId, sourceAssignmentId, status: 'INACTIVA' },
        afterData: { destinationUnitId: destinationId, assignmentId: destinationAssignment.id, status: 'ACTIVA' },
      })
      const revisionAfter = await repository.getRevision()
      const completed = await record(context, {
        phase: 'COMPLETADA', action: 'OPERACION_COMPLETADA', unitId: destinationId, assignmentId: destinationAssignment.id,
        beforeRevision: start?.revisionAntesEvento || revisionBefore, afterRevision: revisionAfter,
        beforeData: { sourceUnitId, sourceAssignmentId },
        afterData: { kind: 'reasignacion-especialista', userId: user, sourceUnitId, sourceAssignmentId,
          destinationUnitId: destinationId, destinationAssignmentId: destinationAssignment.id, status: 'COMPLETADA' },
      })
      return { operationId: operation, status: 'COMPLETADA', userId: user, sourceUnitId, destinationUnitId: destinationId,
        sourceAssignmentId, assignment: verifiedActive[0], auditEventId: completed.id }
    } catch (error) {
      return failPartial(error, context, sourceAssignmentId, destinationAssignment?.id || error.assignmentId)
    }
  }

  return { reassign: input => withHierarchyChange(String(input?.dependency || '').toLowerCase(), () => reassign(input)), listPendingReassignments, assertNoPendingReassignment }
}
