import test from 'node:test'
import assert from 'node:assert/strict'
import { createResponseTimesAlfrescoRepository, responseTimesAlfrescoConfigurationReady } from './responseTimesAlfrescoRepository.js'

const ids = {
  config: '11111111-1111-4111-8111-111111111111', hierarchy: '33333333-3333-4333-8333-333333333333',
  hierarchyAudit: '44444444-4444-4444-8444-444444444444', lab: '55555555-5555-4555-8555-555555555555',
}
const settings = {
  alfrescoTarget: 'https://alfresco.test',
  hierarchyService: { containerNodeId: ids.hierarchy, auditContainerNodeId: ids.hierarchyAudit, labContainerNodeId: ids.lab },
  responseTimes: { storage: 'alfresco', username: 'service', password: 'secret', containerNodeId: ids.config },
}

function fakeAlfresco({ children = [], createAllowed = true } = {}) {
  const nodes = new Map(children.map((entry) => [entry.id, entry]))
  const calls = []
  const client = {
    async inspectType(type) { calls.push(['inspectType', type]); return { available: true, missingProperties: [] } },
    async getNode(id) {
      calls.push(['getNode', id])
      if (id === ids.config) return { id, name: 'GD_CONFIGURACION_TIEMPOS_RESPUESTA', isFolder: true, allowableOperations: createAllowed ? ['create'] : [] }
      const node = nodes.get(id)
      if (!node) throw Object.assign(new Error('not found'), { status: 404 })
      return structuredClone(node)
    },
    async listNodeChildren(parentId) { calls.push(['list', parentId]); return { entries: [...nodes.values()].map((entry) => structuredClone(entry)), hasMoreItems: false } },
    async createChild(parentId, body) {
      calls.push(['create', parentId])
      if (!createAllowed) throw Object.assign(new Error('forbidden'), { status: 403 })
      if ([...nodes.values()].some((entry) => entry.name === body.name)) throw Object.assign(new Error('duplicate'), { status: 409 })
      const id = `config-${nodes.size + 1}`
      nodes.set(id, { id, parentId, name: body.name, nodeType: body.nodeType, properties: body.properties, allowableOperations: ['update'] })
      return { id }
    },
    async updateNode(id, properties) {
      calls.push(['update', id])
      const current = nodes.get(id)
      if (!current?.allowableOperations?.includes('update')) throw Object.assign(new Error('forbidden'), { status: 403 })
      nodes.set(id, { ...current, properties: { ...current.properties, ...properties } })
      return { id }
    },
  }
  return { client, calls, nodes }
}

test('requires one configured response-time container distinct from hierarchy containers', async () => {
  assert.equal(responseTimesAlfrescoConfigurationReady(settings), true)
  assert.equal(responseTimesAlfrescoConfigurationReady({ ...settings, responseTimes: { ...settings.responseTimes, containerNodeId: ids.hierarchy } }), false)
  assert.equal(responseTimesAlfrescoConfigurationReady({ ...settings, responseTimes: { ...settings.responseTimes, containerNodeId: '' } }), false)
  const { client, calls } = fakeAlfresco()
  await assert.rejects(createResponseTimesAlfrescoRepository({ ...settings, responseTimes: { ...settings.responseTimes, storage: 'json' } }, { client }).getByDependency('dsa'), { code: 'RESPONSE_TIMES_ALFRESCO_CONFIGURATION_INVALID' })
  assert.deepEqual(calls, [])
})

test('reads an empty container without creating nodes', async () => {
  const { client, calls } = fakeAlfresco()
  assert.equal(await createResponseTimesAlfrescoRepository(settings, { client }).getByDependency('dsa'), null)
  assert.equal(calls.some(([method]) => method === 'create'), false)
})

test('maps a stored config including revision, last operation, actor and timestamp', async () => {
  const entry = {
    id: 'config-1', parentId: ids.config, name: 'GDC_TIEMPOS_DSA', nodeType: 'gdc:tiemposRespuesta',
    properties: {
      'gdc:codigoDependencia': 'DSA', 'gdc:normalValor': 5, 'gdc:normalUnidad': 'DIAS',
      'gdc:altaValor': 36, 'gdc:altaUnidad': 'HORAS', 'gdc:urgenteValor': 1, 'gdc:urgenteUnidad': 'DIAS',
      'gdc:revisionConfiguracion': 'r1', 'gdc:idOperacion': 'old-operation', 'gdc:modificadoPor': 'DSA_T', 'gdc:fechaModificacion': '2026-01-01T00:00:00Z',
    }, allowableOperations: ['update'],
  }
  const { client } = fakeAlfresco({ children: [entry] })
  const record = await createResponseTimesAlfrescoRepository(settings, { client }).getByDependency('dsa')
  assert.equal(record.dependency, 'dsa')
  assert.equal(record.revision, 'r1')
  assert.equal(record.operationId, 'old-operation')
  assert.equal(record.actorId, 'DSA_T')
  assert.equal(record.modifiedAt, '2026-01-01T00:00:00Z')
  assert.deepEqual(record.values[1], { priority: 'ALTA', value: 36, unit: 'HORAS' })
})

test('rejects duplicate configs and nodes outside the configured root', async () => {
  const base = { id: 'config-a', parentId: ids.config, name: 'GDC_TIEMPOS_DSA', nodeType: 'gdc:tiemposRespuesta', properties: { 'gdc:codigoDependencia': 'DSA' } }
  await assert.rejects(createResponseTimesAlfrescoRepository(settings, { client: fakeAlfresco({ children: [base, { ...base, id: 'config-b' }] }).client }).getByDependency('dsa'), { code: 'RESPONSE_TIMES_DUPLICATE_CONFIGURATION' })
  await assert.rejects(createResponseTimesAlfrescoRepository(settings, { client: fakeAlfresco({ children: [{ ...base, parentId: ids.hierarchyAudit }] }).client }).getByDependency('dsa'), { code: 'RESPONSE_TIMES_CONFIG_NODE_INVALID' })
})

test('creates a verified initial DSA config and persists its operation, actor and revision', async () => {
  const { client, calls, nodes } = fakeAlfresco()
  const repository = createResponseTimesAlfrescoRepository(settings, { client, allowWrites: true })
  assert.equal(await repository.canWrite(null, 'dsa'), true)
  const values = [
    { priority: 'NORMAL', value: 5, unit: 'DIAS' },
    { priority: 'ALTA', value: 36, unit: 'HORAS' },
    { priority: 'URGENTE', value: 8, unit: 'HORAS' },
  ]
  const created = await repository.save({ dependency: 'dsa', values, expectedRevision: null, operationId: 'operation-001', actorId: 'DSA_T' })
  assert.equal(created.id, 'config-1')
  assert.deepEqual(created.values, values)
  assert.equal(created.operationId, 'operation-001')
  assert.equal(created.actorId, 'DSA_T')
  assert.ok(created.revision)
  assert.equal(nodes.get(created.id).parentId, ids.config)
  assert.equal(calls.filter(([method]) => method === 'create').length, 1)
  assert.equal(calls.some(([method]) => method === 'update'), false)
})

test('updates the same UUID after expectedRevision validation and reconciles operation retries', async () => {
  const current = {
    id: 'stable-config-id', parentId: ids.config, name: 'GDC_TIEMPOS_DSA', nodeType: 'gdc:tiemposRespuesta', allowableOperations: ['update'],
    properties: {
      'gdc:codigoDependencia': 'DSA', 'gdc:normalValor': 5, 'gdc:normalUnidad': 'DIAS', 'gdc:altaValor': 3, 'gdc:altaUnidad': 'DIAS',
      'gdc:urgenteValor': 1, 'gdc:urgenteUnidad': 'DIAS', 'gdc:revisionConfiguracion': 'revision-old',
      'gdc:idOperacion': 'previous-op-001', 'gdc:modificadoPor': 'DSA_T', 'gdc:fechaModificacion': '2026-01-01T00:00:00Z',
    },
  }
  const { client, calls } = fakeAlfresco({ children: [current] })
  const repository = createResponseTimesAlfrescoRepository(settings, { client, allowWrites: true })
  const values = [
    { priority: 'NORMAL', value: 8, unit: 'HORAS' },
    { priority: 'ALTA', value: 3, unit: 'DIAS' },
    { priority: 'URGENTE', value: 1, unit: 'DIAS' },
  ]
  const updated = await repository.save({ dependency: 'dsa', values, expectedRevision: 'revision-old', operationId: 'operation-002', actorId: 'DSA_T' })
  assert.equal(updated.id, 'stable-config-id')
  assert.deepEqual(updated.values, values)
  assert.equal(calls.filter(([method]) => method === 'create').length, 0)
  assert.equal(calls.filter(([method]) => method === 'update').length, 1)
  const retry = await repository.save({ dependency: 'dsa', values, expectedRevision: 'revision-old', operationId: 'operation-002', actorId: 'DSA_T' })
  assert.equal(retry.reused, true)
  assert.equal(calls.filter(([method]) => method === 'update').length, 1)
  await assert.rejects(repository.save({ dependency: 'dsa', values, expectedRevision: 'revision-old', operationId: 'operation-002', actorId: 'OTHER' }), { code: 'RESPONSE_TIMES_OPERATION_ID_CONFLICT' })
})

test('rejects stale revisions, wrong dependency and duplicate config without writing', async () => {
  const current = {
    id: 'stable-config-id', parentId: ids.config, name: 'GDC_TIEMPOS_DSA', nodeType: 'gdc:tiemposRespuesta', allowableOperations: ['update'],
    properties: {
      'gdc:codigoDependencia': 'DSA', 'gdc:normalValor': 5, 'gdc:normalUnidad': 'DIAS', 'gdc:altaValor': 3, 'gdc:altaUnidad': 'DIAS',
      'gdc:urgenteValor': 1, 'gdc:urgenteUnidad': 'DIAS', 'gdc:revisionConfiguracion': 'r2',
      'gdc:idOperacion': 'old-operation', 'gdc:modificadoPor': 'DSA_T', 'gdc:fechaModificacion': '2026-01-01T00:00:00Z',
    },
  }
  const { client, calls } = fakeAlfresco({ children: [current] })
  const repository = createResponseTimesAlfrescoRepository(settings, { client, allowWrites: true })
  const values = [{ priority: 'NORMAL', value: 8, unit: 'HORAS' }, { priority: 'ALTA', value: 3, unit: 'DIAS' }, { priority: 'URGENTE', value: 1, unit: 'DIAS' }]
  await assert.rejects(repository.save({ dependency: 'dsa', values, expectedRevision: 'r1', operationId: 'operation-003', actorId: 'DSA_T' }), { code: 'RESPONSE_TIMES_REVISION_CONFLICT' })
  await assert.rejects(repository.save({ dependency: 'dti', values, expectedRevision: null, operationId: 'operation-003', actorId: 'DSA_T' }), { code: 'RESPONSE_TIMES_PILOT_DSA_ONLY' })
  assert.equal(calls.some(([method]) => method === 'update' || method === 'create'), false)
})

test('reconciles a create timeout by operationId and never blindly creates a second node', async () => {
  const { client, calls, nodes } = fakeAlfresco()
  const create = client.createChild
  client.createChild = async (...args) => {
    await create(...args)
    throw Object.assign(new Error('uncertain transport'), { code: 'HIERARCHY_WRITE_OUTCOME_UNKNOWN', status: 502 })
  }
  const repository = createResponseTimesAlfrescoRepository(settings, { client, allowWrites: true })
  const values = [
    { priority: 'NORMAL', value: 5, unit: 'DIAS' },
    { priority: 'ALTA', value: 3, unit: 'DIAS' },
    { priority: 'URGENTE', value: 12, unit: 'HORAS' },
  ]
  const result = await repository.save({ dependency: 'dsa', values, expectedRevision: null, operationId: 'uncertain-op-001', actorId: 'DSA_T' })
  assert.equal(result.reused, true)
  assert.equal(result.operationId, 'uncertain-op-001')
  assert.equal(nodes.size, 1)
  assert.equal(calls.filter(([method]) => method === 'create').length, 1)
})

test('reports a partial uncertain create when read-back cannot reconcile its operation', async () => {
  const { client } = fakeAlfresco()
  client.createChild = async () => { throw Object.assign(new Error('timeout'), { code: 'HIERARCHY_WRITE_OUTCOME_UNKNOWN', status: 502 }) }
  const repository = createResponseTimesAlfrescoRepository(settings, { client, allowWrites: true })
  await assert.rejects(repository.save({
    dependency: 'dsa', values: [{ priority: 'NORMAL', value: 5, unit: 'DIAS' }, { priority: 'ALTA', value: 3, unit: 'DIAS' }, { priority: 'URGENTE', value: 1, unit: 'DIAS' }],
    expectedRevision: null, operationId: 'uncertain-op-002', actorId: 'DSA_T',
  }), { code: 'RESPONSE_TIMES_OPERATION_UNCERTAIN', operationId: 'uncertain-op-002', operationStatus: 'PARCIAL' })
})

test('rejects explicit writes when the write flag is off', async () => {
  const repository = createResponseTimesAlfrescoRepository(settings, { client: fakeAlfresco().client })
  await assert.rejects(repository.save({ dependency: 'dsa', values: [], operationId: 'operation-001', actorId: 'DSA_T' }), { code: 'RESPONSE_TIMES_WRITES_DISABLED' })
})

test('requires the live pilot lease and effective Alfresco create permission', async () => {
  let held = true
  const { client, calls } = fakeAlfresco({ createAllowed: false })
  const repository = createResponseTimesAlfrescoRepository(settings, { client, allowWrites: () => held })
  await assert.rejects(repository.save({ dependency: 'dsa', values: [], operationId: 'operation-001', actorId: 'DSA_T' }), { code: 'RESPONSE_TIMES_CONFIG_CREATE_FORBIDDEN' })
  assert.equal(calls.some(([method]) => method === 'create'), false)
  held = false
  await assert.rejects(repository.save({ dependency: 'dsa', values: [], operationId: 'operation-001', actorId: 'DSA_T' }), { code: 'RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE' })
})
