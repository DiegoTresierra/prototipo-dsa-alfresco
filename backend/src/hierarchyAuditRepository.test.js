import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyAuditRepository } from './hierarchyAuditRepository.js'

const mainId = 'd0c78bf2-35f2-4f7c-878b-f235f21f7c93'
const labId = '284caaa3-8187-4af3-8caa-a38187aaf30b'
const auditId = '097bf6f7-af28-4de1-bbf6-f7af28ede134'
const eventType = 'gdo:eventoJerarquia'
const settings = {
  alfrescoTarget: 'https://alfresco.test',
  hierarchyService: {
    username: 'gd_jerarquias_servicio', password: 'not-a-real-secret',
    containerNodeId: mainId, labContainerNodeId: labId, auditContainerNodeId: auditId, storage: 'alfresco',
  },
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeAlfresco({ auditStatus = 200, identity = null, postStatus = 201, commitThenDisconnect = false, oneItemPages = false } = {}) {
  const root = { id: auditId, name: 'GD_JERARQUIAS_AUDITORIA', nodeType: 'cm:folder', isFolder: true, allowableOperations: ['create'] }
  const nodes = new Map([[auditId, root]])
  const children = []
  const calls = []
  let nextId = 0
  let disconnect = commitThenDisconnect
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ method, pathname: parsed.pathname, body })
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return response(201, { entry: { id: 'fake-ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: identity || {
      id: 'gd_jerarquias_servicio', enabled: true, capabilities: { isAdmin: false },
    } })
    if (parsed.pathname.endsWith(`/nodes/${auditId}`) && method === 'GET') {
      return auditStatus === 200 ? response(200, { entry: root }) : response(auditStatus, { error: 'audit container access failed' })
    }
    const childrenMatch = parsed.pathname.match(/\/nodes\/([^/]+)\/children$/)
    if (childrenMatch && method === 'GET') {
      const parentId = decodeURIComponent(childrenMatch[1])
      if (parentId !== auditId) return response(404, { error: 'missing parent' })
      const skip = Number(parsed.searchParams.get('skipCount') || 0)
      const requested = Number(parsed.searchParams.get('maxItems') || 100)
      const max = oneItemPages ? 1 : requested
      const entries = children.slice(skip, skip + max).map((id) => ({ entry: nodes.get(id) }))
      return response(200, { list: { entries, pagination: { hasMoreItems: skip + entries.length < children.length } } })
    }
    if (childrenMatch && method === 'POST') {
      if (postStatus !== 201 && !disconnect) return response(postStatus, { error: 'create failed' })
      const parentId = decodeURIComponent(childrenMatch[1])
      nextId++
      const id = `20000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`
      const entry = { id, name: body.name, nodeType: body.nodeType, parentId, properties: body.properties, allowableOperations: [] }
      nodes.set(id, entry)
      children.push(id)
      if (disconnect) { disconnect = false; throw new Error('simulated lost response after commit') }
      return response(201, { entry })
    }
    const nodeMatch = parsed.pathname.match(/\/nodes\/([^/]+)$/)
    if (nodeMatch && method === 'GET') {
      const entry = nodes.get(decodeURIComponent(nodeMatch[1]))
      return entry ? response(200, { entry }) : response(404, { error: 'node not found' })
    }
    return response(404, { error: 'unexpected request' })
  }
  return { fetchImpl, calls, nodes, children }
}

function repository(fake, options = {}) {
  return createHierarchyAuditRepository(settings, { fetchImpl: fake.fetchImpl, allowWrites: true, ...options })
}

function event(overrides = {}) {
  return {
    operationId: 'operation-2026-11-20-0001',
    phase: 'COMPLETADA',
    action: 'ESPECIALISTA_ASIGNADO',
    dependency: 'DSA',
    actorId: 'director-dsa',
    unitId: 'b0c78bf2-35f2-4787-878b-f235f21f7c95',
    assignmentId: 'c0c78bf2-35f2-4787-878b-f235f21f7c96',
    userId: 'especialista-dsa-1',
    beforeData: { estado: 'SIN_ASIGNAR' },
    afterData: { estado: 'ACTIVA', rol: 'especialista' },
    beforeRevision: 'a'.repeat(64),
    afterRevision: 'b'.repeat(64),
    ...overrides,
  }
}

test('creates and verifies an event node with the service identity and functional actor', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const created = await repo.createEvent(event({ occurredAt: '2026-11-20T10:00:00.000Z' }))
  assert.equal(created.nodeType, eventType)
  assert.equal(created.parentId, auditId)
  assert.equal(created.actorEvento, 'director-dsa')
  assert.equal(created.dependenciaEvento, 'DSA')
  assert.equal(created.accionEvento, 'ESPECIALISTA_ASIGNADO')
  assert.equal(created.fechaEvento, '2026-11-20T10:00:00.000Z')
  assert.equal(fake.calls.find((call) => call.method === 'POST' && call.pathname.endsWith('/tickets')) !== undefined, true)
  const post = fake.calls.find((call) => call.method === 'POST' && call.pathname.endsWith('/children'))
  assert.equal(post.body.nodeType, eventType)
  assert.equal(post.body.properties['gdo:actorEvento'], 'director-dsa')
  assert.equal(post.body.content, undefined)
  assert.deepEqual(Object.keys(repo).sort(), ['createEvent', 'getContainer', 'getEvent', 'listEvents'].sort())
})

test('reads by UUID and paginates while filtering dependency and operation in the repository', async () => {
  const fake = fakeAlfresco({ oneItemPages: true })
  const repo = repository(fake)
  const one = await repo.createEvent(event({ occurredAt: '2026-11-20T10:00:00.000Z' }))
  await repo.createEvent(event({ operationId: 'operation-2026-11-20-0002', userId: 'specialist-2', occurredAt: '2026-11-20T11:00:00.000Z' }))
  await repo.createEvent(event({ operationId: 'operation-2026-11-20-0003', dependency: 'DTI', actorId: 'director-dti', occurredAt: '2026-11-20T12:00:00.000Z' }))

  const found = await repo.getEvent(one.id, { dependency: 'DSA' })
  assert.equal(found.id, one.id)
  const filtered = await repo.listEvents({ dependency: 'DSA', page: 1, pageSize: 1 })
  assert.equal(filtered.pagination.totalItems, 2)
  assert.equal(filtered.pagination.totalPages, 2)
  assert.equal(filtered.pagination.hasMoreItems, true)
  assert.equal(filtered.events[0].idOperacionEvento, 'operation-2026-11-20-0002')
  const operation = await repo.listEvents({ dependency: 'DSA', operationId: 'operation-2026-11-20-0001' })
  assert.equal(operation.pagination.totalItems, 1)
  assert.equal(operation.events[0].id, one.id)
  await assert.rejects(repo.getEvent(one.id, { dependency: 'DTI' }), /HIERARCHY_AUDIT_EVENT_OUT_OF_SCOPE/)
})

test('requires mandatory fields and valid phase/action before writing; rejects sensitive JSON keys', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  await assert.rejects(repo.createEvent(event({ actorId: '' })), /HIERARCHY_AUDIT_ACTOR_REQUIRED/)
  await assert.rejects(repo.createEvent(event({ phase: 'EDITED' })), /HIERARCHY_AUDIT_PHASE_INVALID/)
  await assert.rejects(repo.createEvent(event({ action: 'UPDATE' })), /HIERARCHY_AUDIT_ACTION_INVALID/)
  await assert.rejects(repo.createEvent(event({ beforeData: { password: 'do-not-log' } })), /HIERARCHY_AUDIT_SENSITIVE_DATA_REJECTED/)
  assert.equal(fake.calls.length, 0)
})

test('uses a deterministic composite key, reuses exact retries, and rejects key collisions with different data', async () => {
  const fake = fakeAlfresco()
  const repo = repository(fake)
  const first = await repo.createEvent(event())
  const retry = await repo.createEvent(event())
  assert.equal(retry.id, first.id)
  assert.equal(retry.reused, true)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, 1)
  await assert.rejects(repo.createEvent(event({ actorId: 'different-director' })), /HIERARCHY_AUDIT_DUPLICATE_CONFLICT/)
})

test('recovers a committed but uncertain POST by querying the deterministic key', async () => {
  const fake = fakeAlfresco({ commitThenDisconnect: true })
  const repo = repository(fake)
  const result = await repo.createEvent(event())
  assert.equal(result.outcomeRecovered, true)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, 1)
})

test('reports authentication, permission, missing node and conflict failures safely', async () => {
  const invalidIdentity = fakeAlfresco({ identity: { id: 'other-user', enabled: true, capabilities: { isAdmin: false } } })
  await assert.rejects(repository(invalidIdentity).listEvents({ dependency: 'DSA' }), /HIERARCHY_SERVICE_IDENTITY_INVALID/)

  const unauthorized = fakeAlfresco({ auditStatus: 401 })
  await assert.rejects(repository(unauthorized).listEvents({ dependency: 'DSA' }), (error) => error.status === 401)

  const forbidden = fakeAlfresco({ auditStatus: 403 })
  await assert.rejects(repository(forbidden).listEvents({ dependency: 'DSA' }), (error) => error.status === 403)

  const fake = fakeAlfresco()
  const repo = repository(fake)
  await assert.rejects(repo.getEvent('30000000-0000-4000-8000-000000000001', { dependency: 'DSA' }), (error) => error.status === 404)

  const conflict = fakeAlfresco({ postStatus: 409 })
  await assert.rejects(repository(conflict).createEvent(event()), (error) => error.status === 409 && error.code === 'HIERARCHY_ALFRESCO_HTTP_409')
})

test('rejects identical container IDs and is append-only through its public API', async () => {
  const fake = fakeAlfresco()
  const invalidSettings = { ...settings, hierarchyService: { ...settings.hierarchyService, labContainerNodeId: auditId } }
  const invalidRepo = createHierarchyAuditRepository(invalidSettings, { fetchImpl: fake.fetchImpl, allowWrites: true })
  await assert.rejects(invalidRepo.listEvents({ dependency: 'DSA' }), /HIERARCHY_CONTAINERS_MUST_BE_DISTINCT/)
  await assert.rejects(repository(fake, { allowWrites: false }).createEvent(event()), /HIERARCHY_AUDIT_WRITES_DISABLED/)
  await repository(fake).createEvent(event())
  assert.equal(fake.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE'), false)
})
