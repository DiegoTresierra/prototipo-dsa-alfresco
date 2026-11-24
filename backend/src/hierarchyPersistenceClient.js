import { createHierarchyServiceClient } from './hierarchyServiceClient.js'

const corePath = '/alfresco/api/-default-/public/alfresco/versions/1'
const definitiveContainerId = 'd0c78bf2-35f2-4f7c-878b-f235f21f7c93'
const expectedLabContainerName = 'GD_JERARQUIAS_LAB'
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,47}$/
const unitType = 'gdo:unidad'
const assignmentType = 'gdo:asignacion'

function failure(code, status = 502) {
  return Object.assign(new Error(code), { code, status })
}

function unitName(runId) {
  return `ZZ_LAB_UNIDAD_${runId}`
}

function assignmentName(runId) {
  return `ZZ_LAB_ASIGNACION_${runId}`
}

function sameProperties(actual = {}, expected = {}) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value)
}

export function createHierarchyPersistenceClient(settings, {
  labContainerNodeId,
  runId,
  confirmLabWrites = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const authClient = createHierarchyServiceClient(settings, fetchImpl)
  const knownLabNodeIds = new Set()
  let labContainerPromise

  function assertLabSetup() {
    if (confirmLabWrites !== true) throw failure('HIERARCHY_LAB_CONFIRMATION_REQUIRED', 400)
    if (!runIdPattern.test(runId || '')) throw failure('HIERARCHY_LAB_RUN_ID_INVALID', 400)
    if (!uuidPattern.test(labContainerNodeId || '')) throw failure('HIERARCHY_LAB_CONTAINER_REQUIRED', 503)
    if (labContainerNodeId.toLowerCase() === definitiveContainerId.toLowerCase() ||
        labContainerNodeId.toLowerCase() === String(settings?.hierarchyService?.containerNodeId || '').toLowerCase()) {
      throw failure('HIERARCHY_LAB_CONTAINER_MUST_BE_SEPARATE', 400)
    }
    if (settings?.hierarchyService?.storage !== 'alfresco') throw failure('HIERARCHY_STORAGE_MUST_BE_ALFRESCO', 503)
  }

  async function request(path, { method = 'GET', body, query = '' } = {}) {
    const authorization = await authClient.getAuthorization()
    let response
    try {
      response = await fetchImpl(`${settings.alfrescoTarget}${path}${query}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw failure(method === 'POST' ? 'HIERARCHY_WRITE_OUTCOME_UNKNOWN' : 'HIERARCHY_ALFRESCO_NETWORK_ERROR', 502)
    }
    if (!response.ok) {
      if (method === 'POST' && response.status >= 500) throw failure('HIERARCHY_WRITE_OUTCOME_UNKNOWN', response.status)
      throw failure(`HIERARCHY_ALFRESCO_HTTP_${response.status}`, response.status)
    }
    try {
      return await response.json()
    } catch {
      if (method === 'POST') throw failure('HIERARCHY_WRITE_OUTCOME_UNKNOWN', 502)
      throw failure('HIERARCHY_ALFRESCO_INVALID_RESPONSE', 502)
    }
  }

  async function getNodeRaw(nodeId) {
    const payload = await request(`${corePath}/nodes/${encodeURIComponent(nodeId)}`, {
      query: '?include=properties,permissions,allowableOperations,path',
    })
    if (payload?.entry?.id !== nodeId) throw failure('HIERARCHY_NODE_RESPONSE_INVALID', 502)
    return payload.entry
  }

  async function getLabContainer() {
    assertLabSetup()
    if (!labContainerPromise) {
      labContainerPromise = (async () => {
        const container = await getNodeRaw(labContainerNodeId)
        const name = container.name || container.properties?.['cm:name']
        if (name !== expectedLabContainerName || container.isFolder !== true) {
          throw failure('HIERARCHY_LAB_CONTAINER_INVALID', 409)
        }
        knownLabNodeIds.add(container.id)
        if (!container.allowableOperations?.includes('create')) throw failure('HIERARCHY_LAB_CONTAINER_CREATE_FORBIDDEN', 403)
        return container
      })().catch((error) => {
        labContainerPromise = undefined
        throw error
      })
    }
    return labContainerPromise
  }

  async function listChildren(parentId) {
    assertLabSetup()
    const root = await getLabContainer()
    if (parentId !== root.id && !knownLabNodeIds.has(parentId)) throw failure('HIERARCHY_LAB_PARENT_OUT_OF_SCOPE', 403)
    const entries = []
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const query = `?${new URLSearchParams({ include: 'properties,permissions,allowableOperations', maxItems: '100', skipCount: String(skipCount) })}`
      const payload = await request(`${corePath}/nodes/${encodeURIComponent(parentId)}/children`, { query })
      const list = payload?.list
      if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') {
        throw failure('HIERARCHY_CHILDREN_RESPONSE_INVALID', 502)
      }
      const page = list.entries.map(({ entry }) => entry).filter((entry) => entry?.id)
      for (const entry of page) {
        knownLabNodeIds.add(entry.id)
        entries.push(entry)
      }
      hasMoreItems = list.pagination.hasMoreItems
      if (hasMoreItems && !page.length) throw failure('HIERARCHY_CHILDREN_PAGINATION_INVALID', 502)
      skipCount += page.length
      if (skipCount > 1000) throw failure('HIERARCHY_LAB_CHILD_LIMIT_EXCEEDED', 502)
    }
    return entries
  }

  async function getNode(nodeId) {
    assertLabSetup()
    await getLabContainer()
    if (!knownLabNodeIds.has(nodeId)) throw failure('HIERARCHY_LAB_NODE_OUT_OF_SCOPE', 403)
    return getNodeRaw(nodeId)
  }

  async function findExisting(parentId, name, nodeType, expectedProperties) {
    const children = await listChildren(parentId)
    const existing = children.find((child) => child.name === name)
    if (!existing) return null
    if (existing.nodeType !== nodeType || !sameProperties(existing.properties, expectedProperties)) {
      throw failure('HIERARCHY_LAB_DUPLICATE_CONFLICT', 409)
    }
    const verified = await getNode(existing.id)
    if (verified.nodeType !== nodeType || !sameProperties(verified.properties, expectedProperties)) {
      throw failure('HIERARCHY_LAB_DUPLICATE_CONFLICT', 409)
    }
    return { ...verified, reused: true }
  }

  async function createChild(parent, name, nodeType, properties) {
    const existing = await findExisting(parent.id, name, nodeType, properties)
    if (existing) return existing
    if (!parent.allowableOperations?.includes('create')) throw failure('HIERARCHY_LAB_CHILD_CREATE_FORBIDDEN', 403)
    const body = { name, nodeType, properties }
    let payload
    try {
      payload = await request(`${corePath}/nodes/${encodeURIComponent(parent.id)}/children`, {
        method: 'POST',
        body,
        query: '?autoRename=false',
      })
    } catch (error) {
      if (error.status !== 409) throw error
      const raced = await findExisting(parent.id, name, nodeType, properties)
      if (raced) return raced
      throw failure('HIERARCHY_LAB_DUPLICATE_CONFLICT', 409)
    }
    const created = payload?.entry
    if (!created?.id) throw failure('HIERARCHY_WRITE_OUTCOME_UNKNOWN', 502)
    knownLabNodeIds.add(created.id)
    const verified = await getNodeRaw(created.id)
    if (verified.parentId !== parent.id || verified.name !== name || verified.nodeType !== nodeType ||
        !sameProperties(verified.properties, properties)) {
      throw failure('HIERARCHY_WRITE_VERIFICATION_FAILED', 409)
    }
    return { ...verified, reused: false }
  }

  async function createUnit() {
    assertLabSetup()
    const container = await getLabContainer()
    const name = unitName(runId)
    const properties = {
      'gdo:codigoDependencia': 'LABORATORIO',
      'gdo:codigoUnidad': `LAB-${runId}`,
      'gdo:descripcionUnidad': `PRUEBA DE PERSISTENCIA UAC; RUN_ID=${runId}; NO USAR EN PRODUCCION`,
      'gdo:estadoUnidad': 'ACTIVA',
      'gdo:nombreUnidad': name,
    }
    return createChild(container, name, unitType, properties)
  }

  async function createAssignment(unitId) {
    assertLabSetup()
    await getLabContainer()
    if (!knownLabNodeIds.has(unitId)) throw failure('HIERARCHY_LAB_UNIT_OUT_OF_SCOPE', 403)
    const unit = await getNodeRaw(unitId)
    if (unit.nodeType !== unitType || unit.parentId !== labContainerNodeId ||
        unit.properties?.['gdo:codigoDependencia'] !== 'LABORATORIO' || unit.name !== unitName(runId)) {
      throw failure('HIERARCHY_LAB_UNIT_INVALID', 403)
    }
    const name = assignmentName(runId)
    const properties = {
      'gdo:idUsuario': `LAB_NO_REAL_${runId}`,
      'gdo:idUnidad': unit.id,
      'gdo:dependenciaAsignacion': 'LABORATORIO',
      'gdo:rolAsignacion': 'especialista',
      'gdo:estadoAsignacion': 'ACTIVA',
      'gdo:asignadoPor': `LAB_OPERATOR_${runId}`,
    }
    const existing = (await listChildren(unit.id)).find((child) => child.name === name)
    if (existing) {
      const inactiveExpected = { ...properties, 'gdo:estadoAsignacion': 'INACTIVA' }
      const isKnownState = existing.nodeType === assignmentType &&
        (sameProperties(existing.properties, properties) || sameProperties(existing.properties, inactiveExpected))
      if (!isKnownState) throw failure('HIERARCHY_LAB_DUPLICATE_CONFLICT', 409)
      const verified = await getNode(existing.id)
      if (verified.nodeType !== assignmentType ||
          !(sameProperties(verified.properties, properties) || sameProperties(verified.properties, inactiveExpected))) {
        throw failure('HIERARCHY_LAB_DUPLICATE_CONFLICT', 409)
      }
      return { ...verified, reused: true }
    }
    if (!unit.allowableOperations?.includes('create')) throw failure('HIERARCHY_LAB_CHILD_CREATE_FORBIDDEN', 403)
    return createChild(unit, name, assignmentType, properties)
  }

  async function updateAssignmentStatus(assignmentId, unitId, status) {
    assertLabSetup()
    if (!['ACTIVA', 'INACTIVA'].includes(status)) throw failure('HIERARCHY_ASSIGNMENT_STATUS_INVALID', 400)
    if (!knownLabNodeIds.has(assignmentId) || !knownLabNodeIds.has(unitId)) throw failure('HIERARCHY_LAB_NODE_OUT_OF_SCOPE', 403)
    const assignment = await getNodeRaw(assignmentId)
    if (assignment.nodeType !== assignmentType || assignment.parentId !== unitId ||
        assignment.properties?.['gdo:idUnidad'] !== unitId || assignment.name !== assignmentName(runId)) {
      throw failure('HIERARCHY_LAB_ASSIGNMENT_INVALID', 403)
    }
    if (assignment.properties?.['gdo:estadoAsignacion'] === status) return { ...assignment, reused: true }
    if (!assignment.allowableOperations?.includes('update')) throw failure('HIERARCHY_LAB_UPDATE_FORBIDDEN', 403)
    await request(`${corePath}/nodes/${encodeURIComponent(assignmentId)}`, {
      method: 'PUT',
      body: { properties: { 'gdo:estadoAsignacion': status } },
    })
    const verified = await getNodeRaw(assignmentId)
    if (verified.properties?.['gdo:estadoAsignacion'] !== status) throw failure('HIERARCHY_UPDATE_VERIFICATION_FAILED', 409)
    return { ...verified, reused: false }
  }

  return { getLabContainer, listChildren, getNode, createUnit, createAssignment, updateAssignmentStatus }
}

