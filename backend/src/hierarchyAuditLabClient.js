import { createHierarchyServiceClient } from './hierarchyServiceClient.js'

const expectedLabContainerName = 'GD_JERARQUIAS_LAB'
const eventType = 'gdo:eventoJerarquia'
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,47}$/
const eventPropertyNames = [
  'claveEvento', 'idOperacionEvento', 'faseEvento', 'accionEvento', 'dependenciaEvento',
  'idUnidadEvento', 'idAsignacionEvento', 'idUsuarioEvento', 'actorEvento', 'fechaEvento',
  'datosAntesEvento', 'datosDespuesEvento', 'revisionAntesEvento', 'revisionDespuesEvento', 'codigoErrorEvento',
]

function failure(code, status = 502) {
  return Object.assign(new Error(code), { code, status })
}

function eventName(runId) {
  return `ZZ_LAB_EVENTO_${runId}`
}

function expectedProperties(runId) {
  return {
    'gdo:claveEvento': `LAB_EVENT_${runId}`,
    'gdo:idOperacionEvento': `LAB_AUDIT_OP_${runId}`,
    'gdo:faseEvento': 'COMPLETADA',
    'gdo:accionEvento': 'ESPECIALISTA_ASIGNADO',
    'gdo:dependenciaEvento': 'LABORATORIO',
    'gdo:idUnidadEvento': `LAB_UNIDAD_${runId}`,
    'gdo:idAsignacionEvento': `LAB_ASIGNACION_${runId}`,
    'gdo:idUsuarioEvento': `LAB_USUARIO_${runId}`,
    'gdo:actorEvento': `LAB_OPERADOR_${runId}`,
    'gdo:fechaEvento': new Date().toISOString(),
    'gdo:datosAntesEvento': JSON.stringify({ estado: 'SIN_ASIGNAR', etiqueta: `LAB_${runId}` }),
    'gdo:datosDespuesEvento': JSON.stringify({ estado: 'ACTIVA', rol: 'especialista', etiqueta: `LAB_${runId}` }),
    'gdo:revisionAntesEvento': `LAB_REVISION_ANTES_${runId}`,
    'gdo:revisionDespuesEvento': `LAB_REVISION_DESPUES_${runId}`,
    'gdo:codigoErrorEvento': 'NINGUNO',
  }
}

function matchesExpected(actual = {}, expected = {}) {
  return Object.entries(expected).every(([key, value]) => key === 'gdo:fechaEvento'
    ? typeof actual[key] === 'string' && !Number.isNaN(Date.parse(actual[key]))
    : actual[key] === value)
}

function mapEvent(entry) {
  const properties = entry?.properties || {}
  if (!entry?.id || entry.nodeType !== eventType || eventPropertyNames.some((name) => typeof properties[`gdo:${name}`] !== 'string' || !properties[`gdo:${name}`])) {
    throw failure('HIERARCHY_AUDIT_LAB_EVENT_PROPERTIES_INVALID', 409)
  }
  if (Number.isNaN(Date.parse(properties['gdo:fechaEvento']))) throw failure('HIERARCHY_AUDIT_LAB_TIMESTAMP_INVALID', 409)
  return entry
}

export function createHierarchyAuditLabClient(settings, {
  labContainerNodeId,
  runId,
  confirmLabWrites = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const service = createHierarchyServiceClient(settings, fetchImpl)
  let labContainerPromise

  function assertLabSetup() {
    if (confirmLabWrites !== true) throw failure('HIERARCHY_AUDIT_LAB_CONFIRMATION_REQUIRED', 400)
    if (!runIdPattern.test(runId || '')) throw failure('HIERARCHY_AUDIT_LAB_RUN_ID_INVALID', 400)
    if (!uuidPattern.test(labContainerNodeId || '') || labContainerNodeId.toLowerCase() !== String(settings?.hierarchyService?.labContainerNodeId || '').toLowerCase()) {
      throw failure('HIERARCHY_AUDIT_LAB_CONTAINER_ID_INVALID', 400)
    }
    const hierarchy = settings?.hierarchyService || {}
    if (!uuidPattern.test(hierarchy.containerNodeId || '') || !uuidPattern.test(hierarchy.auditContainerNodeId || '') ||
        !uuidPattern.test(hierarchy.labContainerNodeId || '')) {
      throw failure('HIERARCHY_AUDIT_LAB_CONTAINER_CONFIGURATION_INVALID', 503)
    }
    const protectedIds = [hierarchy.containerNodeId, hierarchy.auditContainerNodeId]
      .map((id) => id.toLowerCase())
    if (protectedIds.includes(labContainerNodeId.toLowerCase()) ||
        hierarchy.labContainerNodeId.toLowerCase() !== labContainerNodeId.toLowerCase()) {
      throw failure('HIERARCHY_AUDIT_LAB_CONTAINER_MUST_BE_ISOLATED', 400)
    }
    if (hierarchy.storage !== 'alfresco') throw failure('HIERARCHY_STORAGE_MUST_BE_ALFRESCO', 503)
  }

  async function getLabContainer() {
    assertLabSetup()
    if (!labContainerPromise) {
      labContainerPromise = service.getNode(labContainerNodeId).then((entry) => {
        const name = entry.name || entry.properties?.['cm:name']
        if (entry.id !== labContainerNodeId || name !== expectedLabContainerName || entry.isFolder !== true) {
          throw failure('HIERARCHY_AUDIT_LAB_CONTAINER_INVALID', 409)
        }
        return entry
      }).catch((error) => {
        labContainerPromise = undefined
        throw error
      })
    }
    return labContainerPromise
  }

  async function listChildren() {
    const container = await getLabContainer()
    const entries = []
    let skipCount = 0
    let hasMoreItems = true
    while (hasMoreItems) {
      const page = await service.listNodeChildren(container.id, { maxItems: 100, skipCount })
      entries.push(...page.entries)
      hasMoreItems = page.hasMoreItems
      if (hasMoreItems && page.entries.length === 0) throw failure('HIERARCHY_AUDIT_LAB_PAGINATION_INVALID', 502)
      skipCount += page.entries.length
      if (skipCount > 1000) throw failure('HIERARCHY_AUDIT_LAB_CHILD_LIMIT_EXCEEDED', 502)
    }
    return entries
  }

  async function verifyListedEvent(entry, expected, name) {
    if (entry.name !== name || entry.nodeType !== eventType || entry.parentId !== labContainerNodeId ||
        !matchesExpected(entry.properties, expected)) {
      throw failure('HIERARCHY_AUDIT_LAB_DUPLICATE_CONFLICT', 409)
    }
    const readBack = mapEvent(await service.getNode(entry.id))
    if (readBack.parentId !== labContainerNodeId || readBack.name !== name || readBack.nodeType !== eventType ||
        !matchesExpected(readBack.properties, expected)) {
      throw failure('HIERARCHY_AUDIT_LAB_READBACK_MISMATCH', 409)
    }
    return { ...readBack, reused: true }
  }

  async function getEvent(eventNodeId) {
    assertLabSetup()
    if (!uuidPattern.test(eventNodeId || '')) throw failure('HIERARCHY_AUDIT_LAB_EVENT_ID_INVALID', 400)
    const listed = (await listChildren()).filter((entry) => entry.id === eventNodeId)
    if (listed.length !== 1 || listed[0].nodeType !== eventType || listed[0].parentId !== labContainerNodeId) {
      throw failure('HIERARCHY_AUDIT_LAB_EVENT_NOT_FOUND', 404)
    }
    const entry = mapEvent(await service.getNode(eventNodeId))
    if (entry.parentId !== labContainerNodeId || entry.nodeType !== eventType) {
      throw failure('HIERARCHY_AUDIT_LAB_EVENT_OUT_OF_SCOPE', 403)
    }
    return entry
  }

  async function findExisting(expected, name) {
    const matches = (await listChildren()).filter((entry) =>
      entry.name === name || entry.properties?.['gdo:claveEvento'] === expected['gdo:claveEvento'])
    if (!matches.length) return null
    if (matches.length !== 1) throw failure('HIERARCHY_AUDIT_LAB_DUPLICATE_CONFLICT', 409)
    return verifyListedEvent(matches[0], expected, name)
  }

  async function createEvent() {
    assertLabSetup()
    const container = await getLabContainer()
    const name = eventName(runId)
    const properties = expectedProperties(runId)
    const existing = await findExisting(properties, name)
    if (existing) return existing
    if (!container.allowableOperations?.includes('create')) throw failure('HIERARCHY_AUDIT_LAB_CREATE_FORBIDDEN', 403)

    let created
    try {
      created = await service.createChild(container.id, { name, nodeType: eventType, properties })
    } catch (error) {
      if (error.status === 409 || error.code === 'HIERARCHY_WRITE_OUTCOME_UNKNOWN') {
        try {
          const recovered = await findExisting(properties, name)
          if (recovered) return { ...recovered, outcomeRecovered: true }
        } catch {
          // Preserve the original error; a later run with this RUN_ID can reconcile by reading first.
        }
      }
      if (error.code === 'HIERARCHY_WRITE_OUTCOME_UNKNOWN') throw error
      if (error.status === 401 || error.status === 403 || error.status === 409) throw error
      throw failure(error.code || 'HIERARCHY_AUDIT_LAB_CREATE_FAILED', error.status || 502)
    }

    let readBack
    try {
      readBack = mapEvent(await service.getNode(created.id))
    } catch (error) {
      throw failure(error.code || 'HIERARCHY_AUDIT_LAB_READBACK_FAILED', error.status || 502)
    }
    if (readBack.parentId !== container.id || readBack.name !== name || readBack.nodeType !== eventType ||
        !matchesExpected(readBack.properties, properties)) {
      throw failure('HIERARCHY_AUDIT_LAB_READBACK_MISMATCH', 409)
    }
    const listed = (await listChildren()).filter((entry) => entry.id === created.id)
    if (listed.length !== 1 || listed[0].parentId !== container.id || listed[0].name !== name ||
        listed[0].nodeType !== eventType || !matchesExpected(listed[0].properties, properties)) {
      throw failure('HIERARCHY_AUDIT_LAB_CHILD_LIST_VERIFICATION_FAILED', 409)
    }
    return { ...readBack, reused: false }
  }

  return { getLabContainer, listChildren, getEvent, createEvent }
}

export { eventType as HIERARCHY_AUDIT_EVENT_TYPE }
