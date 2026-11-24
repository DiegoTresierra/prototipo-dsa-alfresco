import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyPersistenceClient } from './hierarchyPersistenceClient.js'

const productionContainerId = 'd0c78bf2-35f2-4f7c-878b-f235f21f7c93'
const labContainerId = 'a0c78bf2-35f2-4f7c-878b-f235f21f7c94'
const unitId = 'b0c78bf2-35f2-4787-878b-f235f21f7c95'
const assignmentId = 'c0c78bf2-35f2-4787-878b-f235f21f7c96'
const runId = 'LAB-TEST-001'
const settings = {
  alfrescoTarget: 'https://alfresco.test',
  hierarchyService: {
    username: 'gd_jerarquias_servicio',
    password: 'not-a-real-secret',
    containerNodeId: productionContainerId,
    storage: 'alfresco',
  },
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function makeNode({ id, name, nodeType, parentId, properties = {}, folder = false, operations = ['update', 'create'] }) {
  return {
    id, name, nodeType, parentId, properties, isFolder: folder,
    allowableOperations: operations,
    permissions: { isInheritanceEnabled: false },
    createdAt: '2026-11-19T10:00:00.000Z',
    modifiedAt: '2026-11-19T10:00:00.000Z',
    createdByUser: { id: 'gd_jerarquias_servicio' },
    modifiedByUser: { id: 'gd_jerarquias_servicio' },
  }
}

function createFakeAlfresco({ rootStatus = 200, paginateRoot = false, postStatus = 201, commitBeforePostError = false } = {}) {
  const nodes = new Map([[labContainerId, makeNode({
    id: labContainerId, name: 'GD_JERARQUIAS_LAB', nodeType: 'cm:folder', folder: true,
    operations: ['create', 'update'],
  })]])
  const childrenByParent = new Map([[labContainerId, []]])
  if (paginateRoot) {
    for (const [id, name] of [
      ['e0c78bf2-35f2-4787-878b-f235f21f7c97', 'ZZ_LAB_PAGINATION_MARKER_A'],
      ['f0c78bf2-35f2-4787-878b-f235f21f7c98', 'ZZ_LAB_PAGINATION_MARKER_B'],
    ]) {
      nodes.set(id, makeNode({ id, name, nodeType: 'cm:folder', parentId: labContainerId, folder: true }))
      childrenByParent.get(labContainerId).push(id)
    }
  }
  const calls = []
  let postCount = 0
  let failPostOnce = false

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    const method = options.method || 'GET'
    calls.push({ method, pathname: parsed.pathname, search: parsed.search, body: options.body ? JSON.parse(options.body) : undefined })
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return jsonResponse(201, { entry: { id: 'fake-ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return jsonResponse(200, { entry: {
      id: 'gd_jerarquias_servicio', enabled: true, capabilities: { isAdmin: false },
    } })

    const rootNodeMatch = parsed.pathname.match(new RegExp(`/nodes/${labContainerId}$`))
    if (rootNodeMatch && method === 'GET') {
      if (rootStatus !== 200) return jsonResponse(rootStatus, { error: `HTTP_${rootStatus}` })
      return jsonResponse(200, { entry: nodes.get(labContainerId) })
    }

    const childrenMatch = parsed.pathname.match(/\/nodes\/([^/]+)\/children$/)
    if (childrenMatch && method === 'GET') {
      const parentId = decodeURIComponent(childrenMatch[1])
      const children = (childrenByParent.get(parentId) || []).map((id) => nodes.get(id)).filter(Boolean)
      const skip = Number(parsed.searchParams.get('skipCount') || 0)
      const page = paginateRoot && parentId === labContainerId
        ? children.slice(skip, skip + 1)
        : children.slice(skip, skip + 100)
      return jsonResponse(200, { list: { entries: page.map((entry) => ({ entry })), pagination: { hasMoreItems: skip + page.length < children.length } } })
    }

    const nodeMatch = parsed.pathname.match(/\/nodes\/([^/]+)$/)
    if (nodeMatch) {
      const id = decodeURIComponent(nodeMatch[1])
      const node = nodes.get(id)
      if (!node) return jsonResponse(404, { error: 'NOT_FOUND' })
      if (method === 'GET') return jsonResponse(200, { entry: node })
      if (method === 'PUT') {
        Object.assign(node.properties, options.body ? JSON.parse(options.body).properties : {})
        node.modifiedAt = '2026-11-19T10:05:00.000Z'
        return jsonResponse(200, { entry: node })
      }
    }

    if (childrenMatch && method === 'POST') {
      postCount++
      if (failPostOnce) {
        failPostOnce = false
        if (commitBeforePostError) addNode(decodeURIComponent(childrenMatch[1]), JSON.parse(options.body))
        throw new Error('simulated connection interruption')
      }
      if (postStatus !== 201) return jsonResponse(postStatus, { error: `HTTP_${postStatus}` })
      const created = addNode(decodeURIComponent(childrenMatch[1]), JSON.parse(options.body))
      return jsonResponse(201, { entry: created })
    }
    return jsonResponse(404, { error: 'NOT_FOUND' })
  }

  function addNode(parentId, body) {
    const id = body.nodeType === 'gdo:unidad' ? unitId : assignmentId
    if (nodes.has(id) || (childrenByParent.get(parentId) || []).some((childId) => nodes.get(childId)?.name === body.name)) {
      return null
    }
    const created = makeNode({ id, name: body.name, nodeType: body.nodeType, parentId, properties: body.properties,
      folder: body.nodeType === 'gdo:unidad', operations: ['create', 'update'] })
    nodes.set(id, created)
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
    childrenByParent.get(parentId).push(id)
    if (created.isFolder) childrenByParent.set(id, [])
    return created
  }

  return {
    fetchImpl,
    calls,
    nodes,
    failNextPost({ commit = false } = {}) { failPostOnce = true; commitBeforePostError = commit },
    get postCount() { return postCount },
    addNode,
  }
}

function clientFor(fake, options = {}) {
  return createHierarchyPersistenceClient(settings, {
    labContainerNodeId: labContainerId,
    runId,
    confirmLabWrites: true,
    fetchImpl: fake.fetchImpl,
    ...options,
  })
}

test('creates and reads a fictional unit and assignment, then verifies assignment deactivation', async () => {
  const fake = createFakeAlfresco()
  const client = clientFor(fake)
  const unit = await client.createUnit()
  const unitRead = await client.getNode(unit.id)
  assert.equal(unitRead.nodeType, 'gdo:unidad')
  assert.equal(unitRead.properties['gdo:codigoDependencia'], 'LABORATORIO')
  assert.equal(unitRead.properties['gdo:estadoUnidad'], 'ACTIVA')

  const assignment = await client.createAssignment(unit.id)
  const assignmentRead = await client.getNode(assignment.id)
  assert.equal(assignmentRead.nodeType, 'gdo:asignacion')
  assert.equal(assignmentRead.parentId, unit.id)
  assert.equal(assignmentRead.properties['gdo:idUnidad'], unit.id)
  assert.match(assignmentRead.properties['gdo:idUsuario'], /^LAB_NO_REAL_/)
  assert.match(assignmentRead.properties['gdo:asignadoPor'], /^LAB_OPERATOR_/)
  assert.equal(fake.calls.find((call) => call.method === 'POST' && call.pathname.endsWith('/children') && call.body.nodeType === 'gdo:asignacion').body.content, undefined)

  const inactive = await client.updateAssignmentStatus(assignment.id, unit.id, 'INACTIVA')
  assert.equal(inactive.properties['gdo:estadoAsignacion'], 'INACTIVA')
  assert.equal((await client.getNode(assignment.id)).properties['gdo:estadoAsignacion'], 'INACTIVA')
  assert.ok(fake.calls.some((call) => call.method === 'PUT' && call.pathname.endsWith(`/nodes/${assignment.id}`)))
  assert.ok(fake.calls.every((call) => call.method !== 'DELETE'))
})

test('lists all pages and reuses a matching deterministic unit without duplicating POST', async () => {
  const fake = createFakeAlfresco({ paginateRoot: true })
  const firstClient = clientFor(fake)
  const unit = await firstClient.createUnit()
  const reused = await clientFor(fake).createUnit()
  assert.equal(reused.id, unit.id)
  assert.equal(reused.reused, true)
  assert.equal(fake.postCount, 1)
  assert.ok(fake.calls.some((call) => call.method === 'GET' && call.search.includes('skipCount=1')))
})

test('recovers an uncertain POST on a manual rerun with the same RUN_ID, without automatic retry', async () => {
  const fake = createFakeAlfresco()
  fake.failNextPost({ commit: true })
  const client = clientFor(fake)
  await assert.rejects(client.createUnit(), /HIERARCHY_WRITE_OUTCOME_UNKNOWN/)
  assert.equal(fake.postCount, 1)
  const rerun = await clientFor(fake).createUnit()
  assert.equal(rerun.id, unitId)
  assert.equal(rerun.reused, true)
  assert.equal(fake.postCount, 1)
})

test('rejects mismatched deterministic duplicates with 409', async () => {
  const fake = createFakeAlfresco()
  fake.addNode(labContainerId, { name: 'ZZ_LAB_UNIDAD_LAB-TEST-001', nodeType: 'gdo:unidad', properties: { 'gdo:nombreUnidad': 'NOT_THE_EXPECTED_UNIT' } })
  const client = clientFor(fake)
  await assert.rejects(client.createUnit(), (error) => error.status === 409 && error.code === 'HIERARCHY_LAB_DUPLICATE_CONFLICT')
  assert.equal(fake.postCount, 0)
})

test('does not retry POST after a 409 response', async () => {
  const fake = createFakeAlfresco({ postStatus: 409 })
  const client = clientFor(fake)
  await assert.rejects(client.createUnit(), (error) => error.status === 409)
  assert.equal(fake.postCount, 1)
})

test('reports Alfresco 401, 403 and 404 responses without exposing request data', async () => {
  for (const status of [401, 403, 404]) {
    const fake = createFakeAlfresco({ rootStatus: status })
    const client = clientFor(fake)
    await assert.rejects(client.getLabContainer(), (error) => error.status === status && error.code === `HIERARCHY_ALFRESCO_HTTP_${status}`)
  }
})

test('rejects missing confirmation, invalid RUN_ID, missing lab container, and the definitive container before network access', async () => {
  const fake = createFakeAlfresco()
  await assert.rejects(clientFor(fake, { confirmLabWrites: false }).createUnit(), /HIERARCHY_LAB_CONFIRMATION_REQUIRED/)
  await assert.rejects(clientFor(fake, { runId: '' }).createUnit(), /HIERARCHY_LAB_RUN_ID_INVALID/)
  await assert.rejects(clientFor(fake, { labContainerNodeId: '' }).createUnit(), /HIERARCHY_LAB_CONTAINER_REQUIRED/)
  await assert.rejects(clientFor(fake, { labContainerNodeId: productionContainerId }).createUnit(), /HIERARCHY_LAB_CONTAINER_MUST_BE_SEPARATE/)
  assert.equal(fake.calls.length, 0)
})

test('rejects a lab folder with the wrong name or a non-folder node', async () => {
  const fake = createFakeAlfresco()
  fake.nodes.set(labContainerId, makeNode({ id: labContainerId, name: 'GD_JERARQUIAS', nodeType: 'cm:folder', folder: true }))
  await assert.rejects(clientFor(fake).getLabContainer(), /HIERARCHY_LAB_CONTAINER_INVALID/)
  fake.nodes.set(labContainerId, makeNode({ id: labContainerId, name: 'GD_JERARQUIAS_LAB', nodeType: 'cm:content', folder: false }))
  await assert.rejects(clientFor(fake).getLabContainer(), /HIERARCHY_LAB_CONTAINER_INVALID/)
})

