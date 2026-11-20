import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyAuditLabClient } from './hierarchyAuditLabClient.js'

const definitiveId = 'd0c78bf2-35f2-4f7c-878b-f235f21f7c93'
const labId = '284caaa3-8187-4af3-8caa-a38187aaf30b'
const auditId = '097bf6f7-af28-4de1-bbf6-f7af28ede134'
const eventType = 'gdo:eventoJerarquia'
const runId = 'LAB-AUDIT-TEST-01'
const settings = {
  alfrescoTarget: 'https://alfresco.test',
  hierarchyService: {
    username: 'gd_jerarquias_servicio', password: 'not-a-real-secret',
    containerNodeId: definitiveId, auditContainerNodeId: auditId, labContainerNodeId: labId, storage: 'alfresco',
  },
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function makeFake({ rootStatus = 200, rootName = 'GD_JERARQUIAS_LAB', postStatus = 201, commitThenDisconnect = false } = {}) {
  const root = { id: labId, name: rootName, nodeType: 'cm:folder', isFolder: true, allowableOperations: ['create'] }
  const nodes = new Map([[labId, root]])
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
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: {
      id: 'gd_jerarquias_servicio', enabled: true, capabilities: { isAdmin: false },
    } })
    if (parsed.pathname.endsWith(`/nodes/${labId}`) && method === 'GET') {
      return rootStatus === 200 ? response(200, { entry: root }) : response(rootStatus, { error: 'lab container read failed' })
    }
    const childrenMatch = parsed.pathname.match(/\/nodes\/([^/]+)\/children$/)
    if (childrenMatch && method === 'GET') {
      if (decodeURIComponent(childrenMatch[1]) !== labId) return response(404, { error: 'outside lab root' })
      const skip = Number(parsed.searchParams.get('skipCount') || 0)
      const max = Number(parsed.searchParams.get('maxItems') || 100)
      const page = children.slice(skip, skip + max).map((id) => ({ entry: nodes.get(id) }))
      return response(200, { list: { entries: page, pagination: { hasMoreItems: skip + page.length < children.length } } })
    }
    if (childrenMatch && method === 'POST') {
      if (postStatus !== 201 && !disconnect) return response(postStatus, { error: 'create rejected' })
      const parentId = decodeURIComponent(childrenMatch[1])
      if (parentId !== labId) return response(403, { error: 'write outside lab root' })
      nextId++
      const id = `30000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`
      const created = { id, name: body.name, nodeType: body.nodeType, parentId, properties: body.properties }
      nodes.set(id, created)
      children.push(id)
      if (disconnect) { disconnect = false; throw new Error('simulated accepted write with lost response') }
      return response(201, { entry: created })
    }
    const nodeMatch = parsed.pathname.match(/\/nodes\/([^/]+)$/)
    if (nodeMatch && method === 'GET') {
      const entry = nodes.get(decodeURIComponent(nodeMatch[1]))
      return entry ? response(200, { entry }) : response(404, { error: 'node not found' })
    }
    return response(404, { error: 'unexpected path or method' })
  }
  return { fetchImpl, calls, nodes, children }
}

function client(fake, overrides = {}) {
  return createHierarchyAuditLabClient(settings, {
    labContainerNodeId: labId,
    runId,
    confirmLabWrites: true,
    fetchImpl: fake.fetchImpl,
    ...overrides,
  })
}

test('creates one fictional event, verifies all 15 properties, reads it back and confirms it is listed', async () => {
  const fake = makeFake()
  const lab = client(fake)
  const container = await lab.getLabContainer()
  const event = await lab.createEvent()
  assert.equal(container.id, labId)
  assert.equal(container.name, 'GD_JERARQUIAS_LAB')
  assert.equal(event.nodeType, eventType)
  assert.equal(event.parentId, labId)
  assert.equal(Object.keys(event.properties).filter((name) => name.startsWith('gdo:')).length, 15)
  assert.equal(event.properties['gdo:dependenciaEvento'], 'LABORATORIO')
  assert.equal(event.properties['gdo:actorEvento'], `LAB_OPERADOR_${runId}`)
  assert.equal(event.properties['gdo:idUsuarioEvento'], `LAB_USUARIO_${runId}`)
  assert.match(event.properties['gdo:fechaEvento'], /^\d{4}-\d\d-\d\dT/)
  assert.equal(event.reused, false)

  const listed = await lab.listChildren()
  assert.equal(listed.filter((child) => child.id === event.id).length, 1)
  const post = fake.calls.find((call) => call.method === 'POST' && call.pathname.endsWith('/children'))
  assert.equal(post.body.nodeType, eventType)
  assert.equal(post.body.content, undefined)
  assert.equal(Object.keys(post.body.properties).length, 15)
  assert.equal(fake.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE'), false)
  assert.ok(fake.calls.every((call) => !call.pathname.includes('/content')))
})

test('repeats the same RUN_ID by reading and reusing the event without another create', async () => {
  const fake = makeFake()
  const lab = client(fake)
  const first = await lab.createEvent()
  const repeated = await lab.createEvent()
  assert.equal(repeated.id, first.id)
  assert.equal(repeated.reused, true)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, 1)
})

test('recovers a committed but uncertain creation by querying the event before retrying', async () => {
  const fake = makeFake({ commitThenDisconnect: true })
  const result = await client(fake).createEvent()
  assert.equal(result.outcomeRecovered, true)
  assert.equal(fake.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, 1)
})

test('requires explicit confirmation, valid RUN_ID and the exact isolated lab UUID before network access', async () => {
  const fake = makeFake()
  await assert.rejects(client(fake, { confirmLabWrites: false }).createEvent(), /HIERARCHY_AUDIT_LAB_CONFIRMATION_REQUIRED/)
  await assert.rejects(client(fake, { runId: 'bad run id' }).createEvent(), /HIERARCHY_AUDIT_LAB_RUN_ID_INVALID/)
  await assert.rejects(client(fake, { labContainerNodeId: '' }).createEvent(), /HIERARCHY_AUDIT_LAB_CONTAINER_ID_INVALID/)
  await assert.rejects(client(fake, { labContainerNodeId: definitiveId }).createEvent(), /HIERARCHY_AUDIT_LAB_CONTAINER_ID_INVALID/)
  const alias = client(fake, { labContainerNodeId: labId })
  const collidingSettings = { ...settings, hierarchyService: { ...settings.hierarchyService, auditContainerNodeId: labId } }
  await assert.rejects(createHierarchyAuditLabClient(collidingSettings, { labContainerNodeId: labId, runId, confirmLabWrites: true, fetchImpl: fake.fetchImpl }).createEvent(), /HIERARCHY_AUDIT_LAB_CONTAINER_MUST_BE_ISOLATED/)
  assert.equal(fake.calls.length, 0)
  assert.deepEqual(Object.keys(alias).sort(), ['createEvent', 'getEvent', 'getLabContainer', 'listChildren'].sort())
})

test('checks the laboratory container UUID, name and create permission before POST', async () => {
  const wrongName = makeFake({ rootName: 'GD_JERARQUIAS' })
  await assert.rejects(client(wrongName).createEvent(), /HIERARCHY_AUDIT_LAB_CONTAINER_INVALID/)
  assert.equal(wrongName.calls.some((call) => call.method === 'POST' && call.pathname.endsWith('/children')), false)

  const forbiddenFake = makeFake()
  const forbiddenRoot = { id: labId, name: 'GD_JERARQUIAS_LAB', nodeType: 'cm:folder', isFolder: true, allowableOperations: [] }
  const originalFetch = forbiddenFake.fetchImpl
  forbiddenFake.fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith(`/nodes/${labId}`)) return response(200, { entry: forbiddenRoot })
    return originalFetch(url, options)
  }
  await assert.rejects(client(forbiddenFake).createEvent(), /HIERARCHY_AUDIT_LAB_CREATE_FORBIDDEN/)
  assert.equal(forbiddenFake.calls.some((call) => call.method === 'POST' && call.pathname.endsWith('/children')), false)
})

test('rejects a mismatched existing event and reports authentication, 403, 404 and 409 failures', async () => {
  const duplicate = makeFake()
  const lab = client(duplicate)
  const first = await lab.createEvent()
  duplicate.nodes.get(first.id).properties['gdo:actorEvento'] = 'OTHER_FAKE_ACTOR'
  await assert.rejects(lab.createEvent(), /HIERARCHY_AUDIT_LAB_DUPLICATE_CONFLICT/)
  assert.equal(duplicate.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, 1)

  const unauthorized = makeFake({ rootStatus: 401 })
  await assert.rejects(client(unauthorized).getLabContainer(), (error) => error.status === 401)
  const forbidden = makeFake({ rootStatus: 403 })
  await assert.rejects(client(forbidden).getLabContainer(), (error) => error.status === 403)

  const missing = makeFake()
  const missingClient = client(missing)
  await assert.rejects(missingClient.getEvent('40000000-0000-4000-8000-000000000001'), (error) => error.status === 404)

  const conflict = makeFake({ postStatus: 409 })
  await assert.rejects(client(conflict).createEvent(), (error) => error.status === 409)
})
