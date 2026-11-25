import test from 'node:test'
import assert from 'node:assert/strict'
import { createResponseTimesService, responseTimesDefaults, responseTimesDependency, responseTimesReadAllowed, responseTimesWriteAllowed, validateResponseTimesInput } from './responseTimesService.js'

const validValues = [
  { priority: 'NORMAL', value: 5, unit: 'DIAS' },
  { priority: 'ALTA', value: 3, unit: 'DIAS' },
  { priority: 'URGENTE', value: 1, unit: 'DIAS' },
]
const changedValues = [
  { priority: 'NORMAL', value: 5, unit: 'DIAS' },
  { priority: 'ALTA', value: 36, unit: 'HORAS' },
  { priority: 'URGENTE', value: 8, unit: 'HORAS' },
]

test('returns defaults without creating Alfresco data and leaves editing disabled', async () => {
  const result = await createResponseTimesService().read('dsa')
  assert.deepEqual(result, responseTimesDefaults('dsa'))
  assert.deepEqual(result.values, validValues)
  assert.equal(result.capabilities.edit, false)
})

test('preserves session and dependency authorization rules', () => {
  assert.equal(responseTimesReadAllowed({ authorizationStatus: 'active', capabilities: ['documents:read'] }), true)
  assert.equal(responseTimesReadAllowed({ authorizationStatus: 'inactive', capabilities: ['documents:read'] }), false)
  assert.equal(responseTimesWriteAllowed({ authorizationStatus: 'active', functionalRole: 'direccion', capabilities: ['documents:write'] }), true)
  assert.equal(responseTimesWriteAllowed({ authorizationStatus: 'active', functionalRole: 'especialista', capabilities: ['documents:write'] }), false)
  assert.equal(responseTimesDependency({ dependency: 'dsa' }, { DSA: ['GROUP_GD_DSA'] }), 'dsa')
  assert.equal(responseTimesDependency({ dependency: 'other' }, { DSA: ['GROUP_GD_DSA'] }), '')
})

test('validates exact priority values and rejects caller-supplied actor/dependency', () => {
  assert.deepEqual(validateResponseTimesInput({ operationId: 'op-test-0001', values: validValues }).values, validValues)
  assert.throws(() => validateResponseTimesInput({ operationId: 'op-test-0001', actorId: 'spoofed', values: validValues }), { code: 'RESPONSE_TIMES_INVALID_INPUT' })
  assert.throws(() => validateResponseTimesInput({ operationId: 'op-test-0001', dependency: 'dti', values: validValues }), { code: 'RESPONSE_TIMES_INVALID_INPUT' })
  assert.throws(() => validateResponseTimesInput({ operationId: 'op-test-0001', values: [{ ...validValues[0], value: 0 }, ...validValues.slice(1)] }), { code: 'RESPONSE_TIMES_INVALID_INPUT' })
})

test('rejects reads without dependency and invalid persistence configuration', async () => {
  await assert.rejects(createResponseTimesService().read(''), { code: 'RESPONSE_TIMES_DEPENDENCY_REQUIRED' })
  await assert.rejects(createResponseTimesService({ persistenceConfigurationInvalid: true }).read('dsa'), { code: 'RESPONSE_TIMES_ALFRESCO_CONFIGURATION_INVALID' })
})

test('surfaces Alfresco read failures without fallback', async () => {
  const service = createResponseTimesService({ repository: { getByDependency: async () => { throw Object.assign(new Error('denied'), { code: 'ALFRESCO_FORBIDDEN', status: 503 }) } } })
  await assert.rejects(service.read('dsa'), { code: 'ALFRESCO_FORBIDDEN' })
})

test('exposes saved data but keeps editing disabled without pilot authorization', async () => {
  const record = { revision: 'r1', values: validValues, modifiedAt: '2026-01-01T00:00:00Z', actorId: 'DSA_T' }
  const result = await createResponseTimesService({ writesEnabled: true, repository: {
    getByDependency: async () => record, canWrite: async () => false, save: async () => assert.fail('must not save'),
  } }).read('dsa')
  assert.equal(result.source, 'ALFRESCO')
  assert.equal(result.modifiedBy, 'DSA_T')
  assert.equal(result.capabilities.edit, false)
})

test('switch off rejects a change after read-only reconciliation', async () => {
  let reads = 0
  const service = createResponseTimesService({ repository: {
    getByDependency: async () => { reads += 1; return null },
    save: async () => assert.fail('must not save'),
  } })
  await assert.rejects(service.update('dsa', 'DSA_T', { operationId: 'op-test-0001', values: changedValues }), { code: 'RESPONSE_TIMES_WRITES_DISABLED' })
  assert.equal(reads, 1)
})

test('operationId retry is reconciled from the config record without a separate audit repository', async () => {
  const record = { revision: 'r2', operationId: 'response-retry-0001', actorId: 'DSA_T', values: changedValues }
  const service = createResponseTimesService({ writesEnabled: true, repository: { getByDependency: async () => record, save: async () => assert.fail('retry must not write') } })
  const result = await service.update('dsa', 'DSA_T', { operationId: record.operationId, expectedRevision: 'r1', values: changedValues })
  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.reused, true)
  await assert.rejects(service.update('dsa', 'OTHER', { operationId: record.operationId, expectedRevision: 'r1', values: changedValues }), { code: 'RESPONSE_TIMES_OPERATION_ID_CONFLICT' })
})

test('rejects stale revisions and denied Alfresco permissions before changing data', async () => {
  const record = { revision: 'r2', operationId: 'old-operation', actorId: 'DSA_T', values: validValues }
  const service = createResponseTimesService({ writesEnabled: true, repository: {
    getByDependency: async () => record, canWrite: async () => false, save: async () => assert.fail('must not save'),
  } })
  await assert.rejects(service.update('dsa', 'DSA_T', { operationId: 'new-operation-01', expectedRevision: 'r1', values: changedValues }), { code: 'RESPONSE_TIMES_REVISION_CONFLICT' })
  await assert.rejects(service.update('dsa', 'DSA_T', { operationId: 'new-operation-01', expectedRevision: 'r2', values: changedValues }), { code: 'RESPONSE_TIMES_WRITE_PERMISSION_UNAVAILABLE' })
})

test('serializes simultaneous same-dependency updates and rejects the stale second writer', async () => {
  let current = { id: 'config-uuid', revision: 'r1', operationId: 'previous-op', actorId: 'DSA_T', values: validValues }
  let writes = 0
  const repository = {
    getByDependency: async () => structuredClone(current),
    canWrite: async () => true,
    save: async ({ values, operationId, actorId }) => {
      writes += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      current = { ...current, revision: `r${writes + 1}`, operationId, actorId, values: structuredClone(values) }
      return structuredClone(current)
    },
  }
  const service = createResponseTimesService({ writesEnabled: true, repository })
  const request = (operationId, values) => service.update('dsa', 'DSA_T', { operationId, expectedRevision: 'r1', values })
  const results = await Promise.allSettled([
    request('simultaneous-op-001', changedValues),
    request('simultaneous-op-002', [{ ...changedValues[0], value: 12 }, ...changedValues.slice(1)]),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'RESPONSE_TIMES_REVISION_CONFLICT').length, 1)
  assert.equal(writes, 1)
})

test('marks uncertain persistence as partial and preserves operationId for reconciliation', async () => {
  let current = { id: 'config-uuid', revision: 'r1', operationId: 'old-op', actorId: 'DSA_T', values: validValues }
  let firstAttempt = true
  let pendingLeaseRecord = null
  const repository = {
    getByDependency: async () => structuredClone(current),
    canWrite: async () => true,
    save: async ({ values, operationId, actorId }) => {
      if (firstAttempt) {
        firstAttempt = false
        throw Object.assign(new Error('transport'), { code: 'RESPONSE_TIMES_OPERATION_UNCERTAIN', status: 503, operationId, operationStatus: 'PARCIAL' })
      }
      current = { ...current, revision: 'r2', operationId, actorId, values: structuredClone(values) }
      return structuredClone(current)
    },
  }
  const service = createResponseTimesService({ writesEnabled: true, repository, onPendingOperation: (pending) => { pendingLeaseRecord = pending } })
  await assert.rejects(service.update('dsa', 'DSA_T', { operationId: 'uncertain-op-001', expectedRevision: 'r1', values: changedValues }), {
    code: 'RESPONSE_TIMES_OPERATION_UNCERTAIN', operationId: 'uncertain-op-001', operationStatus: 'PARCIAL',
  })
  assert.equal(pendingLeaseRecord.operationId, 'uncertain-op-001')
  await assert.rejects(service.update('dsa', 'DSA_T', { operationId: 'different-op-001', expectedRevision: 'r1', values: validValues }), { code: 'RESPONSE_TIMES_OPERATION_PENDING' })
  const reconciled = await service.update('dsa', 'DSA_T', { operationId: 'uncertain-op-001', expectedRevision: 'r1', values: changedValues })
  assert.equal(reconciled.status, 'COMPLETED')
  assert.equal(pendingLeaseRecord, null)
})

test('does not persist a no-op or a not-yet-configured default', async () => {
  let writes = 0
  const service = createResponseTimesService({ writesEnabled: true, repository: { getByDependency: async () => null, save: async () => { writes += 1 } } })
  const result = await service.update('dsa', 'DSA_T', { operationId: 'default-noop-01', values: validValues })
  assert.equal(result.status, 'UNCHANGED')
  assert.equal(writes, 0)
})
