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

export function createHierarchyHeadChangeService({ repository, directory, auditRepository, responsibilityCheck, writesEnabled = false } = {}) {
  if (!repository || !directory || !auditRepository) throw failure('HIERARCHY_HEAD_CHANGE_DEPENDENCIES_REQUIRED', 500)

  async function listOperationEvents(dependency, operationId) {
    const all = []
    let page = 1
    let totalPages = 1
    while (page <= totalPages) {
      const result = await auditRepository.listEvents({ dependency, page, pageSize: 200 })
      all.push(...result.events.filter((event) => event.idOperacionEvento === operationId))
      totalPages = result.pagination.totalPages
      page += 1
      if (page > 501) throw failure('HIERARCHY_AUDIT_EVENT_LIMIT_EXCEEDED', 503)
    }
    return all
  }

  async function findPendingUnitOperation(dependency, unitId) {
    const starts = []
    let page = 1
    let totalPages = 1
    while (page <= totalPages) {
      const result = await auditRepository.listEvents({ dependency, page, pageSize: 200 })
      starts.push(...result.events.filter((event) => event.accionEvento === 'OPERACION_INICIADA' && event.faseEvento === 'INICIADA' &&
        jsonObject(event.datosDespuesEvento).kind === 'cambio-jefe' && jsonObject(event.datosDespuesEvento).unitId === unitId))
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

  async function listPendingChanges(dependency) {
    const starts = []
    let page = 1
    let totalPages = 1
    while (page <= totalPages) {
      const result = await auditRepository.listEvents({ dependency, page, pageSize: 200 })
      starts.push(...result.events.filter((event) => event.accionEvento === 'OPERACION_INICIADA' && event.faseEvento === 'INICIADA' &&
        jsonObject(event.datosDespuesEvento).kind === 'cambio-jefe'))
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
        unitId: after.unitId,
        previousHeadUserId: before.currentHeadUserId || after.currentHeadUserId,
        newHeadUserId: after.newHeadUserId,
        status: events.some((event) => event.faseEvento === 'PARCIAL') ? 'PARCIAL' : 'INICIADA',
      })
    }
    return pending
  }

  async function assertNoPendingChange({ dependency, unitId, operationId } = {}) {
    const pending = await findPendingUnitOperation(dependency, unitId)
    if (pending && pending.idOperacionEvento !== operationId) {
      throw failure('HIERARCHY_HEAD_CHANGE_PENDING_RECONCILIATION', 409, { operationId: pending.idOperacionEvento, unitId })
    }
    return true
  }

  async function record(context, { phase, action, assignmentId, userId, errorCode, beforeData, afterData, beforeRevision, afterRevision } = {}) {
    return auditRepository.createEvent({
      operationId: context.operationId,
      phase,
      action,
      dependency: context.dependency,
      actorId: context.actorId,
      unitId: context.unitId,
      ...(assignmentId ? { assignmentId } : {}),
      ...((userId || context.currentHeadUserId) ? { userId: userId || context.currentHeadUserId } : {}),
      beforeData,
      afterData,
      ...(errorCode ? { errorCode } : {}),
      ...(beforeRevision ? { beforeRevision } : {}),
      ...(afterRevision ? { afterRevision } : {}),
    })
  }

  async function recordPartial(error, context, { assignmentId } = {}) {
    const code = error.code || 'HIERARCHY_HEAD_CHANGE_FAILED'
    try {
      const event = await record(context, {
        phase: 'PARCIAL', action: 'OPERACION_PARCIAL', assignmentId, errorCode: code,
        userId: context.newHeadUserId,
        beforeData: { unitId: context.unitId, currentHeadUserId: context.currentHeadUserId },
        afterData: { kind: 'cambio-jefe', unitId: context.unitId, currentHeadUserId: context.currentHeadUserId, newHeadUserId: context.newHeadUserId, state: 'RECONCILIACION_REQUERIDA' },
      })
      throw failure(code, error.status || 503, {
        operationId: context.operationId,
        operationStatus: 'PARCIAL',
        unitId: context.unitId,
        currentHeadUserId: context.currentHeadUserId,
        newHeadUserId: context.newHeadUserId,
        ...(assignmentId ? { assignmentId } : {}),
        partialAuditEventId: event.id,
      })
    } catch (auditError) {
      if (auditError?.code === code && auditError?.operationId === context.operationId) throw auditError
      throw failure('HIERARCHY_HEAD_CHANGE_PARTIAL', 503, {
        operationId: context.operationId,
        operationStatus: 'PARCIAL',
        unitId: context.unitId,
        currentHeadUserId: context.currentHeadUserId,
        newHeadUserId: context.newHeadUserId,
        causeCode: code,
        auditErrorCode: auditError.code || 'HIERARCHY_AUDIT_RECORD_FAILED',
      })
    }
  }

  async function changeHead({ operationId, unitId, newHeadUserId, dependency, actorId, expectedRevision } = {}) {
    if (writesEnabled !== true) throw failure('HIERARCHY_HEAD_CHANGES_DISABLED', 403)
    const operation = requiredText(operationId, 'HIERARCHY_OPERATION_ID_INVALID')
    if (operation.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(operation)) throw failure('HIERARCHY_OPERATION_ID_INVALID', 400)
    const unitIdValue = requiredText(unitId, 'HIERARCHY_UNIT_ID_INVALID')
    if (!uuidPattern.test(unitIdValue)) throw failure('HIERARCHY_UNIT_ID_INVALID', 400)
    const newHead = requiredText(newHeadUserId, 'HIERARCHY_USER_REQUIRED')
    const scope = requiredText(dependency, 'HIERARCHY_DEPENDENCY_REQUIRED', 80)
    if (!/^[A-Za-z0-9_-]+$/.test(scope)) throw failure('HIERARCHY_DEPENDENCY_INVALID', 400)
    const actor = requiredText(actorId, 'HIERARCHY_ACTOR_REQUIRED')
    if (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedRevision))) {
      throw failure('HIERARCHY_REVISION_INVALID', 400)
    }

    const unit = await repository.getUnit(unitIdValue)
    if (unit.status !== 'ACTIVA') throw failure('HIERARCHY_UNIT_INACTIVE', 409)
    if (unit.dependency !== scope) throw failure('HIERARCHY_DEPENDENCY_MISMATCH', 403)

    const revisionBefore = await repository.getRevision()
    const { assignments: allAssignments } = await repository.listAssignments({ dependency: scope, includeInactive: true })
    const activeHeadsForUnit = allAssignments.filter((item) => item.unitId === unitIdValue && item.role === 'jefe-unidad' && item.status === 'ACTIVA')
    const operationEvents = await listOperationEvents(scope, operation)
    const startEvent = operationEvents.find((event) => event.accionEvento === 'OPERACION_INICIADA' && event.faseEvento === 'INICIADA')
    const existingOperationContext = jsonObject(startEvent?.datosDespuesEvento)
    const originalState = jsonObject(startEvent?.datosAntesEvento)
    if (startEvent && (existingOperationContext.kind !== 'cambio-jefe' || existingOperationContext.unitId !== unitIdValue ||
        existingOperationContext.currentHeadUserId !== originalState.currentHeadUserId || existingOperationContext.newHeadUserId !== newHead)) {
      throw failure('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409)
    }
    if (expectedRevision !== undefined && !startEvent && expectedRevision !== revisionBefore) throw failure('HIERARCHY_REVISION_CONFLICT', 409)
    await assertNoPendingChange({ dependency: scope, unitId: unitIdValue, operationId: operation })

    let currentHead
    if (startEvent) {
      const previousUserId = originalState.currentHeadUserId || existingOperationContext.currentHeadUserId
      currentHead = allAssignments.find((item) => item.unitId === unitIdValue && item.role === 'jefe-unidad' && item.userId === previousUserId)
      if (!currentHead) throw failure('HIERARCHY_HEAD_CHANGE_STATE_CONFLICT', 409)
      if (activeHeadsForUnit.length > 1 || activeHeadsForUnit.some((item) => item.userId !== previousUserId && item.userId !== newHead)) {
        throw failure('HIERARCHY_ACTIVE_UNIT_HEAD_CONFLICT', 409)
      }
    } else {
      if (activeHeadsForUnit.length !== 1) throw failure(activeHeadsForUnit.length ? 'HIERARCHY_ACTIVE_UNIT_HEAD_CONFLICT' : 'HIERARCHY_ACTIVE_UNIT_HEAD_REQUIRED', 409)
      currentHead = activeHeadsForUnit[0]
      if (currentHead.userId === newHead) throw failure('HIERARCHY_HEAD_UNCHANGED', 409)
    }

    const context = {
      operationId: operation, unitId: unitIdValue, dependency: scope, actorId: actor,
      currentHeadUserId: currentHead.userId, newHeadUserId: newHead,
    }
    const alreadyCompleted = operationEvents.some((event) => event.faseEvento === 'COMPLETADA')
    if (alreadyCompleted) {
      const { assignments } = await repository.listAssignments({ unitId: unitIdValue, includeInactive: false })
      const activeHeads = assignments.filter((item) => item.role === 'jefe-unidad' && item.status === 'ACTIVA')
      if (activeHeads.length !== 1 || activeHeads[0].userId !== newHead) throw failure('HIERARCHY_HEAD_CHANGE_COMPLETION_CONFLICT', 409)
      return { operationId: operation, status: 'COMPLETADA', unitId: unitIdValue, previousHeadUserId: currentHead.userId, newHeadUserId: newHead, assignment: activeHeads[0], auditEventId: operationEvents.find((event) => event.faseEvento === 'COMPLETADA')?.id, reused: true }
    }

    const candidate = await directory.validateAssignmentCandidate(newHead, { dependency: scope, role: 'jefe-unidad' })
    if (candidate?.id !== newHead || candidate.enabled !== true || candidate.dependency !== scope || candidate.role !== 'jefe-unidad') {
      throw failure('HIERARCHY_DIRECTORY_VALIDATION_FAILED', 403)
    }
    const otherActiveHeadAssignment = allAssignments.find((item) => item.role === 'jefe-unidad' && item.status === 'ACTIVA' &&
      item.userId === newHead && item.unitId !== unitIdValue)
    if (otherActiveHeadAssignment) throw failure('HIERARCHY_HEAD_ALREADY_ASSIGNED_TO_OTHER_UNIT', 409)
    if (allAssignments.some((item) => item.role === 'especialista' && item.status === 'ACTIVA' && item.userId === newHead)) {
      throw failure('HIERARCHY_USER_HAS_INCOMPATIBLE_ACTIVE_ASSIGNMENT', 409)
    }

    const responsibilityScope = { unitId: unitIdValue, userId: currentHead.userId, dependency: scope, revision: revisionBefore }
    await assertNoDocumentResponsibilities(responsibilityCheck, responsibilityScope)
    const beforeData = { unitId: unitIdValue, currentHeadUserId: currentHead.userId }
    const afterData = { kind: 'cambio-jefe', unitId: unitIdValue, currentHeadUserId: currentHead.userId, newHeadUserId: newHead }
    const operationRevisionBefore = startEvent?.revisionAntesEvento || revisionBefore
    let changedAssignmentId = currentHead.id
    try {
      if (!startEvent) {
        await record(context, { phase: 'INICIADA', action: 'OPERACION_INICIADA', beforeData, afterData, beforeRevision: operationRevisionBefore })
      }
    } catch (error) {
      throw failure('HIERARCHY_AUDIT_INITIATION_FAILED', error.status || 503, { operationId: operation })
    }

    try {
      let activeAssignments = (await repository.listAssignments({ unitId: unitIdValue, includeInactive: true })).assignments
      let current = activeAssignments.find((item) => item.id === currentHead.id)
      let replacement = activeAssignments.find((item) => item.role === 'jefe-unidad' && item.userId === newHead)

      if (current?.status === 'ACTIVA') {
        await assertNoDocumentResponsibilities(responsibilityCheck, responsibilityScope)
        await repository.deactivateAssignment({ assignmentId: current.id, dependency: scope, actorId: actor, operationId: `${operation}:deactivate` })
      } else if (!current || current.status !== 'INACTIVA') {
        throw failure('HIERARCHY_HEAD_CHANGE_STATE_CONFLICT', 409)
      }
      await record(context, {
        phase: 'CAMBIO_APLICADO', action: 'JEFE_DESACTIVADO', assignmentId: current.id,
        beforeData: { assignmentId: current.id, userId: current.userId, status: 'ACTIVA' },
        afterData: { assignmentId: current.id, userId: current.userId, status: 'INACTIVA', replacementUserId: newHead },
      })

      if (!replacement || replacement.status !== 'ACTIVA') {
        replacement = await repository.createAssignment({
          operationId: `${operation}:create`, unitId: unitIdValue, userId: newHead, dependency: scope, role: 'jefe-unidad', actorId: actor,
        })
      }
      changedAssignmentId = replacement.id
      await record(context, {
        phase: 'CAMBIO_APLICADO', action: 'JEFE_ASIGNADO', assignmentId: replacement.id,
        userId: newHead,
        beforeData: { unitId: unitIdValue, currentHeadUserId: currentHead.userId },
        afterData: { unitId: unitIdValue, newHeadUserId: newHead, assignmentId: replacement.id, status: 'ACTIVA' },
      })

      const verifiedUnit = await repository.getUnit(unitIdValue)
      const verified = await repository.listAssignments({ unitId: unitIdValue, includeInactive: false })
      const activeHeads = verified.assignments.filter((item) => item.role === 'jefe-unidad' && item.status === 'ACTIVA')
      if (verifiedUnit.status !== 'ACTIVA' || verifiedUnit.dependency !== scope || activeHeads.length !== 1 ||
          activeHeads[0].id !== replacement.id || activeHeads[0].userId !== newHead) {
        throw failure('HIERARCHY_HEAD_CHANGE_FINAL_STATE_INVALID', 409)
      }
      const revisionAfter = await repository.getRevision()
      const completed = await record(context, {
        phase: 'COMPLETADA', action: 'OPERACION_COMPLETADA', assignmentId: replacement.id,
        userId: newHead,
        beforeData, afterData: { ...afterData, status: 'COMPLETADA', assignmentId: replacement.id },
        beforeRevision: operationRevisionBefore, afterRevision: revisionAfter,
      })
      return {
        operationId: operation, status: 'COMPLETADA', unitId: unitIdValue,
        previousHeadUserId: currentHead.userId, newHeadUserId: newHead, assignment: activeHeads[0], auditEventId: completed.id,
      }
    } catch (error) {
      return recordPartial(error, context, { assignmentId: error.assignmentId || changedAssignmentId })
    }
  }

  return { changeHead: input => withHierarchyChange(String(input?.dependency || '').toLowerCase(), () => changeHead(input)), listPendingChanges, assertNoPendingChange }
}
