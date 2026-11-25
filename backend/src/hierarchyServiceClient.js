import { readClassicInstitutionalGroup } from './dispatchDirectory.js'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

const corePath = '/alfresco/api/-default-/public/alfresco/versions/1'
const authenticationPath = '/alfresco/api/-default-/public/authentication/versions/1'
// Authentication state only: no institutional or documentary authority is cached.
// Separate transports and credential scopes cannot share tickets.
const authenticationPools = new WeakMap()
const groupIdPattern = /^GROUP_[A-Za-z0-9_-]+$/
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const expectedTypes = {
  unidad: {
    endpointName: 'gdo_unidad',
    properties: ['codigoDependencia', 'codigoUnidad', 'descripcionUnidad', 'estadoUnidad', 'nombreUnidad'],
  },
  asignacion: {
    endpointName: 'gdo_asignacion',
    properties: ['idUsuario', 'idUnidad', 'dependenciaAsignacion', 'rolAsignacion', 'estadoAsignacion', 'asignadoPor'],
  },
  eventoJerarquia: {
    endpointName: 'gdo_eventoJerarquia',
    properties: [
      'claveEvento', 'idOperacionEvento', 'faseEvento', 'accionEvento', 'dependenciaEvento',
      'idUnidadEvento', 'idAsignacionEvento', 'idUsuarioEvento', 'actorEvento', 'fechaEvento',
      'datosAntesEvento', 'datosDespuesEvento', 'revisionAntesEvento', 'revisionDespuesEvento', 'codigoErrorEvento',
    ],
  },
  tiemposRespuesta: {
    endpointName: 'gdc_tiemposRespuesta',
    properties: [
      'codigoDependencia', 'normalValor', 'normalUnidad', 'altaValor', 'altaUnidad',
      'urgenteValor', 'urgenteUnidad', 'revisionConfiguracion', 'idOperacion', 'modificadoPor', 'fechaModificacion',
    ],
  },
}

function failure(code, status = 502) {
  return Object.assign(new Error(code), { code, status })
}

function normalizeGroups(mapping = {}) {
  return [...new Set(Object.values(mapping).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean))]
}

function safePropertyName(value) {
  const name = typeof value === 'string' ? value : value?.name
  return typeof name === 'string' ? name.split(':').at(-1) : ''
}

export function createHierarchyServiceClient(settings, fetchImpl = globalThis.fetch) {
  function authenticationState() {
    let pool = authenticationPools.get(fetchImpl)
    if (!pool) { pool = new WeakMap(); authenticationPools.set(fetchImpl, pool) }
    const service = settings.hierarchyService
    const scope = createHash('sha256').update(JSON.stringify([settings.alfrescoTarget, service.username, service.password])).digest('hex')
    let state = pool.get(service)
    if (!state || state.scope !== scope) {
      state = { scope, authorization: null, verifiedUntil: 0, pending: null }
      pool.set(service, state)
    }
    return state
  }

  function assertConfigured() {
    const service = settings?.hierarchyService
    if (!service?.username || !service.password) throw failure('HIERARCHY_SERVICE_CREDENTIALS_REQUIRED', 503)
    if (!uuidPattern.test(service.containerNodeId || '')) throw failure('HIERARCHY_CONTAINER_NODE_ID_INVALID', 503)
    if (service.storage !== 'alfresco') throw failure('HIERARCHY_STORAGE_MUST_BE_ALFRESCO', 503)
    if (!settings?.alfrescoTarget) throw failure('ALFRESCO_TARGET_REQUIRED', 503)
  }

  async function request(path, { authorization, method = 'GET', body, base = settings.alfrescoTarget } = {}) {
    let response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw failure('HIERARCHY_ALFRESCO_NETWORK_ERROR', 502)
    }
    if (!response.ok) throw failure(`HIERARCHY_ALFRESCO_HTTP_${response.status}`, response.status)
    try {
      return await response.json()
    } catch {
      throw failure('HIERARCHY_ALFRESCO_INVALID_RESPONSE', 502)
    }
  }

  async function getAuthorization({ forceRefresh = false, rejectedAuthorization } = {}) {
    assertConfigured()
    const state = authenticationState()
    if (forceRefresh && state.authorization && (!rejectedAuthorization || rejectedAuthorization === state.authorization)) {
      state.authorization = null
      state.verifiedUntil = 0
    }
    if (state.pending) return state.pending
    if (state.authorization && Date.now() < state.verifiedUntil) return state.authorization
    const service = settings.hierarchyService
    state.pending = (async () => {
      try {
        let authorization = state.authorization
        if (!authorization) {
          const result = await request(`${authenticationPath}/tickets`, {
            method: 'POST', body: { userId: service.username, password: service.password },
            authorization: `Basic ${Buffer.from(`${service.username}:${service.password}`).toString('base64')}`,
          })
          if (typeof result?.entry?.id !== 'string' || !result.entry.id) throw failure('HIERARCHY_SERVICE_TICKET_INVALID', 502)
          authorization = `Basic ${Buffer.from(result.entry.id, 'utf8').toString('base64')}`
        }
        const identity = (await request(`${corePath}/people/-me-`, { authorization }))?.entry
        if (identity?.id !== service.username || identity.enabled !== true || identity.capabilities?.isAdmin !== false) {
          throw failure('HIERARCHY_SERVICE_IDENTITY_INVALID', 403)
        }
        state.authorization = authorization
        state.verifiedUntil = Date.now() + 4 * 60 * 1000
        return authorization
      } catch (error) {
        state.authorization = null
        state.verifiedUntil = 0
        throw error
      } finally { state.pending = null }
    })()
    return state.pending
  }

  async function getWithAuthorizationRetry(path, options = {}) {
    let authorization
    try {
      authorization = await getAuthorization()
      return await request(path, { ...options, authorization })
    } catch (error) {
      if (error.status !== 401) throw error
      authorization = await getAuthorization({ forceRefresh: true, rejectedAuthorization: authorization })
      return request(path, { ...options, authorization })
    }
  }

  async function getPerson(personId) {
    if (typeof personId !== 'string' || !personId.trim()) throw failure('HIERARCHY_PERSON_ID_REQUIRED', 400)
    const payload = await getWithAuthorizationRetry(`${corePath}/people/${encodeURIComponent(personId)}`)
    if (payload?.entry?.id !== personId || typeof payload.entry.enabled !== 'boolean') {
      throw failure('HIERARCHY_PERSON_RESPONSE_INVALID', 502)
    }
    return payload.entry
  }

  async function getGroupMembers(groupId) {
    if (!groupIdPattern.test(groupId || '')) throw failure('HIERARCHY_GROUP_MAPPING_INVALID', 503)
    const members = new Map()
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const query = new URLSearchParams({ where: "(memberType='PERSON')", maxItems: '100', skipCount: String(skipCount) })
      const payload = await getWithAuthorizationRetry(`${corePath}/groups/${encodeURIComponent(groupId)}/members?${query}`)
      const list = payload?.list
      if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') {
        throw failure('HIERARCHY_GROUP_RESPONSE_INVALID', 502)
      }
      const page = list.entries.map(({ entry }) => entry).filter((entry) => typeof entry?.id === 'string' && entry.id)
      for (const member of page) members.set(member.id, member)
      hasMoreItems = list.pagination.hasMoreItems
      if (hasMoreItems && page.length === 0) throw failure('HIERARCHY_GROUP_PAGINATION_INVALID', 502)
      skipCount += page.length
      if (skipCount > 10_000) throw failure('HIERARCHY_GROUP_MEMBER_LIMIT_EXCEEDED', 502)
    }
    return [...members.values()]
  }

  async function getInstitutionalGroupMembers(groupId) {
    const members = await readClassicInstitutionalGroup(groupId, path => getWithAuthorizationRetry(path))
    return [...members.values()]
  }

  async function getGroupDetails(groupId) {
    if (!groupIdPattern.test(groupId || '')) throw failure('HIERARCHY_GROUP_MAPPING_INVALID', 503)
    const payload = await getWithAuthorizationRetry(`${corePath}/groups/${encodeURIComponent(groupId)}`)
    if (payload?.entry?.id !== groupId) throw failure('HIERARCHY_GROUP_RESPONSE_INVALID', 502)
    return payload.entry
  }

  async function listGroupAuthorities(groupId) {
    if (!groupIdPattern.test(groupId || '')) throw failure('HIERARCHY_GROUP_MAPPING_INVALID', 503)
    const members = new Map()
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const query = new URLSearchParams({ maxItems: '100', skipCount: String(skipCount) })
      const payload = await getWithAuthorizationRetry(`${corePath}/groups/${encodeURIComponent(groupId)}/members?${query}`)
      const list = payload?.list
      if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') {
        throw failure('HIERARCHY_GROUP_RESPONSE_INVALID', 502)
      }
      const page = list.entries.map(({ entry }) => entry).filter((entry) => typeof entry?.id === 'string' && entry.id)
      for (const entry of page) {
        const memberType = entry.memberType || (/^GROUP_/.test(entry.id) ? 'GROUP' : 'PERSON')
        if (!['GROUP', 'PERSON'].includes(memberType)) throw failure('HIERARCHY_GROUP_MEMBER_TYPE_INVALID', 502)
        members.set(`${memberType}:${entry.id}`, { ...entry, memberType })
      }
      hasMoreItems = list.pagination.hasMoreItems
      if (hasMoreItems && page.length === 0) throw failure('HIERARCHY_GROUP_PAGINATION_INVALID', 502)
      skipCount += page.length
      if (skipCount > 10_000) throw failure('HIERARCHY_GROUP_MEMBER_LIMIT_EXCEEDED', 502)
    }
    return [...members.values()]
  }

  async function getPersonGroups(personId) {
    if (typeof personId !== 'string' || !personId.trim()) throw failure('HIERARCHY_PERSON_ID_REQUIRED', 400)
    const groups = new Map()
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const query = new URLSearchParams({ maxItems: '100', skipCount: String(skipCount) })
      const payload = await getWithAuthorizationRetry(`${corePath}/people/${encodeURIComponent(personId)}/groups?${query}`)
      const list = payload?.list
      if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') {
        throw failure('HIERARCHY_PERSON_GROUPS_INVALID', 502)
      }
      const page = list.entries.map(({ entry }) => entry).filter((entry) => typeof entry?.id === 'string' && entry.id)
      for (const group of page) groups.set(group.id, group)
      hasMoreItems = list.pagination.hasMoreItems
      if (hasMoreItems && page.length === 0) throw failure('HIERARCHY_GROUP_PAGINATION_INVALID', 502)
      skipCount += page.length
      if (skipCount > 10_000) throw failure('HIERARCHY_GROUP_MEMBER_LIMIT_EXCEEDED', 502)
    }
    return [...groups.values()]
  }

  async function inspectGroupHierarchy(rootGroupId, { maxGroups = 500 } = {}) {
    const root = await getGroupDetails(rootGroupId)
    const visited = new Set()
    const active = new Set()
    const people = new Map()
    const groups = []
    const cycles = []
    async function visit(groupId, depth, path) {
      if (active.has(groupId)) { cycles.push([...path, groupId]); return }
      if (visited.has(groupId)) return
      if (visited.size >= maxGroups) throw failure('HIERARCHY_GROUP_TREE_LIMIT_EXCEEDED', 502)
      visited.add(groupId)
      active.add(groupId)
      const authorities = await listGroupAuthorities(groupId)
      const directPeople = []
      const childGroups = []
      for (const authority of authorities) {
        if (authority.memberType === 'GROUP') childGroups.push(authority.id)
        else {
          directPeople.push(authority.id)
          const existing = people.get(authority.id) || { id: authority.id, directGroupIds: [], groupPaths: [] }
          if (!existing.directGroupIds.includes(groupId)) existing.directGroupIds.push(groupId)
          existing.groupPaths.push({ groupId, depth, path: [...path, groupId] })
          people.set(authority.id, existing)
        }
      }
      groups.push({ id: groupId, depth, directPersonCount: directPeople.length, childGroupIds: childGroups })
      for (const childGroupId of childGroups) await visit(childGroupId, depth + 1, [...path, groupId])
      active.delete(groupId)
    }
    await visit(rootGroupId, 0, [])
    return { root: { id: root.id, displayName: root.displayName || root.id }, groups, people: [...people.values()], cycles }
  }

  async function getNode(nodeId, { include = 'properties,permissions,allowableOperations,path' } = {}) {
    if (typeof nodeId !== 'string' || !nodeId.trim()) throw failure('HIERARCHY_NODE_ID_REQUIRED', 400)
    const payload = await getWithAuthorizationRetry(`${corePath}/nodes/${encodeURIComponent(nodeId)}?${new URLSearchParams({ include })}`)
    if (payload?.entry?.id !== nodeId) throw failure('HIERARCHY_NODE_RESPONSE_INVALID', 502)
    return payload.entry
  }

  async function listNodeChildren(parentId, { maxItems = 100, skipCount = 0, include = 'properties,permissions,allowableOperations,path' } = {}) {
    const query = new URLSearchParams({ include, maxItems: String(maxItems), skipCount: String(skipCount) })
    const payload = await getWithAuthorizationRetry(`${corePath}/nodes/${encodeURIComponent(parentId)}/children?${query}`)
    const list = payload?.list
    if (!Array.isArray(list?.entries) || list.entries.length > maxItems ||
        list.entries.some(item => typeof item?.entry?.id !== 'string' || !item.entry.id) ||
        typeof list.pagination?.hasMoreItems !== 'boolean' ||
        list.pagination.skipCount !== undefined && list.pagination.skipCount !== skipCount ||
        list.pagination.count !== undefined && list.pagination.count !== list.entries.length) {
      throw failure('HIERARCHY_CONTAINER_CHILDREN_INVALID', 502)
    }
    return {
      entries: list.entries.map(({ entry }) => entry).filter((entry) => entry?.id),
      hasMoreItems: list.pagination.hasMoreItems,
    }
  }

  async function createChild(parentId, body) {
    let payload
    try {
      payload = await request(`${corePath}/nodes/${encodeURIComponent(parentId)}/children?autoRename=false`, {
        method: 'POST', authorization: await getAuthorization(), body,
      })
    } catch (error) {
      if (error.code === 'HIERARCHY_ALFRESCO_NETWORK_ERROR' || error.status >= 500) {
        throw failure('HIERARCHY_WRITE_OUTCOME_UNKNOWN', error.status || 502)
      }
      throw error
    }
    if (!payload?.entry?.id) throw failure('HIERARCHY_WRITE_OUTCOME_UNKNOWN', 502)
    return payload.entry
  }

  async function updateNode(nodeId, properties) {
    try {
      const payload = await request(`${corePath}/nodes/${encodeURIComponent(nodeId)}`, {
        method: 'PUT', authorization: await getAuthorization(), body: { properties },
      })
      if (!payload?.entry?.id) throw failure('HIERARCHY_WRITE_OUTCOME_UNKNOWN', 502)
      return payload.entry
    } catch (error) {
      if (error.code === 'HIERARCHY_ALFRESCO_NETWORK_ERROR' || error.status >= 500) {
        throw failure('HIERARCHY_WRITE_OUTCOME_UNKNOWN', error.status || 502)
      }
      throw error
    }
  }

  async function inspectType(type) {
    const expected = expectedTypes[type]
    const payload = await getWithAuthorizationRetry(`/alfresco/service/api/classes/${expected.endpointName}`)
    const propertiesValue = payload?.properties
    const propertyEntries = Array.isArray(propertiesValue)
      ? propertiesValue
      : propertiesValue && typeof propertiesValue === 'object'
        ? Object.entries(propertiesValue).map(([name, value]) => ({ name, ...(value || {}) }))
        : null
    if (!propertyEntries) throw failure(`HIERARCHY_TYPE_DEFINITION_INVALID:${type}`, 502)
    const found = new Set(propertyEntries.map(safePropertyName).filter(Boolean))
    const missingProperties = expected.properties.filter((name) => !found.has(name))
    return { available: true, missingProperties }
  }

  async function runReadOnlyDiagnostics(groupMappings) {
    assertConfigured()
    const hierarchyService = settings.hierarchyService
    const auditContainerId = hierarchyService.auditContainerNodeId
    if (!uuidPattern.test(auditContainerId || '')) {
      throw failure('HIERARCHY_AUDIT_CONTAINER_NODE_ID_INVALID', 503)
    }
    if (hierarchyService.containerNodeId.toLowerCase() === auditContainerId.toLowerCase()) {
      throw failure('HIERARCHY_CONTAINERS_MUST_BE_DISTINCT', 409)
    }
    const authorization = await getAuthorization()
    const identity = (await request(`${corePath}/people/-me-`, { authorization }))?.entry
    const containerId = settings.hierarchyService.containerNodeId
    const containerPayload = await getWithAuthorizationRetry(`${corePath}/nodes/${encodeURIComponent(containerId)}?include=properties,permissions,path,allowableOperations`)
    const container = containerPayload?.entry
    if (container?.id !== containerId) throw failure('HIERARCHY_CONTAINER_ID_MISMATCH', 502)
    const name = container.name || container.properties?.['cm:name'] || null
    if (name !== 'GD_JERARQUIAS') throw failure('HIERARCHY_CONTAINER_NAME_MISMATCH', 409)
    if (container.nodeType !== 'cm:folder' || container.isFolder !== true) throw failure('HIERARCHY_CONTAINER_INVALID', 409)

    const auditContainer = await getNode(auditContainerId)
    const auditName = auditContainer.name || auditContainer.properties?.['cm:name'] || null
    if (auditContainer.id !== auditContainerId || auditName !== 'GD_JERARQUIAS_AUDITORIA' || auditContainer.isFolder !== true) {
      throw failure('HIERARCHY_AUDIT_CONTAINER_INVALID', 409)
    }

    const children = []
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const query = new URLSearchParams({ include: 'properties', maxItems: '100', skipCount: String(skipCount) })
      const payload = await getWithAuthorizationRetry(`${corePath}/nodes/${encodeURIComponent(containerId)}/children?${query}`)
      const list = payload?.list
      if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') {
        throw failure('HIERARCHY_CONTAINER_CHILDREN_INVALID', 502)
      }
      const page = list.entries.map(({ entry }) => entry).filter((entry) => entry?.id)
      children.push(...page.map((entry) => ({ id: entry.id, nodeType: entry.nodeType || null })))
      hasMoreItems = list.pagination.hasMoreItems
      if (hasMoreItems && page.length === 0) throw failure('HIERARCHY_CHILD_PAGINATION_INVALID', 502)
      skipCount += page.length
      if (skipCount > 10_000) throw failure('HIERARCHY_CHILD_LIMIT_EXCEEDED', 502)
    }

    const dependencyGroups = normalizeGroups(groupMappings?.dependencies || {})
    const functionGroups = normalizeGroups(groupMappings?.functions || {})
    const groupIds = [...new Set([...dependencyGroups, ...functionGroups])]
    if (!groupIds.length) throw failure('HIERARCHY_GROUP_MAPPINGS_REQUIRED', 503)
    const groups = []
    const people = new Map()
    for (const groupId of groupIds) {
      const members = await getInstitutionalGroupMembers(groupId)
      groups.push({ id: groupId, memberCount: members.length, source: 'classic' })
      for (const member of members) people.set(member.id, member)
    }
    let enabledPeople = 0
    let disabledPeople = 0
    const uniquePeople = [...people.keys()]
    for (let offset = 0; offset < uniquePeople.length; offset += 10) {
      const batch = uniquePeople.slice(offset, offset + 10)
      const results = await Promise.all(batch.map(async (personId) => {
      const person = await getPerson(personId)
      return person.enabled
      }))
      for (const enabled of results) enabled ? enabledPeople++ : disabledPeople++
    }

    const modelTypes = {}
    for (const type of Object.keys(expectedTypes)) {
      try {
        modelTypes[type] = await inspectType(type)
      } catch (error) {
        modelTypes[type] = { available: false, error: error.code || 'HIERARCHY_TYPE_CHECK_FAILED' }
      }
    }

    return {
      authentication: {
        id: identity.id,
        enabled: identity.enabled,
        isAdmin: identity.capabilities?.isAdmin,
      },
      container: {
        id: container.id,
        name,
        nodeType: container.nodeType || null,
        inheritanceEnabled: container.permissions?.isInheritanceEnabled ?? null,
        allowableOperations: Array.isArray(container.allowableOperations) ? container.allowableOperations : [],
      },
      auditContainer: {
        id: auditContainer.id,
        name: auditName,
        nodeType: auditContainer.nodeType || null,
        readable: true,
        allowableOperations: Array.isArray(auditContainer.allowableOperations) ? auditContainer.allowableOperations : [],
      },
      children: {
        count: children.length,
        nodeTypes: [...new Set(children.map((child) => child.nodeType).filter(Boolean))].sort(),
      },
      groups,
      people: { uniqueCount: uniquePeople.length, enabledCount: enabledPeople, disabledCount: disabledPeople },
      model: { name: 'gd_organizacion', prefix: 'gdo', types: modelTypes },
    }
  }

  return {
    getAuthorization, getPerson, getPersonGroups, getGroupDetails, getGroupMembers, getInstitutionalGroupMembers,
    listGroupAuthorities, inspectType,
    inspectGroupHierarchy, getNode, listNodeChildren, createChild, updateNode, runReadOnlyDiagnostics,
  }
}
