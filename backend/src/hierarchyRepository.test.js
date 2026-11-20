import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyRepository } from './hierarchyRepository.js'

const containerId = 'd0c78bf2-35f2-4f7c-878b-f235f21f7c93'
const unitId = 'b0c78bf2-35f2-4787-878b-f235f21f7c95'
const headA = 'c0c78bf2-35f2-4787-878b-f235f21f7c96'
const headB = 'e0c78bf2-35f2-4787-878b-f235f21f7c97'
const specialistA = 'f0c78bf2-35f2-4787-878b-f235f21f7c98'
const specialistB = 'a1c78bf2-35f2-4787-878b-f235f21f7c99'
const settings = {
  alfrescoTarget: 'https://alfresco.test',
  hierarchyService: { username: 'gd_jerarquias_servicio', password: 'not-a-real-secret', containerNodeId: containerId, storage: 'alfresco' },
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function node({ id, name, nodeType, parentId, properties = {}, folder = false, operations = ['update', 'create'] }) {
  return { id, name, nodeType, parentId, properties, isFolder: folder, allowableOperations: operations, modifiedAt: '2026-11-19T12:00:00.000Z' }
}

function fakeAlfresco({ containerStatus = 200, postCommitFailure = false, authStatus = 200 } = {}) {
  const nodes = new Map([[containerId, node({ id: containerId, name: 'GD_JERARQUIAS', nodeType: 'cm:folder', folder: true })]])
  const children = new Map([[containerId, []]])
  let generatedId = 10
  let failPost = postCommitFailure
  const calls = []

  function add(parentId, body) {
    generatedId += 1
    const id = `10000000-0000-4000-8000-${String(generatedId).padStart(12, '0')}`
    const created = node({ id, name: body.name, nodeType: body.nodeType, parentId, properties: body.properties,
      folder: body.nodeType === 'gdo:unidad' })
    nodes.set(id, created)
    if (!children.has(parentId)) children.set(parentId, [])
    children.get(parentId).push(id)
    if (created.isFolder) children.set(id, [])
    return created
  }

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ method, pathname: parsed.pathname, body })
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return response(201, { entry: { id: 'fake-ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: { id: settings.hierarchyService.username, enabled: true, capabilities: { isAdmin: false } } })
    if (parsed.pathname.endsWith(`/nodes/${containerId}`) && method === 'GET') {
      if (containerStatus !== 200) return response(containerStatus, { error: 'denied' })
      return response(200, { entry: nodes.get(containerId) })
    }
    const childMatch = parsed.pathname.match(/\/nodes\/([^/]+)\/children$/)
    if (childMatch && method === 'GET') {
      const parentId = decodeURIComponent(childMatch[1])
      const all = (children.get(parentId) || []).map((id) => nodes.get(id)).filter(Boolean)
      const skip = Number(parsed.searchParams.get('skipCount') || 0)
      const max = Number(parsed.searchParams.get('maxItems') || 100)
      const page = all.slice(skip, skip + max)
      return response(200, { list: { entries: page.map((entry) => ({ entry })), pagination: { hasMoreItems: skip + page.length < all.length } } })
    }
    if (childMatch && method === 'POST') {
      const created = add(decodeURIComponent(childMatch[1]), body)
      if (failPost) { failPost = false; throw new Error('connection dropped after Alfresco accepted request') }
      return response(201, { entry: created })
    }
    const nodeMatch = parsed.pathname.match(/\/nodes\/([^/]+)$/)
    if (nodeMatch) {
      const found = nodes.get(decodeURIComponent(nodeMatch[1]))
      if (!found) return response(404, { error: 'missing' })
      if (method === 'GET') return response(200, { entry: found })
      if (method === 'PUT') {
        Object.assign(found.properties, body.properties)
        found.modifiedAt = '2026-11-19T12:05:00.000Z'
        return response(200, { entry: found })
      }
    }
    return response(authStatus === 200 ? 404 : authStatus, { error: 'unexpected request' })
  }
  return { fetchImpl, calls, nodes }
}

function repository(fake, options = {}) {
  return createHierarchyRepository(settings, {
    fetchImpl: fake.fetchImpl,
    allowWrites: true,
    validateAssignmentCandidate: async (id, { dependency, role }) => ({ id, enabled: true, dependency, role }),
    ...options,
  })
}

async function setupUnit(repo, operationId = 'unit-op-initial') {
  return repo.createUnit({ operationId, dependency: 'DSA', name: 'Unidad de laboratorio', code: 'LAB-01', actorId: 'director-dsa' })
}

async function addAssignment(repo, { operationId, userId, role, unitId: targetUnitId = unitId }) {
  return repo.createAssignment({ operationId, unitId: targetUnitId, userId, dependency: 'DSA', role, actorId: 'director-dsa' })
}

test('creates and reads a unit, paging through its assignments from the configured container', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const unit = await setupUnit(repo)
  const { units } = await repo.listUnits({ dependency: 'DSA' })
  assert.equal(units.length, 1)
  assert.equal(units[0].id, unit.id)
  assert.equal(units[0].status, 'ACTIVA')
  assert.ok(fake.calls.some((call) => call.method === 'POST' && call.body.nodeType === 'gdo:unidad'))
  assert.equal(fake.calls.some((call) => call.method === 'DELETE'), false)
})

test('rejects active unit names and institutional codes duplicated within the dependency', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  await setupUnit(repo)
  await assert.rejects(repo.createUnit({ operationId: 'duplicate-name-op', dependency: 'DSA', name: ' unidad de laboratorio ', code: 'LAB-02', actorId: 'director-dsa' }),
    (error) => error.code === 'HIERARCHY_UNIT_NAME_DUPLICATE' && error.status === 409)
  await assert.rejects(repo.createUnit({ operationId: 'duplicate-code-op', dependency: 'DSA', name: 'Otra unidad', code: 'lab-01', actorId: 'director-dsa' }),
    (error) => error.code === 'HIERARCHY_UNIT_CODE_DUPLICATE' && error.status === 409)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.body.nodeType === 'gdo:unidad').length, 1)
})

test('enforces one active head per unit and preserves the old assignment when changing heads', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const unit = await setupUnit(repo)
  const oldHead = await addAssignment(repo, { operationId: 'head-op-1', userId: 'head-1', role: 'jefe-unidad', unitId: unit.id })
  await assert.rejects(addAssignment(repo, { operationId: 'head-op-2', userId: 'head-2', role: 'jefe-unidad', unitId: unit.id }), /HIERARCHY_ACTIVE_UNIT_HEAD_EXISTS/)
  await repo.deactivateAssignment({ assignmentId: oldHead.id, dependency: 'DSA', actorId: 'director-dsa', operationId: 'head-off-1' })
  const replacement = await addAssignment(repo, { operationId: 'head-op-2', userId: 'head-2', role: 'jefe-unidad', unitId: unit.id })
  const { assignments } = await repo.listAssignments({ unitId: unit.id })
  assert.equal(replacement.status, 'ACTIVA')
  assert.equal(assignments.length, 2)
  assert.deepEqual(assignments.map((item) => item.status).sort(), ['ACTIVA', 'INACTIVA'])
})

test('assigns specialists to a unit independently of its head and supports unit reassignment via deactivation', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const firstUnit = await setupUnit(repo)
  const secondUnit = await repo.createUnit({ operationId: 'unit-op-2', dependency: 'DSA', name: 'Unidad dos', code: 'LAB-02', actorId: 'director-dsa' })
  const head = await addAssignment(repo, { operationId: 'head-op', userId: 'head-1', role: 'jefe-unidad', unitId: firstUnit.id })
  const specialist = await addAssignment(repo, { operationId: 'specialist-op-1', userId: 'specialist-1', role: 'especialista', unitId: firstUnit.id })
  await assert.rejects(addAssignment(repo, { operationId: 'specialist-op-duplicate', userId: 'specialist-1', role: 'especialista', unitId: secondUnit.id }),
    (error) => error.code === 'HIERARCHY_SPECIALIST_ALREADY_ASSIGNED' && error.status === 409)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.body.nodeType === 'gdo:asignacion').length, 2)
  await repo.deactivateAssignment({ assignmentId: head.id, dependency: 'DSA', actorId: 'director-dsa', operationId: 'head-off' })
  assert.equal((await repo.listAssignments({ unitId: firstUnit.id, includeInactive: false })).assignments[0].id, specialist.id)
  await repo.deactivateAssignment({ assignmentId: specialist.id, dependency: 'DSA', actorId: 'director-dsa', operationId: 'specialist-off' })
  const reassigned = await addAssignment(repo, { operationId: 'specialist-op-2', userId: 'specialist-1', role: 'especialista', unitId: secondUnit.id })
  assert.equal(reassigned.unitId, secondUnit.id)
  assert.equal((await repo.listAssignments({ includeInactive: true })).assignments.length, 3)
})

test('rejects specialist assignment to an inactive unit before creating a child node', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const unit = await setupUnit(repo)
  fake.nodes.get(unit.id).properties['gdo:estadoUnidad'] = 'INACTIVA'
  await assert.rejects(addAssignment(repo, { operationId: 'inactive-specialist-op', userId: 'specialist-1', role: 'especialista', unitId: unit.id }),
    (error) => error.code === 'HIERARCHY_UNIT_INACTIVE' && error.status === 409)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.body.nodeType === 'gdo:asignacion').length, 0)
})

test('rejects cross-dependency assignment and invalid node relations', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const unit = await setupUnit(repo)
  await assert.rejects(repo.createAssignment({ operationId: 'cross', unitId: unit.id, userId: 'x', dependency: 'DTI', role: 'especialista', actorId: 'actor' }), /HIERARCHY_DEPENDENCY_MISMATCH/)
  const badNode = node({ id: '20000000-0000-4000-8000-000000000001', name: 'bad', nodeType: 'gdo:asignacion', parentId: unit.id,
    properties: { 'gdo:idUsuario': 'u', 'gdo:idUnidad': 'other-unit', 'gdo:dependenciaAsignacion': 'DSA', 'gdo:rolAsignacion': 'especialista', 'gdo:estadoAsignacion': 'ACTIVA', 'gdo:asignadoPor': 'actor' } })
  fake.nodes.set(badNode.id, badNode)
  // The malformed node is attached to the mock child listing and must fail relationship validation.
  const originalFetch = fake.fetchImpl
  fake.fetchImpl = async (url, options) => {
    const parsed = new URL(url)
    if ((options?.method || 'GET') === 'GET' && parsed.pathname.endsWith(`/nodes/${unit.id}/children`)) {
      return response(200, { list: { entries: [{ entry: badNode }], pagination: { hasMoreItems: false } } })
    }
    return originalFetch(url, options)
  }
  const malformedRepo = createHierarchyRepository(settings, { fetchImpl: fake.fetchImpl, allowWrites: true })
  await assert.rejects(malformedRepo.listAssignments({ unitId: unit.id }), /HIERARCHY_ASSIGNMENT_RELATION_INVALID/)
})

test('revalidates enabled role and dependency eligibility immediately before assignment creation', async () => {
  const fake = fakeAlfresco()
  const unit = await setupUnit(repository(fake))
  const invalidCandidates = [
    { code: 'HIERARCHY_USER_DISABLED', enabled: false, dependency: 'DSA', role: 'jefe-unidad' },
    { code: 'HIERARCHY_USER_DEPENDENCY_MISMATCH', enabled: true, dependency: 'DTI', role: 'jefe-unidad' },
    { code: 'HIERARCHY_USER_FUNCTION_MISMATCH', enabled: true, dependency: 'DSA', role: 'especialista' },
  ]
  for (const candidate of invalidCandidates) {
    const repo = repository(fake, { validateAssignmentCandidate: async () => {
      if (!candidate.enabled) throw Object.assign(new Error(candidate.code), { code: candidate.code, status: 403 })
      return { id: 'not-the-requested-user', enabled: candidate.enabled, dependency: candidate.dependency, role: candidate.role }
    } })
    await assert.rejects(repo.createAssignment({ operationId: `invalid-${candidate.code}`, unitId: unit.id, userId: 'dsa-head', dependency: 'DSA', role: 'jefe-unidad', actorId: 'director-dsa' }),
      (error) => error.code === candidate.code || error.code === 'HIERARCHY_DIRECTORY_VALIDATION_FAILED')
  }
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.body.nodeType === 'gdo:asignacion').length, 0)
})

test('uses operation IDs to prevent duplicate writes and recovers uncertain POSTs by reading before retry', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const first = await setupUnit(repo, 'stable-unit-operation')
  const repeated = await setupUnit(repo, 'stable-unit-operation')
  assert.equal(first.id, repeated.id)
  assert.equal(repeated.reused, true)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, 1)

  const otherFake = fakeAlfresco({ postCommitFailure: true })
  const firstAttempt = repository(otherFake)
  await assert.rejects(setupUnit(firstAttempt, 'uncertain-operation'), /HIERARCHY_WRITE_OUTCOME_UNKNOWN/)
  const retry = await setupUnit(repository(otherFake), 'uncertain-operation')
  assert.equal(retry.reused, true)
  assert.equal(otherFake.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, 1)
})

test('checks optimistic revisions and fails safely when audit recording fails after a verified write', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const unit = await setupUnit(repo)
  const staleRevision = await repo.getRevision()
  await repo.updateUnit({ unitId: unit.id, dependency: 'DSA', changes: { name: 'Actualizada' }, actorId: 'director-dsa', operationId: 'update-unit' })
  await assert.rejects(repo.createAssignment({ operationId: 'stale-op', unitId: unit.id, userId: 'u', dependency: 'DSA', role: 'especialista', actorId: 'director-dsa', expectedRevision: staleRevision }), /HIERARCHY_REVISION_CONFLICT/)

  const auditRepo = repository(fake, { recordAuditEvent: async () => { throw new Error('audit unavailable') } })
  await assert.rejects(auditRepo.createAssignment({ operationId: 'audit-op', unitId: unit.id, userId: 'u', dependency: 'DSA', role: 'especialista', actorId: 'director-dsa' }), (error) => error.code === 'HIERARCHY_AUDIT_RECORD_FAILED' && error.partialCommit === true)
})

test('does not write by default and reports permission/authentication errors without retrying mutations', async () => {
  const blockedFake = fakeAlfresco()
  const blocked = createHierarchyRepository(settings, { fetchImpl: blockedFake.fetchImpl })
  await assert.rejects(setupUnit(blocked), /HIERARCHY_REPOSITORY_WRITES_DISABLED/)
  assert.equal(blockedFake.calls.length, 0)

  const missingDirectory = repository(blockedFake, { validateAssignmentCandidate: undefined })
  await assert.rejects(missingDirectory.createAssignment({ operationId: 'no-directory', unitId, userId: 'u', dependency: 'DSA', role: 'especialista', actorId: 'director' }), /HIERARCHY_DIRECTORY_VALIDATOR_REQUIRED/)

  for (const status of [401, 403]) {
    const fake = fakeAlfresco({ containerStatus: status })
    const repo = repository(fake)
    await assert.rejects(repo.listUnits(), (error) => error.status === status)
  }
})
