export const RESPONSE_TIME_PRIORITIES = Object.freeze(['NORMAL', 'ALTA', 'URGENTE'])
export const RESPONSE_TIME_UNITS = Object.freeze(['DIAS', 'HORAS'])
export const RESPONSE_TIME_LIMITS = Object.freeze({ DIAS: 365, HORAS: 8760 })

const DEFAULT_VALUES = Object.freeze([
  Object.freeze({ priority: 'NORMAL', value: 5, unit: 'DIAS' }),
  Object.freeze({ priority: 'ALTA', value: 3, unit: 'DIAS' }),
  Object.freeze({ priority: 'URGENTE', value: 1, unit: 'DIAS' }),
])
const allowedRootKeys = new Set(['operationId', 'expectedRevision', 'values'])

function canonicalValues(values = []) {
  return [...values].sort((a, b) => RESPONSE_TIME_PRIORITIES.indexOf(a.priority) - RESPONSE_TIME_PRIORITIES.indexOf(b.priority))
}

function sameValues(left, right) {
  if (left == null || right == null) return (left ?? null) === (right ?? null)
  return JSON.stringify(canonicalValues(left)) === JSON.stringify(canonicalValues(right))
}

function failure(code, status = 409, extra = {}) {
  return Object.assign(new Error(code), { status, code, ...extra })
}

export function responseTimesReadAllowed(session) {
  return session?.authorizationStatus === 'active' && session.capabilities?.includes('documents:read') === true
}

export function responseTimesWriteAllowed(session) {
  return session?.authorizationStatus === 'active' && session.functionalRole === 'direccion' &&
    session.capabilities?.includes('documents:write') === true
}

export function responseTimesDependency(session, dependencyMappings = {}) {
  const dependency = String(session?.dependency || '').toLowerCase()
  const key = Object.keys(dependencyMappings).find((candidate) => candidate.toLowerCase() === dependency)
  return key ? key.toLowerCase() : ''
}

export function responseTimesDefaults(dependency) {
  return {
    dependency, source: 'DEFAULT', isDefault: true, revision: null,
    values: DEFAULT_VALUES.map((entry) => ({ ...entry })),
    capabilities: { edit: false }, limits: { ...RESPONSE_TIME_LIMITS },
  }
}

export function validateResponseTimesInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowedRootKeys.has(key))) {
    throw failure('RESPONSE_TIMES_INVALID_INPUT', 400)
  }
  if (typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationId) ||
      (input.expectedRevision !== undefined && (typeof input.expectedRevision !== 'string' || input.expectedRevision.length > 200)) ||
      !Array.isArray(input.values) || input.values.length !== RESPONSE_TIME_PRIORITIES.length) {
    throw failure('RESPONSE_TIMES_INVALID_INPUT', 400)
  }
  const seen = new Set()
  const values = input.values.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).some((key) => !['priority', 'value', 'unit'].includes(key)) || Object.keys(entry).length !== 3 ||
        !RESPONSE_TIME_PRIORITIES.includes(entry.priority) || !RESPONSE_TIME_UNITS.includes(entry.unit) ||
        !Number.isSafeInteger(entry.value) || entry.value <= 0 || entry.value > RESPONSE_TIME_LIMITS[entry.unit] || seen.has(entry.priority)) {
      throw failure('RESPONSE_TIMES_INVALID_INPUT', 400)
    }
    seen.add(entry.priority)
    return { priority: entry.priority, value: entry.value, unit: entry.unit }
  }).sort((a, b) => RESPONSE_TIME_PRIORITIES.indexOf(a.priority) - RESPONSE_TIME_PRIORITIES.indexOf(b.priority))
  if (seen.size !== RESPONSE_TIME_PRIORITIES.length) throw failure('RESPONSE_TIMES_INVALID_INPUT', 400)
  return { operationId: input.operationId, expectedRevision: input.expectedRevision, values }
}

export function createResponseTimesService({ writesEnabled = false, repository, persistenceConfigurationInvalid = false, pilotDependency = 'dsa', onPendingOperation = () => {} } = {}) {
  const dependencyQueues = new Map()
  const pendingOperations = new Map()
  async function serializeDependency(dependency, task) {
    const previous = dependencyQueues.get(dependency) || Promise.resolve()
    let release
    const current = new Promise((resolve) => { release = resolve })
    dependencyQueues.set(dependency, current)
    await previous
    try { return await task() } finally {
      release()
      if (dependencyQueues.get(dependency) === current) dependencyQueues.delete(dependency)
    }
  }

  return {
    async read(dependency) {
      if (!dependency) throw failure('RESPONSE_TIMES_DEPENDENCY_REQUIRED', 403)
      if (persistenceConfigurationInvalid) throw failure('RESPONSE_TIMES_ALFRESCO_CONFIGURATION_INVALID', 503)
      if (!repository) return responseTimesDefaults(dependency)
      const stored = await repository.getByDependency(dependency)
      let canEdit = false
      if (writesEnabled && typeof repository.canWrite === 'function' && typeof repository.save === 'function') {
        try { canEdit = dependency.toLowerCase() === pilotDependency.toLowerCase() && await repository.canWrite(stored, dependency) } catch { canEdit = false }
      }
      if (!stored) return { ...responseTimesDefaults(dependency), capabilities: { edit: canEdit } }
      return {
        dependency, source: 'ALFRESCO', isDefault: false, revision: stored.revision,
        values: stored.values.map((entry) => ({ ...entry })), capabilities: { edit: canEdit },
        limits: { ...RESPONSE_TIME_LIMITS }, modifiedAt: stored.modifiedAt, modifiedBy: stored.actorId,
      }
    },

    async update(dependency, actorId, input) {
      if (!repository || typeof repository.getByDependency !== 'function' || typeof repository.save !== 'function') {
        if (!writesEnabled) throw failure('RESPONSE_TIMES_WRITES_DISABLED')
        throw failure('RESPONSE_TIMES_PERSISTENCE_UNAVAILABLE', 503)
      }
      if (!dependency || !actorId) throw failure('RESPONSE_TIMES_ACTOR_REQUIRED', 403)
      const { operationId, expectedRevision, values } = validateResponseTimesInput(input)
      return serializeDependency(dependency, async () => {
        const pending = pendingOperations.get(dependency)
        if (pending && (pending.operationId !== operationId || pending.actorId !== actorId || !sameValues(pending.values, values))) {
          throw failure('RESPONSE_TIMES_OPERATION_PENDING', 409, { operationId: pending.operationId, operationStatus: 'PARCIAL' })
        }
        const current = await repository.getByDependency(dependency)

        // The config node carries the last operation and actor for retries.
        if (current?.operationId === operationId) {
          if (current.actorId !== actorId || !sameValues(current.values, values)) throw failure('RESPONSE_TIMES_OPERATION_ID_CONFLICT')
          if (pending) {
            try { onPendingOperation(null); pendingOperations.delete(dependency) } catch {
              throw failure('RESPONSE_TIMES_OPERATION_UNCERTAIN', 503, { operationId, operationStatus: 'PARCIAL' })
            }
          }
          return { status: 'COMPLETED', operationId, revision: current.revision, settings: { ...current, dependency, source: 'ALFRESCO', isDefault: false }, reused: true }
        }
        if ((current?.revision || null) !== (expectedRevision || null)) {
          throw failure('RESPONSE_TIMES_REVISION_CONFLICT', 409, { currentRevision: current?.revision || null })
        }
        const before = current?.values || responseTimesDefaults(dependency).values
        if (sameValues(before, values)) return { status: 'UNCHANGED', operationId, settings: current || responseTimesDefaults(dependency) }
        if (!writesEnabled) throw failure('RESPONSE_TIMES_WRITES_DISABLED')
        if (dependency.toLowerCase() !== pilotDependency.toLowerCase()) throw failure('RESPONSE_TIMES_PILOT_DSA_ONLY', 403)
        if (typeof repository.canWrite === 'function' && !await repository.canWrite(current, dependency)) {
          throw failure('RESPONSE_TIMES_WRITE_PERMISSION_UNAVAILABLE', 403)
        }

        try { onPendingOperation({ dependency, operationId }) } catch {
          throw failure('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE', 503, { operationId })
        }
        pendingOperations.set(dependency, { operationId, actorId, values })
        let saved
        try {
          saved = await repository.save({ dependency, values, expectedRevision, operationId, actorId })
        } catch (error) {
          if (error.status === 403 || error.status === 409) {
            try { onPendingOperation(null); pendingOperations.delete(dependency) } catch {
              throw failure('RESPONSE_TIMES_OPERATION_UNCERTAIN', 503, { operationId, operationStatus: 'PARCIAL' })
            }
            throw error
          }
          throw failure(error.code || 'RESPONSE_TIMES_OPERATION_UNCERTAIN', 503, { operationId, operationStatus: 'PARCIAL' })
        }
        let verified
        try { verified = await repository.getByDependency(dependency) } catch {
          throw failure('RESPONSE_TIMES_OPERATION_UNCERTAIN', 503, { operationId, operationStatus: 'PARCIAL' })
        }
        if (!verified || verified.operationId !== operationId || verified.actorId !== actorId ||
            !sameValues(verified.values, values) || !verified.revision || (current && verified.id !== current.id)) {
          throw failure('RESPONSE_TIMES_VERIFICATION_FAILED', 503, { operationId, operationStatus: 'PARCIAL' })
        }
        try { onPendingOperation(null); pendingOperations.delete(dependency) } catch {
          throw failure('RESPONSE_TIMES_OPERATION_UNCERTAIN', 503, { operationId, operationStatus: 'PARCIAL' })
        }
        return {
          status: 'COMPLETED', operationId, revision: verified.revision,
          settings: { ...verified, dependency, source: 'ALFRESCO', isDefault: false },
          reused: Boolean(saved?.reused),
        }
      })
    },
  }
}
