import { createHash } from 'node:crypto'
import { createHierarchyServiceClient } from './hierarchyServiceClient.js'

const configType = 'gdc:tiemposRespuesta'
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const propertyNames = [
  'codigoDependencia', 'normalValor', 'normalUnidad', 'altaValor', 'altaUnidad',
  'urgenteValor', 'urgenteUnidad', 'revisionConfiguracion', 'idOperacion', 'modificadoPor', 'fechaModificacion',
]

function failure(code, status = 502, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra })
}

function nodeName(dependency) {
  return `GDC_TIEMPOS_${dependency.toUpperCase()}`
}

function revisionFor(dependency, previousRevision, operationId, values) {
  return `RT1_${createHash('sha256').update(JSON.stringify([dependency, previousRevision || '', operationId, values])).digest('hex')}`
}

function toProperties({ dependency, values, revision, operationId, actorId, modifiedAt }) {
  const byPriority = Object.fromEntries(values.map((value) => [value.priority, value]))
  return {
    'gdc:codigoDependencia': dependency.toUpperCase(),
    'gdc:normalValor': byPriority.NORMAL.value,
    'gdc:normalUnidad': byPriority.NORMAL.unit,
    'gdc:altaValor': byPriority.ALTA.value,
    'gdc:altaUnidad': byPriority.ALTA.unit,
    'gdc:urgenteValor': byPriority.URGENTE.value,
    'gdc:urgenteUnidad': byPriority.URGENTE.unit,
    'gdc:revisionConfiguracion': revision,
    'gdc:idOperacion': operationId,
    'gdc:modificadoPor': actorId,
    'gdc:fechaModificacion': modifiedAt,
  }
}

function mapEntry(entry, expectedParentId) {
  if (!entry || entry.nodeType !== configType || !entry.id || entry.parentId !== expectedParentId) {
    throw failure('RESPONSE_TIMES_CONFIG_NODE_INVALID', 502)
  }
  const source = entry.properties || {}
  const properties = Object.fromEntries(propertyNames.map((key) => [key, source[`gdc:${key}`]]))
  const dependency = properties.codigoDependencia
  if (typeof dependency !== 'string' || !/^[A-Z0-9_-]{2,32}$/.test(dependency) || !properties.revisionConfiguracion ||
      !properties.idOperacion || !properties.modificadoPor || !properties.fechaModificacion || Number.isNaN(Date.parse(properties.fechaModificacion))) {
    throw failure('RESPONSE_TIMES_CONFIG_PROPERTIES_INVALID', 502)
  }
  const values = [
    { priority: 'NORMAL', value: properties.normalValor, unit: properties.normalUnidad },
    { priority: 'ALTA', value: properties.altaValor, unit: properties.altaUnidad },
    { priority: 'URGENTE', value: properties.urgenteValor, unit: properties.urgenteUnidad },
  ]
  if (values.some(({ value, unit }) => !Number.isSafeInteger(value) || value <= 0 ||
      !['DIAS', 'HORAS'].includes(unit) || value > (unit === 'DIAS' ? 365 : 8760))) {
    throw failure('RESPONSE_TIMES_CONFIG_PROPERTIES_INVALID', 502)
  }
  return {
    id: entry.id,
    name: entry.name,
    parentId: entry.parentId,
    dependency: dependency.toLowerCase(),
    revision: properties.revisionConfiguracion,
    operationId: properties.idOperacion || '',
    actorId: properties.modificadoPor || '',
    modifiedAt: properties.fechaModificacion || null,
    values,
    allowableOperations: entry.allowableOperations || [],
  }
}

export function responseTimesAlfrescoConfigurationReady(settings) {
  const config = settings?.responseTimes || {}
  const hierarchy = settings?.hierarchyService || {}
  const otherIds = [hierarchy.containerNodeId, hierarchy.auditContainerNodeId, hierarchy.labContainerNodeId].filter(Boolean)
  return config.storage === 'alfresco' && Boolean(config.username && config.password && settings?.alfrescoTarget) &&
    uuidPattern.test(config.containerNodeId || '') &&
    !otherIds.some((other) => other.toLowerCase() === config.containerNodeId.toLowerCase())
}

export function createResponseTimesAlfrescoRepository(settings, { client, allowWrites = false, fetchImpl = globalThis.fetch } = {}) {
  const responseConfig = settings?.responseTimes || {}
  const containerId = responseConfig.containerNodeId
  const ready = responseTimesAlfrescoConfigurationReady(settings)
  const alfrescoSettings = {
    alfrescoTarget: settings?.alfrescoTarget,
    hierarchyService: {
      username: responseConfig.username,
      password: responseConfig.password,
      containerNodeId: containerId,
      storage: 'alfresco',
    },
  }
  const serviceClient = client || createHierarchyServiceClient(alfrescoSettings, fetchImpl)
  let containerPromise
  let typePromise

  function assertConfigured() {
    if (!ready) throw failure('RESPONSE_TIMES_ALFRESCO_CONFIGURATION_INVALID', 503)
  }

  function assertWrites() {
    assertConfigured()
    if (allowWrites === false) throw failure('RESPONSE_TIMES_WRITES_DISABLED', 409)
    if (typeof allowWrites === 'function' && allowWrites() !== true) throw failure('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE', 409)
    if (allowWrites !== true && typeof allowWrites !== 'function') throw failure('RESPONSE_TIMES_WRITES_DISABLED', 409)
  }

  async function getContainer() {
    assertConfigured()
    if (!containerPromise) {
      containerPromise = serviceClient.getNode(containerId).then((entry) => {
        if (entry.id !== containerId || entry.name !== 'GD_CONFIGURACION_TIEMPOS_RESPUESTA' || entry.isFolder !== true) {
          throw failure('RESPONSE_TIMES_CONFIG_CONTAINER_INVALID', 409)
        }
        return entry
      }).catch((error) => {
        containerPromise = undefined
        throw error
      })
    }
    return containerPromise
  }

  async function verifyType() {
    assertConfigured()
    if (!typePromise) {
      typePromise = serviceClient.inspectType('tiemposRespuesta').then((result) => {
        if (result.missingProperties.length) throw failure('RESPONSE_TIMES_MODEL_INCOMPLETE', 503)
        return result
      }).catch((error) => {
        typePromise = undefined
        throw error
      })
    }
    return typePromise
  }

  async function listRaw() {
    const container = await getContainer()
    const entries = []
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const page = await serviceClient.listNodeChildren(container.id, { maxItems: 100, skipCount })
      entries.push(...page.entries.filter((entry) => entry.nodeType === configType))
      hasMoreItems = page.hasMoreItems
      if (hasMoreItems && page.entries.length === 0) throw failure('RESPONSE_TIMES_PAGINATION_INVALID', 502)
      skipCount += page.entries.length
      if (skipCount > 10_000) throw failure('RESPONSE_TIMES_CONFIG_LIMIT_EXCEEDED', 502)
    }
    return entries
  }

  async function getByDependency(dependency) {
    assertConfigured()
    await verifyType()
    if (typeof dependency !== 'string' || !/^[a-z0-9_-]{2,32}$/i.test(dependency)) throw failure('RESPONSE_TIMES_DEPENDENCY_INVALID', 400)
    const entries = await listRaw()
    const matching = entries.filter((entry) => String(entry.properties?.['gdc:codigoDependencia'] || '').toLowerCase() === dependency.toLowerCase())
    if (matching.length > 1) throw failure('RESPONSE_TIMES_DUPLICATE_CONFIGURATION', 409)
    if (!matching.length) return null
    const entry = await serviceClient.getNode(matching[0].id)
    return mapEntry(entry, containerId)
  }

  async function canWrite(configuration = null, dependency = 'dsa') {
    assertConfigured()
    if (allowWrites === false) return false
    if (typeof allowWrites === 'function' && allowWrites() !== true) throw failure('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE', 409)
    if (allowWrites !== true && typeof allowWrites !== 'function') return false
    if (dependency.toLowerCase() !== 'dsa') return false
    const container = await getContainer()
    await verifyType()
    if (!configuration) return container.allowableOperations?.includes('create') === true
    return configuration.parentId === containerId && configuration.name === nodeName(dependency) &&
      configuration.allowableOperations?.includes('update') === true
  }

  async function save({ dependency, values, expectedRevision, operationId, actorId }) {
    assertWrites()
    if (dependency.toLowerCase() !== 'dsa') throw failure('RESPONSE_TIMES_PILOT_DSA_ONLY', 403)
    if (!actorId || !operationId || !Array.isArray(values)) throw failure('RESPONSE_TIMES_INVALID_INPUT', 400)
    const container = await getContainer()
    await verifyType()
    const current = await getByDependency(dependency)
    if (current?.operationId === operationId) {
      if (current.actorId !== actorId || JSON.stringify(current.values) !== JSON.stringify(values)) {
        throw failure('RESPONSE_TIMES_OPERATION_ID_CONFLICT', 409)
      }
      return { ...current, reused: true }
    }
    if ((current?.revision || null) !== (expectedRevision || null)) {
      throw failure('RESPONSE_TIMES_REVISION_CONFLICT', 409, { currentRevision: current?.revision || null })
    }
    if (!current && !container.allowableOperations?.includes('create')) throw failure('RESPONSE_TIMES_CONFIG_CREATE_FORBIDDEN', 403)
    if (current && (current.parentId !== containerId || current.name !== nodeName(dependency))) {
      throw failure('RESPONSE_TIMES_CONFIG_OUT_OF_SCOPE', 409)
    }
    if (current && !current.allowableOperations?.includes('update')) throw failure('RESPONSE_TIMES_CONFIG_UPDATE_FORBIDDEN', 403)

    const revision = revisionFor(dependency, current?.revision, operationId, values)
    const properties = toProperties({ dependency, values, revision, operationId, actorId, modifiedAt: new Date().toISOString() })
    try {
      if (!current) {
        await serviceClient.createChild(container.id, { name: nodeName(dependency), nodeType: configType, properties })
      } else {
        await serviceClient.updateNode(current.id, properties)
      }
    } catch (error) {
      if (error.status === 403 || error.status === 409) throw error
      try {
        const reconciled = await getByDependency(dependency)
        if (reconciled?.operationId === operationId && reconciled.actorId === actorId &&
            JSON.stringify(reconciled.values) === JSON.stringify(values)) return { ...reconciled, reused: true, reconciled: true }
        if (reconciled && !current && reconciled.operationId !== operationId) {
          throw failure('RESPONSE_TIMES_DUPLICATE_CONFIGURATION', 409, { operationId })
        }
      } catch (readError) {
        if (readError.code === 'RESPONSE_TIMES_DUPLICATE_CONFIGURATION') throw readError
      }
      throw failure('RESPONSE_TIMES_OPERATION_UNCERTAIN', 503, { operationId, operationStatus: 'PARCIAL' })
    }
    let verified
    try { verified = await getByDependency(dependency) } catch {
      throw failure('RESPONSE_TIMES_OPERATION_UNCERTAIN', 503, { operationId, operationStatus: 'PARCIAL' })
    }
    if (!verified || verified.operationId !== operationId || verified.actorId !== actorId ||
        JSON.stringify(verified.values) !== JSON.stringify(values) || verified.revision !== revision ||
        (current && verified.id !== current.id)) {
      throw failure('RESPONSE_TIMES_VERIFICATION_FAILED', 503, { operationId, operationStatus: 'PARCIAL' })
    }
    return verified
  }

  return { getContainer, listRaw, getByDependency, canWrite, save }
}

export { configType as RESPONSE_TIMES_CONFIG_TYPE, propertyNames as RESPONSE_TIMES_CONFIG_PROPERTIES }
