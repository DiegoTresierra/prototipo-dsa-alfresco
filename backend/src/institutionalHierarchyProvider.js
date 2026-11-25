import { isDispatchHierarchyRevision, isDispatchUnitId } from './dispatchPolicy.js'
import { createHierarchyReadService } from './hierarchyReadService.js'

// All administrative journals matter, including an orphan partial event without
// a confirmed initiation. Missing audit evidence is never a clearance.
export async function readPendingHierarchyOperations(repository, dependency) {
  const incomplete = () => Object.assign(new Error('HIERARCHY_AUDIT_COVERAGE_INCOMPLETE'), { code: 'HIERARCHY_AUDIT_COVERAGE_INCOMPLETE', status: 503 })
  const events = [], ids = new Set()
  let page = 1, totalItems, totalPages = 1
  do {
    const result = await repository.listEvents({ dependency, page, pageSize: 200 })
    const p = result.pagination
    if (!Array.isArray(result.events) || p?.page !== page || p.pageSize !== 200 ||
        !Number.isSafeInteger(p.totalItems) || p.totalItems < 0 || p.totalPages !== Math.ceil(p.totalItems / 200) ||
        p.hasMoreItems !== (page < p.totalPages) || totalItems !== undefined && p.totalItems !== totalItems ||
        p.hasMoreItems && !result.events.length) throw incomplete()
    totalItems = p.totalItems
    totalPages = p.totalPages
    for (const event of result.events) {
      if (!event.id || ids.has(event.id) || !event.idOperacionEvento || !Number.isFinite(Date.parse(event.fechaEvento)) ||
          String(event.dependenciaEvento).toLowerCase() !== String(dependency).toLowerCase()) throw incomplete()
      ids.add(event.id); events.push(event)
    }
    if (++page > 501) throw incomplete()
  } while (page <= totalPages)
  if (events.length !== totalItems) throw incomplete()
  const operations = new Map()
  for (const event of events) {
    if (!operations.has(event.idOperacionEvento)) operations.set(event.idOperacionEvento, [])
    operations.get(event.idOperacionEvento).push(event)
  }
  return [...operations].filter(([, history]) => {
    const completed = history.filter(e => e.faseEvento === 'COMPLETADA')
    return !completed.length || history.some(e => e.faseEvento !== 'COMPLETADA' &&
      completed.every(c => Date.parse(e.fechaEvento) >= Date.parse(c.fechaEvento)))
  }).map(([operationId]) => ({ operationId, status: 'RECONCILIACION_REQUERIDA' }))
}

// Alfresco records and exact live group memberships are required together.
// This boundary never consumes organization.json or grants document ACLs.
export function createInstitutionalHierarchyProvider({ repository, directory, groupMappings, pendingOperations } = {}) {
  const fail = (code = 'ORGANIZATIONAL_HIERARCHY_PENDING') => {
    throw Object.assign(new Error(code), { code, status: 503 })
  }
  async function resolve({ userId, dependency, role, stage }) {
    const key = Object.keys(groupMappings?.dependencies || {}).find(key => key.toLowerCase() === String(dependency).toLowerCase())
    if (!key || !userId || typeof pendingOperations !== 'function') fail()
    const before = await repository.getRevision()
    if (typeof before !== 'string' || !before) fail()
    const scope = key.toLowerCase()
    const [unitsResult, assignmentsResult, pending] = await Promise.all([
      repository.listUnits({ dependency: scope, includeInactive: false }),
      repository.listAssignments({ dependency: scope, includeInactive: false }),
      pendingOperations(key),
    ])
    if (!Array.isArray(pending) || pending.length) fail('HIERARCHY_PENDING_RECONCILIATION')
    const actor = await directory.validateAssignmentCandidate(userId, { dependency: key, role })
    if (actor.id !== userId || actor.enabled !== true || actor.role !== role || actor.dependency !== key) fail()
    const units = unitsResult.units.filter(u => u.status === 'ACTIVA' && u.dependency.toLowerCase() === scope)
    const active = assignmentsResult.assignments.filter(a => a.status === 'ACTIVA' && a.dependency.toLowerCase() === scope)
    if (active.some(a => !units.some(u => u.id === a.unitId))) fail('HIERARCHY_ASSIGNMENT_UNIT_INVALID')
    const own = active.filter(a => a.userId === userId)
    if (role !== 'direccion' && (own.length !== 1 || own[0].role !== role)) fail('HIERARCHY_ACTIVE_RELATION_AMBIGUOUS')
    let people
    let managedUnit
    if (stage === 'direccion') {
      people = await directory.listCandidates({ dependency: key, role: 'direccion' })
      if (people.length !== 1) fail('HIERARCHY_DIRECTION_AMBIGUOUS')
    } else {
      const unitId = own[0]?.unitId
      if (stage === 'especialistas') managedUnit = units.find(unit => unit.id === unitId)
      const heads = active.filter(a => a.unitId === unitId && a.role === 'jefe-unidad')
      if (heads.length !== 1) fail('HIERARCHY_UNIT_HEAD_AMBIGUOUS')
      const selected = stage === 'jefatura' ? heads : active.filter(a => a.unitId === unitId && a.role === 'especialista')
      people = []
      for (const record of selected) {
        if (active.filter(a => a.userId === record.userId).length !== 1) fail('HIERARCHY_ACTIVE_RELATION_AMBIGUOUS')
        people.push(await directory.validateAssignmentCandidate(record.userId, { dependency: key, role: record.role }))
      }
    }
    for (const person of people) {
      if (person.enabled !== true || person.dependency !== key || !Array.isArray(person.groups) || !person.groups.length) fail()
    }
    // Re-read after memberships and pending journals: a changed supervisor is never reused.
    const pendingAfter = await pendingOperations(key)
    const after = await repository.getRevision()
    if (after !== before || !Array.isArray(pendingAfter) || pendingAfter.length) fail('HIERARCHY_REVISION_CONFLICT')
    return { verified: true, source: 'alfresco', revision: after,
      members: people.map(person => ({ userId: person.id, groupIds: person.groups })),
      ...(managedUnit ? { unit: { id: managedUnit.id, code: managedUnit.code, name: managedUnit.name, dependency: scope } } : {}) }
  }

  async function listDispatchUnits({ dependency }) {
    const key = Object.keys(groupMappings?.dependencies || {}).find(key => key.toLowerCase() === String(dependency).toLowerCase())
    if (!key || typeof pendingOperations !== 'function') fail()
    const assertNoPendingOperations = async () => {
      const pending = await pendingOperations(key)
      if (!Array.isArray(pending) || pending.length) fail('HIERARCHY_PENDING_RECONCILIATION')
    }
    await assertNoPendingOperations()
    const reader = createHierarchyReadService({ repository, directory, groupMappings })
    const { units, assignments, recipients, revision } = await reader.readDependency(key)
    await assertNoPendingOperations()
    if (!isDispatchHierarchyRevision(revision) || await repository.getRevision() !== revision) fail('HIERARCHY_REVISION_CONFLICT')

    const catalog = new Map()
    for (const unit of units) {
      if (!isDispatchUnitId(unit.id) || catalog.has(unit.id) || typeof unit.name !== 'string' || !unit.name.trim()) {
        fail('HIERARCHY_DISPATCH_UNIT_INVALID')
      }
      catalog.set(unit.id, { ...unit, head: null, specialists: [] })
    }
    const people = new Map(recipients.map((person) => [person.id, person]))
    for (const assignment of assignments) {
      const person = people.get(assignment.userId)
      const unit = catalog.get(assignment.unitId)
      if (!person || !unit || person.functionalRole !== (assignment.laneId === 'jefes' ? 'jefe-unidad' : 'especialista')) {
        fail('HIERARCHY_ASSIGNMENT_MEMBERSHIP_INVALID')
      }
      const recipient = { id: person.id, displayName: person.displayName, dependency: person.dependency, functionalRole: person.functionalRole }
      if (recipient.functionalRole === 'jefe-unidad') unit.head = recipient
      else unit.specialists.push(recipient)
    }
    return { verified: true, source: 'alfresco', revision, units: [...catalog.values()] }
  }

  return {
    listDispatchUnits,
    resolveSpecialists: input => resolve({ ...input, role: 'jefe-unidad', stage: 'especialistas' }),
    async resolveReviewers(input) {
      if (!['jefatura', 'direccion'].includes(input.stage) ||
          !['especialista', 'jefe-unidad', 'direccion'].includes(input.authorRole) ||
          input.stage === 'jefatura' && input.authorRole !== 'especialista') {
        throw Object.assign(new Error('HIERARCHY_REVIEW_ROUTE_INVALID'), { status: 403 })
      }
      const result = await resolve({ ...input, userId: input.authorUserId, role: input.authorRole })
      return { ...result, reviewers: result.members }
    },
  }
}
