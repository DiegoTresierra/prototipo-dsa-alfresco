function failure(code, status = 503) {
  return Object.assign(new Error(code), { code, status })
}

function mappedDependency(dependencies, dependency) {
  return Object.keys(dependencies || {}).find((key) => key.toLowerCase() === String(dependency || '').toLowerCase()) || null
}

function sameDependency(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()
}

function toAssignment(record, unit, unitHeadUserId = null) {
  const laneId = record.role === 'jefe-unidad' ? 'jefes' : 'especialistas'
  return {
    laneId,
    userId: record.userId,
    dependency: String(record.dependency).toLowerCase(),
    updatedAt: record.modifiedAt || null,
    updatedBy: record.assignedBy,
    unitId: unit.id,
    unitName: unit.name,
    unitCode: unit.code || '',
    ...(laneId === 'especialistas' && unitHeadUserId ? { unitHeadUserId } : {}),
  }
}

export function createHierarchyReadService({ repository, directory, groupMappings }) {
  if (!repository || !directory) throw failure('HIERARCHY_READ_DEPENDENCIES_REQUIRED', 500)

  async function readDependency(dependency) {
    const normalizedDependency = String(dependency || '').trim().toLowerCase()
    const directoryDependency = mappedDependency(groupMappings?.dependencies, normalizedDependency)
    if (!normalizedDependency || !directoryDependency) throw failure('HIERARCHY_DEPENDENCY_MAPPING_UNAVAILABLE', 503)

    const revisionBefore = typeof repository.getRevision === 'function' ? await repository.getRevision() : null
    const [{ units: allUnits }, { assignments: allAssignments }, heads, specialists] = await Promise.all([
      repository.listUnits({ dependency: normalizedDependency, includeInactive: false }),
      repository.listAssignments({ dependency: normalizedDependency, includeInactive: false }),
      directory.listCandidates({ dependency: directoryDependency, role: 'jefe-unidad' }),
      directory.listCandidates({ dependency: directoryDependency, role: 'especialista' }),
    ])
    const revision = typeof repository.getRevision === 'function' ? await repository.getRevision() : null
    if (revisionBefore !== revision) throw failure('HIERARCHY_REVISION_CONFLICT', 409)

    const units = allUnits.filter((unit) => sameDependency(unit.dependency, normalizedDependency) && unit.status === 'ACTIVA')
    const unitsById = new Map(units.map((unit) => [unit.id, unit]))
    const assignments = allAssignments.filter((assignment) =>
      sameDependency(assignment.dependency, normalizedDependency) &&
      assignment.status === 'ACTIVA' && unitsById.has(assignment.unitId))
    const liveCandidates = [...heads, ...specialists]
    if (assignments.some(assignment => !liveCandidates.some(candidate =>
      candidate.id === assignment.userId && candidate.enabled === true &&
      candidate.role === assignment.role && sameDependency(candidate.dependency, normalizedDependency)))) {
      throw failure('HIERARCHY_ASSIGNMENT_MEMBERSHIP_INVALID', 409)
    }
    const assignmentsByUnit = new Map()
    const activeSpecialistUnit = new Map()
    for (const assignment of assignments) {
      if (!assignmentsByUnit.has(assignment.unitId)) assignmentsByUnit.set(assignment.unitId, [])
      assignmentsByUnit.get(assignment.unitId).push(assignment)
      if (assignment.role === 'especialista') {
        if (activeSpecialistUnit.has(assignment.userId)) throw failure('HIERARCHY_SPECIALIST_MULTIPLE_ACTIVE_UNITS', 409)
        activeSpecialistUnit.set(assignment.userId, assignment.unitId)
      }
    }

    const headByUnit = new Map()
    const headUnitByUser = new Map()
    for (const unit of units) {
      const activeHeads = (assignmentsByUnit.get(unit.id) || []).filter((assignment) => assignment.role === 'jefe-unidad')
      if (activeHeads.length > 1) throw failure('HIERARCHY_UNIT_MULTIPLE_ACTIVE_HEADS', 409)
      if (activeHeads.length === 1) {
        const head = activeHeads[0]
        if (headUnitByUser.has(head.userId)) throw failure('HIERARCHY_HEAD_MULTIPLE_ACTIVE_UNITS', 409)
        headByUnit.set(unit.id, head.userId)
        headUnitByUser.set(head.userId, unit)
      }
    }

    const mappedAssignments = assignments.map((assignment) => {
      const unit = unitsById.get(assignment.unitId)
      const headUserId = assignment.role === 'especialista' ? headByUnit.get(unit.id) : null
      return toAssignment(assignment, unit, headUserId)
    })
    const candidates = [...heads, ...specialists]
      .filter((candidate) => candidate.enabled === true && sameDependency(candidate.dependency, normalizedDependency))
      .map((candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName || candidate.id,
        dependency: normalizedDependency,
        functionalRole: candidate.role,
        unit: candidate.role === 'jefe-unidad' && headUnitByUser.has(candidate.id)
          ? {
              id: headUnitByUser.get(candidate.id).id,
              name: headUnitByUser.get(candidate.id).name,
              code: headUnitByUser.get(candidate.id).code || '',
              dependency: normalizedDependency,
            }
          : null,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'es'))

    return {
      units: units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        code: unit.code || '',
        description: unit.description || '',
        dependency: normalizedDependency,
        status: unit.status,
      })),
      recipients: candidates,
      assignments: mappedAssignments,
      ...(revision ? { revision } : {}),
    }
  }

  return { readDependency }
}

export function hierarchyStorageMode(config) {
  const mode = String(config?.hierarchyReadStorage || 'alfresco').trim().toLowerCase()
  if (!['json', 'alfresco'].includes(mode)) throw failure('HIERARCHY_READ_STORAGE_INVALID', 503)
  return mode
}

export function assertHierarchyJsonWritesEnabled(config) {
  const mode = hierarchyStorageMode(config)
  if (mode === 'alfresco') throw failure('HIERARCHY_ALFRESCO_READ_ONLY', 409)
}

export function safeHierarchyReadError(error) {
  const code = String(error?.code || error?.message || '')
  if (/HTTP_401|HTTP_403|FORBIDDEN/.test(code)) return { status: 503, error: 'HIERARCHY_ALFRESCO_ACCESS_DENIED' }
  if (/HTTP_404|CONTAINER_INVALID|NODE_ID/.test(code)) return { status: 503, error: 'HIERARCHY_ALFRESCO_CONFIGURATION_INVALID' }
  if (/INVALID|MISMATCH|DUPLICATE|OUT_OF_SCOPE|RELATION/.test(code)) return { status: 409, error: 'HIERARCHY_ALFRESCO_DATA_INVALID' }
  return { status: 503, error: 'HIERARCHY_ALFRESCO_READ_UNAVAILABLE' }
}
