const laneRoles = { jefes: 'jefe-unidad', especialistas: 'especialista' }

function assignmentKey(value) {
  return `${value.dependency}|${value.userId}|${value.role}`.toLowerCase()
}

function confirmedUnit(value, dependency) {
  return Boolean(value && value.institutionallyConfirmed === true &&
    typeof value.name === 'string' && value.name.trim() &&
    typeof value.code === 'string' && value.code.trim() &&
    String(value.dependency || '').toLowerCase() === String(dependency || '').toLowerCase())
}

export function planHierarchyMigration({
  organization,
  sourceSha256,
  directoryChecks = {},
  userUnitAssignments = {},
  existingUnits = [],
  existingAssignments = [],
  alfrescoReadError = null,
} = {}) {
  const records = []
  const dependencies = organization?.hierarchies && typeof organization.hierarchies === 'object'
    ? organization.hierarchies : {}
  for (const [dependencyKey, hierarchy] of Object.entries(dependencies)) {
    for (const assignment of Array.isArray(hierarchy?.assignments) ? hierarchy.assignments : []) {
      records.push({ ...assignment, dependency: String(assignment.dependency || dependencyKey).toLowerCase() })
    }
  }

  const headIdsByDependency = new Map()
  const counts = new Map()
  for (const record of records) {
    const role = laneRoles[record.laneId]
    if (!role) continue
    const key = assignmentKey({ ...record, role })
    counts.set(key, (counts.get(key) || 0) + 1)
    if (role === 'jefe-unidad') {
      const dependency = record.dependency.toLowerCase()
      if (!headIdsByDependency.has(dependency)) headIdsByDependency.set(dependency, new Set())
      headIdsByDependency.get(dependency).add(record.userId)
    }
  }

  const existingByUserRole = new Map()
  for (const item of existingAssignments) {
    if (item.status !== 'ACTIVA') continue
    const key = `${String(item.dependency).toLowerCase()}|${item.userId}|${item.role}`
    if (!existingByUserRole.has(key)) existingByUserRole.set(key, [])
    existingByUserRole.get(key).push(item)
  }

  const planned = records.map((record, index) => {
    const role = laneRoles[record.laneId]
    const issues = []
    let category = 'valid'
    if (!role) { category = 'pending'; issues.push('ROLE_NOT_MAPPED') }
    const check = directoryChecks[`${record.userId}|${record.dependency}|${role}`] || directoryChecks[record.userId]
    if (!check) { category = 'pending'; issues.push('DIRECTORY_NOT_CHECKED') }
    else if (check.valid !== true) {
      const code = check.code || 'DIRECTORY_VALIDATION_FAILED'
      issues.push(code)
      category = code === 'HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS'
        ? 'ambiguous'
        : ['HIERARCHY_USER_NOT_FOUND', 'HIERARCHY_USER_DISABLED', 'HIERARCHY_USER_DEPENDENCY_MISMATCH', 'HIERARCHY_USER_FUNCTION_MISMATCH'].includes(code)
          ? 'invalid' : 'pending'
    }
    if (role === 'especialista') {
      if (!record.unitHeadUserId) { category = category === 'invalid' ? category : 'ambiguous'; issues.push('UNIT_HEAD_REFERENCE_MISSING') }
      else if (!headIdsByDependency.get(record.dependency)?.has(record.unitHeadUserId)) {
        category = 'invalid'; issues.push('UNIT_HEAD_REFERENCE_NOT_FOUND_IN_DEPENDENCY')
      } else if (!confirmedUnit(userUnitAssignments[record.unitHeadUserId], record.dependency)) {
        if (category === 'valid') category = 'pending'
        issues.push('LINKED_UNIT_NAME_AND_INSTITUTIONAL_CODE_UNCONFIRMED')
      }
    }
    const configuredUnit = userUnitAssignments[record.userId]
    if (role === 'jefe-unidad' && !confirmedUnit(configuredUnit, record.dependency)) {
      if (category === 'valid') category = 'pending'
      issues.push('UNIT_NAME_AND_INSTITUTIONAL_CODE_UNCONFIRMED')
    }
    if (role === 'jefe-unidad' && confirmedUnit(configuredUnit, record.dependency)) {
      const matchingUnits = existingUnits.filter((unit) => unit.dependency === record.dependency &&
        ((configuredUnit.alfrescoUnitId && unit.id === configuredUnit.alfrescoUnitId) ||
          (!configuredUnit.alfrescoUnitId && unit.code === configuredUnit.code && unit.name === configuredUnit.name)))
      if (matchingUnits.length > 1) { category = 'ambiguous'; issues.push('DUPLICATE_ALFRESCO_UNIT_MATCH') }
      else if (matchingUnits.length === 1 && matchingUnits[0].status !== 'ACTIVA') {
        category = 'ambiguous'; issues.push('MATCHED_ALFRESCO_UNIT_INACTIVE')
      }
    }
    if (role) {
      const key = assignmentKey({ ...record, role })
      if (counts.get(key) > 1) { category = 'ambiguous'; issues.push('DUPLICATE_SOURCE_ASSIGNMENT') }
      const existing = existingByUserRole.get(key) || []
      if (existing.length > 1) { category = 'ambiguous'; issues.push('DUPLICATE_ACTIVE_ALFRESCO_ASSIGNMENT') }
      else if (existing.length === 1) {
        const expectedUnit = role === 'jefe-unidad'
          ? configuredUnit?.alfrescoUnitId || null
          : userUnitAssignments[record.unitHeadUserId]?.alfrescoUnitId || null
        if (expectedUnit && existing[0].unitId !== expectedUnit) {
          category = 'ambiguous'; issues.push('EXISTING_ALFRESCO_ASSIGNMENT_CONFLICT')
        } else {
          issues.push('ALREADY_PRESENT_IN_ALFRESCO')
        }
      }
    }
    if (alfrescoReadError) {
      if (category === 'valid') category = 'pending'
      issues.push('ALFRESCO_READ_UNAVAILABLE')
    }
    return {
      sourceIndex: index,
      dependency: record.dependency,
      laneId: record.laneId,
      role: role || null,
      userId: record.userId || null,
      unitHeadUserId: record.unitHeadUserId || null,
      unit: role === 'jefe-unidad' ? {
        alfrescoUnitId: configuredUnit?.alfrescoUnitId || null,
        nameConfirmed: typeof configuredUnit?.name === 'string' && Boolean(configuredUnit.name.trim()) && configuredUnit.institutionallyConfirmed === true,
        codeConfirmed: typeof configuredUnit?.code === 'string' && Boolean(configuredUnit.code.trim()) && configuredUnit.institutionallyConfirmed === true,
      } : null,
      category,
      issues: [...new Set(issues)],
    }
  })

  const valid = planned.filter((item) => item.category === 'valid').length
  const ambiguous = planned.filter((item) => item.category === 'ambiguous').length
  const invalid = planned.filter((item) => item.category === 'invalid').length
  const pending = planned.filter((item) => item.category === 'pending').length
  const unitsNeedingConfirmation = [...headIdsByDependency.entries()].flatMap(([dependency, headIds]) => [...headIds].map((headUserId) => {
    const configured = userUnitAssignments[headUserId]
    return {
      dependency,
      headUserId,
      alfrescoUnitId: configured?.alfrescoUnitId || null,
      nameConfirmed: typeof configured?.name === 'string' && Boolean(configured.name.trim()) && configured.institutionallyConfirmed === true,
      codeConfirmed: typeof configured?.code === 'string' && Boolean(configured.code.trim()) && configured.institutionallyConfirmed === true,
    }
  })).filter((unit) => !unit.nameConfirmed || !unit.codeConfirmed)

  return {
    source: { sha256: sourceSha256 || null, assignmentCount: records.length },
    summary: { valid, ambiguous, invalid, pending, unitsNeedingConfirmation: unitsNeedingConfirmation.length },
    assignments: planned,
    unitsNeedingConfirmation,
    alfresco: {
      readSucceeded: !alfrescoReadError,
      error: alfrescoReadError || null,
      existingUnitCount: existingUnits.length,
      existingAssignmentCount: existingAssignments.length,
    },
    localAudit: {
      eventCount: Array.isArray(organization?.audit) ? organization.audit.length : 0,
      detail: 'El historial local registra reemplazos agregados; no reconstruye cada alta o cambio individual.',
    },
  }
}
