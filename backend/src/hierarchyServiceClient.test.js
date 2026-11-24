import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyServiceClient } from './hierarchyServiceClient.js'

const containerId = '11111111-1111-4111-8111-111111111111'
const auditContainerId = '22222222-2222-4222-8222-222222222222'
const labContainerId = '33333333-3333-4333-8333-333333333333'
const settings = {
  alfrescoTarget: 'https://alfresco.test',
  hierarchyService: {
    username: 'gd_jerarquias_servicio',
    password: 'not-a-real-secret',
    containerNodeId: containerId,
    auditContainerNodeId: auditContainerId,
    labContainerNodeId: labContainerId,
    storage: 'alfresco',
  },
}

test('classic authority paging keeps both institutional members and rejects incomplete or nested authority responses', async () => {
  let mode = 'complete'
  const skips = []
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return response(201, { entry: { id: 'ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: { id: settings.hierarchyService.username, enabled: true, capabilities: { isAdmin: false } } })
    assert.equal(parsed.pathname, '/alfresco/service/api/groups/GD_DSA/children')
    const skipCount = Number(parsed.searchParams.get('skipCount'))
    skips.push(skipCount)
    return response(200, { data: mode === 'truncated' && skipCount ? [] : [
      { shortName: skipCount ? 'head-two' : 'head-one', authorityType: mode === 'nested' ? 'GROUP' : 'USER' },
    ], paging: { skipCount, totalItems: 2 } })
  }
  const client = createHierarchyServiceClient(settings, fetchImpl)
  assert.deepEqual((await client.getInstitutionalGroupMembers('GROUP_GD_DSA')).map(p => p.id), ['head-one', 'head-two'])
  assert.deepEqual(skips, [0, 1])
  mode = 'truncated'
  await assert.rejects(client.getInstitutionalGroupMembers('GROUP_GD_DSA'), /INVALID_RESPONSE/)
  mode = 'nested'
  await assert.rejects(client.getInstitutionalGroupMembers('GROUP_GD_DSA'), /NESTED_GROUPS_UNSUPPORTED/)
})

test('malformed child rows and mismatched pagination never disappear from an institutional snapshot', async () => {
  for (const list of [
    { entries: [{ entry: {} }], pagination: { hasMoreItems: false } },
    { entries: [], pagination: { hasMoreItems: false, skipCount: 5 } },
    { entries: [{ entry: { id: 'unit-fixture' } }], pagination: { hasMoreItems: false, count: 2 } },
  ]) {
    const fetchImpl = async url => {
      if (url.includes('/tickets')) return response(201, { entry: { id: 'ticket' } })
      if (url.includes('/people/-me-')) return response(200, { entry: { id: settings.hierarchyService.username, enabled: true, capabilities: { isAdmin: false } } })
      return response(200, { list })
    }
    await assert.rejects(createHierarchyServiceClient(settings, fetchImpl).listNodeChildren(containerId), /CONTAINER_CHILDREN_INVALID/)
  }
})

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function createFetch({ identity = { id: settings.hierarchyService.username, enabled: true, capabilities: { isAdmin: false } }, containerName = 'GD_JERARQUIAS' } = {}) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    calls.push({ method: options.method || 'GET', pathname: parsed.pathname })
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return response(201, { entry: { id: 'fake-ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: identity })
    if (parsed.pathname.endsWith(`/nodes/${containerId}`)) return response(200, { entry: { id: containerId, name: containerName, nodeType: 'cm:folder', permissions: { isInheritanceEnabled: false }, allowableOperations: ['update'] } })
    if (parsed.pathname.endsWith(`/nodes/${auditContainerId}`)) return response(200, { entry: { id: auditContainerId, name: 'GD_JERARQUIAS_AUDITORIA', nodeType: 'cm:folder', isFolder: true, allowableOperations: ['create'] } })
    if (parsed.pathname.endsWith(`/nodes/${containerId}/children`)) return response(200, { list: { entries: [], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith('/groups/GROUP_GD_DSA/members')) return response(200, { list: { entries: [{ entry: { id: 'user-dsa-1' } }], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith('/groups/GROUP_GD_DIRECCION/members')) return response(200, { list: { entries: [], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith('/groups/GROUP_GD_JEFE_UNIDAD/members')) return response(200, { list: { entries: [], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith('/groups/GROUP_GD_ESPECIALISTA/members')) return response(200, { list: { entries: [], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith('/people/user-dsa-1')) return response(200, { entry: { id: 'user-dsa-1', enabled: true } })
    if (parsed.pathname.endsWith('/service/api/classes/gdo_unidad')) return response(200, { properties: ['codigoDependencia', 'codigoUnidad', 'descripcionUnidad', 'estadoUnidad', 'nombreUnidad'].map((name) => ({ name })) })
    if (parsed.pathname.endsWith('/service/api/classes/gdo_asignacion')) return response(200, { properties: ['idUsuario', 'idUnidad', 'dependenciaAsignacion', 'rolAsignacion', 'estadoAsignacion', 'asignadoPor'].map((name) => ({ name })) })
    if (parsed.pathname.endsWith('/service/api/classes/gdo_eventoJerarquia')) return response(200, { properties: [
      'claveEvento', 'idOperacionEvento', 'faseEvento', 'accionEvento', 'dependenciaEvento', 'idUnidadEvento',
      'idAsignacionEvento', 'idUsuarioEvento', 'actorEvento', 'fechaEvento', 'datosAntesEvento', 'datosDespuesEvento',
      'revisionAntesEvento', 'revisionDespuesEvento', 'codigoErrorEvento',
    ].map((name) => ({ name })) })
    return response(404, { error: 'not found' })
  }
  return { fetchImpl, calls }
}

test('read-only diagnostic verifies dedicated identity, container, groups, people and model types', async () => {
  const { fetchImpl, calls } = createFetch()
  const client = createHierarchyServiceClient(settings, fetchImpl)
  const report = await client.runReadOnlyDiagnostics({
    dependencies: { DSA: 'GROUP_GD_DSA' },
    functions: { direccion: 'GROUP_GD_DIRECCION', 'jefe-unidad': 'GROUP_GD_JEFE_UNIDAD', especialista: 'GROUP_GD_ESPECIALISTA' },
  })
  assert.equal(report.authentication.id, 'gd_jerarquias_servicio')
  assert.equal(report.authentication.enabled, true)
  assert.equal(report.authentication.isAdmin, false)
  assert.equal(report.container.name, 'GD_JERARQUIAS')
  assert.equal(report.container.inheritanceEnabled, false)
  assert.equal(report.auditContainer.id, auditContainerId)
  assert.equal(report.auditContainer.readable, true)
  assert.equal(report.people.enabledCount, 1)
  assert.ok(Object.values(report.model.types).every((type) => type.available && type.missingProperties.length === 0))
  assert.equal(report.model.types.eventoJerarquia.missingProperties.length, 0)
  assert.ok(calls.some((call) => call.method === 'POST' && call.pathname.endsWith('/tickets')))
  assert.ok(calls.filter((call) => call.method !== 'GET').every((call) => call.pathname.endsWith('/tickets')))
})

test('diagnostic rejects an unexpected, disabled, or administrator service identity', async () => {
  for (const identity of [
    { id: 'other-service', enabled: true, capabilities: { isAdmin: false } },
    { id: settings.hierarchyService.username, enabled: false, capabilities: { isAdmin: false } },
    { id: settings.hierarchyService.username, enabled: true, capabilities: { isAdmin: true } },
  ]) {
    const { fetchImpl } = createFetch({ identity })
    const client = createHierarchyServiceClient(settings, fetchImpl)
    await assert.rejects(client.getAuthorization(), /HIERARCHY_SERVICE_IDENTITY_INVALID/)
  }
})

test('diagnostic rejects a different container name and invalid configuration before network access', async () => {
  const { fetchImpl } = createFetch({ containerName: 'OTHER_FOLDER' })
  const client = createHierarchyServiceClient(settings, fetchImpl)
  await assert.rejects(client.runReadOnlyDiagnostics({ dependencies: { DSA: 'GROUP_GD_DSA' }, functions: { direccion: 'GROUP_GD_DIRECCION' } }), /HIERARCHY_CONTAINER_NAME_MISMATCH/)

  let calls = 0
  const unconfigured = createHierarchyServiceClient({ ...settings, hierarchyService: { ...settings.hierarchyService, password: '' } }, async () => { calls++ })
  await assert.rejects(unconfigured.getAuthorization(), /HIERARCHY_SERVICE_CREDENTIALS_REQUIRED/)
  assert.equal(calls, 0)
})

test('diagnostic requires three distinct configured hierarchy, lab and audit containers', async () => {
  let calls = 0
  const duplicateContainers = createHierarchyServiceClient({
    ...settings,
    hierarchyService: { ...settings.hierarchyService, auditContainerNodeId: containerId },
  }, async () => { calls++; return response(200, {}) })
  await assert.rejects(duplicateContainers.runReadOnlyDiagnostics({
    dependencies: { DSA: 'GROUP_GD_DSA' }, functions: { direccion: 'GROUP_GD_DIRECCION' },
  }), /HIERARCHY_CONTAINERS_MUST_BE_DISTINCT/)
  assert.equal(calls, 0)
})

test('read-only group inspection follows nested groups and queries live person memberships', async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return response(201, { entry: { id: 'ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: { id: settings.hierarchyService.username, enabled: true, capabilities: { isAdmin: false } } })
    if (parsed.pathname.endsWith('/groups/GROUP_GD_DIRECCION')) return response(200, { entry: { id: 'GROUP_GD_DIRECCION', displayName: 'Dirección' } })
    if (parsed.pathname.endsWith('/groups/GROUP_SUB')) return response(200, { entry: { id: 'GROUP_SUB', displayName: 'Subgrupo' } })
    if (parsed.pathname.endsWith('/groups/GROUP_GD_DIRECCION/members')) return response(200, { list: { entries: [
      { entry: { id: 'director-1', memberType: 'PERSON' } },
      { entry: { id: 'GROUP_SUB', memberType: 'GROUP' } },
    ], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith('/groups/GROUP_SUB/members')) return response(200, { list: { entries: [
      { entry: { id: 'director-2', memberType: 'PERSON' } },
    ], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith('/people/director-2/groups')) return response(200, { list: { entries: [
      { entry: { id: 'GROUP_GD_DIRECCION', displayName: 'Dirección' } },
      { entry: { id: 'GROUP_GD_DSA', displayName: 'DSA' } },
    ], pagination: { hasMoreItems: false } } })
    return response(404, {})
  }
  const client = createHierarchyServiceClient(settings, fetchImpl)
  const tree = await client.inspectGroupHierarchy('GROUP_GD_DIRECCION')
  assert.equal(tree.root.displayName, 'Dirección')
  assert.deepEqual(tree.groups.map((group) => group.id), ['GROUP_GD_DIRECCION', 'GROUP_SUB'])
  assert.deepEqual(tree.people.map((person) => person.id), ['director-1', 'director-2'])
  assert.equal(tree.people.find((person) => person.id === 'director-2').groupPaths[0].depth, 1)
  const memberships = await client.getPersonGroups('director-2')
  assert.deepEqual(memberships.map((group) => group.id), ['GROUP_GD_DIRECCION', 'GROUP_GD_DSA'])
})

test('group inspection surfaces permission errors without masking them', async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return response(201, { entry: { id: 'ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: { id: settings.hierarchyService.username, enabled: true, capabilities: { isAdmin: false } } })
    if (parsed.pathname.endsWith('/groups/GROUP_GD_DIRECCION')) return response(403, { error: 'forbidden' })
    return response(404, {})
  }
  const client = createHierarchyServiceClient(settings, fetchImpl)
  await assert.rejects(client.inspectGroupHierarchy('GROUP_GD_DIRECCION'), /HIERARCHY_ALFRESCO_HTTP_403/)
})
