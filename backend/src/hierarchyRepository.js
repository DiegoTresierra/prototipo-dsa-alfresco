import { createHash } from 'node:crypto'
import { createHierarchyServiceClient } from './hierarchyServiceClient.js'

const unitType = 'gdo:unidad'
const assignmentType = 'gdo:asignacion'
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const roles = new Set(['jefe-unidad', 'especialista'])
const statuses = new Set(['ACTIVA', 'INACTIVA'])
const sameDependency = (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()

function failure(code, status = 502, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra })
}

function text(value, code, { optional = false, max = 240 } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure(code, 400)
  return value.trim()
}

function operationName(kind, operationId) {
  const id = text(operationId, 'HIERARCHY_OPERATION_ID_INVALID', { max: 160 })
  return `GD_${kind}_OP_${createHash('sha256').update(id).digest('hex')}`
}

function readProperties(entry, type) {
  const properties = entry?.properties || {}
  const value = (name) => properties[`gdo:${name}`]
  if (type === unitType) {
    const unit = {
      id: entry.id,
      name: value('nombreUnidad'),
      dependency: value('codigoDependencia'),
      code: value('codigoUnidad') || '',
      description: value('descripcionUnidad') || '',
      status: value('estadoUnidad'),
      parentId: entry.parentId,
      nodeType: entry.nodeType,
      modifiedAt: entry.modifiedAt || null,
    }
    if (!unit.id || !unit.name || !unit.dependency || !statuses.has(unit.status)) throw failure('HIERARCHY_UNIT_PROPERTIES_INVALID', 502)
    return unit
  }
  const assignment = {
    id: entry.id,
    userId: value('idUsuario'),
    unitId: value('idUnidad'),
    dependency: value('dependenciaAsignacion'),
    role: value('rolAsignacion'),
    status: value('estadoAsignacion'),
    assignedBy: value('asignadoPor'),
    parentId: entry.parentId,
    nodeType: entry.nodeType,
    modifiedAt: entry.modifiedAt || null,
  }
  if (!assignment.id || !assignment.userId || !assignment.unitId || !assignment.dependency ||
      !roles.has(assignment.role) || !statuses.has(assignment.status) || !assignment.assignedBy) {
    throw failure('HIERARCHY_ASSIGNMENT_PROPERTIES_INVALID', 502)
  }
  return assignment
}

function canonicalRevision(entries) {
  const representation = entries.map((entry) => ({
    id: entry.id,
    nodeType: entry.nodeType,
    parentId: entry.parentId,
    name: entry.name,
    properties: entry.properties || {},
    modifiedAt: entry.modifiedAt || null,
  })).sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(representation)).digest('hex')
}

export function createHierarchyRepository(settings, {
  fetchImpl = globalThis.fetch,
  allowWrites = false,
  recordAuditEvent,
  validateAssignmentCandidate,
} = {}) {
  const service = createHierarchyServiceClient(settings, fetchImpl)
  const containerId = settings?.hierarchyService?.containerNodeId
  let containerPromise

  function assertConfigured() {
    if (settings?.hierarchyService?.storage !== 'alfresco') throw failure('HIERARCHY_STORAGE_MUST_BE_ALFRESCO', 503)
    if (!uuidPattern.test(containerId || '')) throw failure('HIERARCHY_CONTAINER_NODE_ID_INVALID', 503)
  }

  function assertWriteEnabled() {
    assertConfigured()
    if (typeof allowWrites === 'function' ? !allowWrites() : allowWrites !== true) throw failure('HIERARCHY_REPOSITORY_WRITES_DISABLED', 403)
  }

  async function getContainer() {
    assertConfigured()
    if (!containerPromise) {
      containerPromise = service.getNode(containerId).then((entry) => {
        const name = entry.name || entry.properties?.['cm:name']
        if (entry.id !== containerId || name !== 'GD_JERARQUIAS' || entry.nodeType !== 'cm:folder' || entry.isFolder !== true) {
          throw failure('HIERARCHY_CONTAINER_INVALID', 409)
        }
        return entry
      }).catch((error) => {
        containerPromise = undefined
        throw error
      })
    }
    return containerPromise
  }

  async function listAllChildren(parentId) {
    const entries = []
    const ids = new Set()
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const page = await service.listNodeChildren(parentId, { maxItems: 100, skipCount })
      for (const entry of page.entries) {
        if (ids.has(entry.id)) throw failure('HIERARCHY_PAGINATION_INVALID', 502)
        ids.add(entry.id)
      }
      entries.push(...page.entries)
      hasMoreItems = page.hasMoreItems
      if (hasMoreItems && page.entries.length === 0) throw failure('HIERARCHY_PAGINATION_INVALID', 502)
      skipCount += page.entries.length
      if (skipCount > 50_000) throw failure('HIERARCHY_NODE_LIMIT_EXCEEDED', 502)
    }
    return entries
  }

  async function listUnits({ dependency, includeInactive = true } = {}) {
    const container = await getContainer()
    const children = await listAllChildren(container.id)
    const units = children.filter((entry) => entry.nodeType === unitType).map((entry) => {
      if (entry.parentId !== container.id) throw failure('HIERARCHY_UNIT_PARENT_INVALID', 409)
      return readProperties(entry, unitType)
    }).filter((unit) => (!dependency || sameDependency(unit.dependency, dependency)) && (includeInactive || unit.status === 'ACTIVA'))
    return { units, revision: canonicalRevision(children) }
  }

  async function getUnit(unitId) {
    const container = await getContainer()
    const entry = await service.getNode(unitId)
    if (entry.nodeType !== unitType || entry.parentId !== container.id) throw failure('HIERARCHY_UNIT_OUT_OF_SCOPE', 403)
    return readProperties(entry, unitType)
  }

  async function getUnitAllowableOperations(unitId, dependency) {
    const container = await getContainer()
    const entry = await service.getNode(unitId)
    if (entry.nodeType !== unitType || entry.parentId !== container.id ||
        !sameDependency(entry.properties?.['gdo:codigoDependencia'], dependency)) {
      throw failure('HIERARCHY_UNIT_OUT_OF_SCOPE', 403)
    }
    return Array.isArray(entry.allowableOperations) ? entry.allowableOperations : []
  }

  async function listAssignments({ dependency, unitId, includeInactive = true } = {}) {
    const { units } = await listUnits({ dependency, includeInactive: true })
    const selectedUnits = unitId
      ? [units.find((unit) => unit.id === unitId) || await getUnit(unitId)]
      : units
    if (dependency && selectedUnits.some((unit) => !sameDependency(unit.dependency, dependency))) throw failure('HIERARCHY_DEPENDENCY_MISMATCH', 403)
    const assignments = []
    for (const unit of selectedUnits) {
      const children = await listAllChildren(unit.id)
      for (const entry of children) {
        if (entry.nodeType !== assignmentType) continue
        if (entry.parentId !== unit.id) throw failure('HIERARCHY_ASSIGNMENT_PARENT_INVALID', 409)
        const assignment = readProperties(entry, assignmentType)
        if (assignment.unitId !== unit.id || assignment.dependency !== unit.dependency) {
          throw failure('HIERARCHY_ASSIGNMENT_RELATION_INVALID', 409)
        }
        if (includeInactive || assignment.status === 'ACTIVA') assignments.push(assignment)
      }
    }
    return { assignments, revision: canonicalRevision(assignments) }
  }

  async function snapshotRevision() {
    const { units } = await listUnits({ includeInactive: true })
    const allNodes = [...units]
    for (const unit of units) {
      const children = await listAllChildren(unit.id)
      allNodes.push(...children.filter((entry) => entry.nodeType === assignmentType))
    }
    return canonicalRevision(allNodes)
  }

  async function getRevision() {
    return snapshotRevision()
  }

  async function assertExpectedRevision(expectedRevision) {
    if (expectedRevision === undefined) return
    if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
      throw failure('HIERARCHY_REVISION_INVALID', 400)
    }
    if (await snapshotRevision() !== expectedRevision) throw failure('HIERARCHY_REVISION_CONFLICT', 409)
  }

  async function emitAudit(action, actorId, dependency, targetNodeId, operationId, details = {}) {
    if (typeof recordAuditEvent !== 'function') return null
    const event = {
      action, actorId: text(actorId, 'HIERARCHY_ACTOR_REQUIRED', { max: 160 }), dependency,
      targetNodeId, operationId, occurredAt: new Date().toISOString(), details,
    }
    try {
      await recordAuditEvent(event)
      return event
    } catch {
      throw failure('HIERARCHY_AUDIT_RECORD_FAILED', 503, { partialCommit: true, operationId })
    }
  }

  async function findByOperation(parentId, name, type, expectedProperties) {
    const matches = (await listAllChildren(parentId)).filter((entry) => entry.name === name)
    if (!matches.length) return null
    if (matches.length !== 1) throw failure('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409)
    const existing = matches[0]
    const isAssignmentReplay = type === assignmentType &&
      Object.entries(expectedProperties).filter(([key]) => key !== 'gdo:estadoAsignacion')
        .every(([key, value]) => existing.properties?.[key] === value) && statuses.has(existing.properties?.['gdo:estadoAsignacion'])
    const same = existing.nodeType === type && existing.parentId === parentId &&
      (isAssignmentReplay || Object.entries(expectedProperties).every(([key, value]) => existing.properties?.[key] === value))
    if (!same) throw failure('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409)
    const verified = await service.getNode(existing.id)
    if (verified.nodeType !== type || verified.parentId !== parentId ||
        !(isAssignmentReplay || Object.entries(expectedProperties).every(([key, value]) => verified.properties?.[key] === value))) {
      throw failure('HIERARCHY_OPERATION_DUPLICATE_CONFLICT', 409)
    }
    return { ...verified, reused: true }
  }

  async function createUnit({ operationId, dependency, name, code = '', description = '', actorId, expectedRevision } = {}) {
    assertWriteEnabled()
    const container = await getContainer()
    await assertExpectedRevision(expectedRevision)
    const dependencyId = text(dependency, 'HIERARCHY_DEPENDENCY_REQUIRED', { max: 80 })
    const unitName = text(name, 'HIERARCHY_UNIT_NAME_REQUIRED')
    const unitCode = text(code, 'HIERARCHY_UNIT_CODE_INVALID', { optional: true, max: 80 })
    const unitDescription = text(description, 'HIERARCHY_UNIT_DESCRIPTION_INVALID', { optional: true, max: 1000 })
    const nodeName = operationName('UNIT', operationId)
    const properties = {
      'gdo:codigoDependencia': dependencyId,
      'gdo:codigoUnidad': unitCode,
      'gdo:descripcionUnidad': unitDescription,
      'gdo:estadoUnidad': 'ACTIVA',
      'gdo:nombreUnidad': unitName,
    }
    const existing = await findByOperation(container.id, nodeName, unitType, properties)
    if (existing) return { ...readProperties(existing, unitType), reused: true }
    const { units } = await listUnits({ dependency: dependencyId, includeInactive: true })
    const normalizedName = unitName.normalize('NFKC').trim().toLocaleLowerCase('es')
    const normalizedCode = unitCode.normalize('NFKC').trim().toLocaleLowerCase('es')
    const duplicateName = units.some((unit) => unit.name.normalize('NFKC').trim().toLocaleLowerCase('es') === normalizedName)
    const duplicateCode = Boolean(normalizedCode && units.some((unit) => unit.code.normalize('NFKC').trim().toLocaleLowerCase('es') === normalizedCode))
    if (duplicateName || duplicateCode) {
      throw failure(duplicateCode ? 'HIERARCHY_UNIT_CODE_DUPLICATE' : 'HIERARCHY_UNIT_NAME_DUPLICATE', 409)
    }
    if (!container.allowableOperations?.includes('create')) throw failure('HIERARCHY_CONTAINER_CREATE_FORBIDDEN', 403)
    const created = await service.createChild(container.id, { name: nodeName, nodeType: unitType, properties })
    try {
      const verified = await service.getNode(created.id)
      if (verified.nodeType !== unitType || verified.parentId !== container.id || verified.name !== nodeName ||
          !Object.entries(properties).every(([key, value]) => verified.properties?.[key] === value)) {
        throw failure('HIERARCHY_WRITE_VERIFICATION_FAILED', 409)
      }
      const result = readProperties(verified, unitType)
      await emitAudit('UNIT_CREATED', actorId, dependencyId, result.id, operationId, { name: unitName, code: unitCode })
      return { ...result, reused: false }
    } catch (error) {
      if (error.partialCommit) throw error
      throw failure(error.code || 'HIERARCHY_WRITE_VERIFICATION_FAILED', error.status || 409, { partialCommit: true, operationId })
    }
  }

  async function createAssignment({ operationId, unitId, userId, dependency, role, actorId, expectedRevision } = {}) {
    assertWriteEnabled()
    if (typeof validateAssignmentCandidate !== 'function') throw failure('HIERARCHY_DIRECTORY_VALIDATOR_REQUIRED', 503)
    await assertExpectedRevision(expectedRevision)
    const actor = text(actorId, 'HIERARCHY_ACTOR_REQUIRED', { max: 160 })
    const user = text(userId, 'HIERARCHY_USER_REQUIRED', { max: 160 })
    const unit = await getUnit(unitId)
    if (unit.status !== 'ACTIVA') throw failure('HIERARCHY_UNIT_INACTIVE', 409)
    const dependencyId = text(dependency, 'HIERARCHY_DEPENDENCY_REQUIRED', { max: 80 })
    if (unit.dependency !== dependencyId) throw failure('HIERARCHY_DEPENDENCY_MISMATCH', 403)
    if (!roles.has(role)) throw failure('HIERARCHY_ASSIGNMENT_ROLE_INVALID', 400)
    const candidate = await validateAssignmentCandidate(user, { dependency: dependencyId, role })
    if (candidate?.id !== user || candidate.enabled !== true || candidate.dependency !== dependencyId || candidate.role !== role) {
      throw failure('HIERARCHY_DIRECTORY_VALIDATION_FAILED', 403)
    }
    const nodeName = operationName('ASSIGNMENT', operationId)
    const properties = {
      'gdo:idUsuario': user,
      'gdo:idUnidad': unit.id,
      'gdo:dependenciaAsignacion': dependencyId,
      'gdo:rolAsignacion': role,
      'gdo:estadoAsignacion': 'ACTIVA',
      'gdo:asignadoPor': actor,
    }
    const existing = await findByOperation(unit.id, nodeName, assignmentType, properties)
    if (existing) return { ...readProperties(existing, assignmentType), reused: true }
    const { assignments } = await listAssignments({ includeInactive: false })
    if (role === 'jefe-unidad' && assignments.some((item) => item.unitId === unit.id && item.role === role)) {
      throw failure('HIERARCHY_ACTIVE_UNIT_HEAD_EXISTS', 409)
    }
    if (role === 'especialista' && assignments.some((item) => item.userId === user && item.role === role)) {
      throw failure('HIERARCHY_SPECIALIST_ALREADY_ASSIGNED', 409)
    }
    const unitNode = await service.getNode(unit.id)
    if (!unitNode.allowableOperations?.includes('create')) throw failure('HIERARCHY_UNIT_CREATE_FORBIDDEN', 403)
    const created = await service.createChild(unit.id, { name: nodeName, nodeType: assignmentType, properties })
    try {
      const verified = await service.getNode(created.id)
      if (verified.nodeType !== assignmentType || verified.parentId !== unit.id || verified.name !== nodeName ||
          !Object.entries(properties).every(([key, value]) => verified.properties?.[key] === value)) {
        throw failure('HIERARCHY_WRITE_VERIFICATION_FAILED', 409)
      }
      const result = readProperties(verified, assignmentType)
      await emitAudit('ASSIGNMENT_CREATED', actor, dependencyId, result.id, operationId, { userId: user, unitId: unit.id, role })
      return { ...result, reused: false }
    } catch (error) {
      if (error.partialCommit) throw error
      throw failure(error.code || 'HIERARCHY_WRITE_VERIFICATION_FAILED', error.status || 409, { partialCommit: true, operationId })
    }
  }

  async function updateUnit({ unitId, dependency, changes = {}, expectedRevision } = {}) {
    assertWriteEnabled()
    await assertExpectedRevision(expectedRevision)
    const unit = await getUnit(unitId)
    if (!sameDependency(unit.dependency, dependency)) throw failure('HIERARCHY_DEPENDENCY_MISMATCH', 403)
    if (unit.status !== 'ACTIVA') throw failure('HIERARCHY_UNIT_INACTIVE', 409)
    const allowedChanges = new Set(['name', 'code', 'description'])
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some((key) => !allowedChanges.has(key))) {
      throw failure('HIERARCHY_UNIT_CHANGE_FIELDS_INVALID', 400)
    }
    const propertyNames = { name: 'nombreUnidad', code: 'codigoUnidad', description: 'descripcionUnidad' }
    const properties = {}
    if (Object.hasOwn(changes, 'name')) properties['gdo:nombreUnidad'] = text(changes.name, 'HIERARCHY_UNIT_NAME_REQUIRED')
    if (Object.hasOwn(changes, 'code')) properties['gdo:codigoUnidad'] = text(changes.code, 'HIERARCHY_UNIT_CODE_INVALID', { optional: true, max: 80 })
    if (Object.hasOwn(changes, 'description')) properties['gdo:descripcionUnidad'] = text(changes.description, 'HIERARCHY_UNIT_DESCRIPTION_INVALID', { optional: true, max: 1000 })
    if (!Object.keys(properties).length) throw failure('HIERARCHY_UNIT_CHANGES_REQUIRED', 400)
    const currentValues = { name: unit.name, code: unit.code, description: unit.description }
    const nextValues = { ...currentValues, ...Object.fromEntries(Object.keys(changes).map((key) => [key, properties[`gdo:${propertyNames[key]}`]])) }
    if (Object.entries(nextValues).every(([key, value]) => currentValues[key] === value)) return { ...unit, reused: true, noChanges: true }
    const node = await service.getNode(unitId)
    if (!node.allowableOperations?.includes('update')) throw failure('HIERARCHY_UNIT_UPDATE_FORBIDDEN', 403)
    const changedProperties = Object.fromEntries(Object.entries(properties).filter(([key, value]) => node.properties?.[key] !== value))
    if (!Object.keys(changedProperties).length) return { ...unit, reused: true, noChanges: true }
    try {
      await service.updateNode(unitId, changedProperties)
    } catch (error) {
      if (error.code !== 'HIERARCHY_WRITE_OUTCOME_UNKNOWN') throw error
      try {
        const observed = await service.getNode(unitId)
        if (Object.entries(changedProperties).every(([key, value]) => observed.properties?.[key] === value)) {
          return { ...readProperties(observed, unitType), outcomeRecovered: true }
        }
        if (Object.entries(changedProperties).every(([key]) => observed.properties?.[key] === node.properties?.[key])) throw error
        throw failure('HIERARCHY_UNIT_UPDATE_OUTCOME_PARTIAL', 503, { partialCommit: true })
      } catch (readError) {
        if (readError === error) throw error
        if (readError.partialCommit) throw readError
        throw failure('HIERARCHY_UNIT_UPDATE_OUTCOME_UNKNOWN', 503, { partialCommit: true })
      }
    }
    try {
      const verified = await service.getNode(unitId)
      if (verified.id !== unit.id || verified.nodeType !== unitType || verified.parentId !== unit.parentId ||
          verified.properties?.['gdo:codigoDependencia'] !== unit.dependency || verified.properties?.['gdo:estadoUnidad'] !== unit.status ||
          Object.entries(changedProperties).some(([key, value]) => verified.properties?.[key] !== value)) {
        throw failure('HIERARCHY_WRITE_VERIFICATION_FAILED', 409)
      }
      const result = readProperties(verified, unitType)
      return result
    } catch (error) {
      if (error.partialCommit) throw error
      throw failure(error.code || 'HIERARCHY_WRITE_VERIFICATION_FAILED', error.status || 409, { partialCommit: true })
    }
  }

  async function deactivateAssignment({ assignmentId, dependency, actorId, operationId, expectedRevision } = {}) {
    assertWriteEnabled()
    await assertExpectedRevision(expectedRevision)
    const { assignments } = await listAssignments({ includeInactive: true })
    const assignment = assignments.find((item) => item.id === assignmentId)
    if (!assignment) throw failure('HIERARCHY_ASSIGNMENT_NOT_FOUND', 404)
    if (assignment.dependency !== dependency) throw failure('HIERARCHY_DEPENDENCY_MISMATCH', 403)
    if (assignment.status === 'INACTIVA') return { ...assignment, reused: true }
    const node = await service.getNode(assignmentId)
    if (!node.allowableOperations?.includes('update')) throw failure('HIERARCHY_ASSIGNMENT_UPDATE_FORBIDDEN', 403)
    await service.updateNode(assignmentId, { 'gdo:estadoAsignacion': 'INACTIVA' })
    try {
      const verified = await service.getNode(assignmentId)
      if (verified.properties?.['gdo:estadoAsignacion'] !== 'INACTIVA') throw failure('HIERARCHY_WRITE_VERIFICATION_FAILED', 409)
      const result = readProperties(verified, assignmentType)
      await emitAudit('ASSIGNMENT_DEACTIVATED', actorId, dependency, assignmentId, operationId, { userId: result.userId, unitId: result.unitId, role: result.role })
      return { ...result, reused: false }
    } catch (error) {
      if (error.partialCommit) throw error
      throw failure(error.code || 'HIERARCHY_WRITE_VERIFICATION_FAILED', error.status || 409, { partialCommit: true, operationId })
    }
  }

  return { getContainer, listUnits, getUnit, getUnitAllowableOperations, listAssignments, getRevision, createUnit, createAssignment, updateUnit, deactivateAssignment }
}

export { unitType as HIERARCHY_UNIT_TYPE, assignmentType as HIERARCHY_ASSIGNMENT_TYPE }
