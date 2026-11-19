import { createDocumentQueue } from './documentQueue.js'
import { numberingScope } from './numberingStore.js'
import { assertEmissionModel, decodeEmissionMetadata } from './officialEmissionContract.js'

const failure = (code) => Object.assign(new Error(code), { status: 503 })

// Prepared read adapter for ONE server-resolved institutional Emitidos root.
// decodeEmissionMetadata validates gd:numero decimal text and returns a numeric
// `number`; maximum calculation below must never compare raw repository strings.
// Model validation is separate from the controlled pilot's write authorization.
export function createInstitutionalEmissionReader({ folderId, get, modelProperties, decode = decodeEmissionMetadata }) {
  const all = async (scope) => {
    assertEmissionModel(modelProperties)
    return enumerateIssuedRecords({ rootIds: [folderId], get, decode: (node) => {
      const code = node.properties?.['gd:codigoDocumental']
      const cycle = node.properties?.['gd:cicloDocumental']
      // Explicitly classified other sequences cannot consume this sequence's
      // numbers. Unknown code/cycle still needs reconciliation, never guessing.
      const knownCode = typeof code === 'string' && code.trim() && code === code.trim()
      if (knownCode && code !== scope.documentCode) return null
      if (knownCode && Number.isSafeInteger(cycle) && cycle > 0 && cycle !== scope.cycle) return null
      return decode(node)
    } })
  }
  return {
    async list(scope) {
      return (await all(scope)).filter((record) => record.documentCode === scope.documentCode && record.cycle === scope.cycle)
    },
    async verify(expected) {
      assertEmissionModel(modelProperties)
      const record = decodeEmissionMetadata((await get(`/nodes/${encodeURIComponent(expected.documentId)}?include=properties`))?.entry)
      for (const key of ['documentId', 'documentCode', 'cycle', 'number', 'actorId', 'requestKey', 'payloadHash']) {
        if (record[key] !== expected[key]) throw failure('NUMBERING_EMISSION_MISMATCH')
      }
      if (!(await all(expected)).some((item) => item.documentId === record.documentId)) throw failure('NUMBERING_WRITE_NOT_VISIBLE')
      return record
    },
  }
}

// Direct repository enumeration, never SEARCH/AFTS. The caller supplies verified
// institutional roots and a reader of the REAL, approved metadata contract.
// No state/status filter: cancelled records consume their numbers too.
export async function enumerateIssuedRecords({ rootIds, get, decode }) {
  if (!Array.isArray(rootIds) || !rootIds.length || rootIds.some((id) => typeof id !== 'string' || !id) || typeof decode !== 'function') {
    throw failure('NUMBERING_COVERAGE_NOT_VERIFIED')
  }
  const seen = new Set()
  const records = []
  const visit = async (id) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = (await get(`/nodes/${encodeURIComponent(id)}?include=properties`))?.entry
    if (node?.id !== id) throw failure('NUMBERING_INVALID_REPOSITORY_RESPONSE')
    if (node.isFile === true) {
      // Decoder must explicitly classify non-official files, never silently skip
      // missing/malformed official metadata. No filename/timestamp guessing.
      const record = await decode(node)
      if (record !== null) {
        validateRecord(record)
        records.push({ ...record, documentId: id })
      }
      return
    }
    if (node.isFolder !== true) throw failure('NUMBERING_INVALID_REPOSITORY_RESPONSE')
    let skip = 0
    let total
    for (;;) {
      const payload = await get(`/nodes/${encodeURIComponent(id)}/children?where=%28assocType%3D%27cm%3Acontains%27%29&include=association&skipCount=${skip}&maxItems=100`)
      const { entries, pagination } = payload?.list || {}
      if (!Array.isArray(entries) || entries.length > 100 || !Number.isSafeInteger(pagination?.totalItems) ||
          pagination.totalItems < 0 || pagination.skipCount !== skip || pagination.count !== entries.length ||
          typeof pagination.hasMoreItems !== 'boolean' || (total !== undefined && total !== pagination.totalItems)) {
        throw failure('NUMBERING_INVALID_REPOSITORY_RESPONSE')
      }
      total = pagination.totalItems
      for (const item of entries) {
        if (typeof item?.entry?.id !== 'string' || !item.entry.id || item.entry.association?.assocType !== 'cm:contains') throw failure('NUMBERING_INVALID_REPOSITORY_RESPONSE')
        await visit(item.entry.id)
      }
      skip += entries.length
      if (skip > total || pagination.hasMoreItems !== (skip < total) || (skip < total && entries.length === 0)) {
        throw failure('NUMBERING_INVALID_REPOSITORY_RESPONSE')
      }
      if (!pagination.hasMoreItems) break
    }
  }
  for (const id of rootIds) await visit(id)
  return records
}

function validateRecord(record) {
  if (typeof record?.documentCode !== 'string' || !record.documentCode.trim() ||
      !Number.isSafeInteger(record.cycle) || !Number.isSafeInteger(record.number) || record.number < 1) {
    throw failure('NUMBERING_INVALID_OFFICIAL_RECORD')
  }
}

// Shared orchestration used by the controlled REST emitter. Adapter readiness
// is an institutional preflight obligation, not a feature flag or a proof itself.
// Process-local exclusion only; no guarantee against external writers.
export function createAlfrescoNumberedIssuer(adapter) {
  const withSequence = createDocumentQueue()
  const uncertain = new Map()
  return async ({ documentCode, requestKey, now = new Date(), payload }) => {
    if (typeof requestKey !== 'string' || !requestKey.trim()) throw failure('NUMBERING_REQUEST_KEY_REQUIRED')
    const scope = numberingScope(documentCode, now)
    const key = JSON.stringify([scope.documentCode, scope.cycle])
    return withSequence(key, async () => {
      await adapter.assertReady(scope)
      // Durable reconciliation is REQUIRED even after a process restart. It must
      // distinguish proven absence from a temporarily invisible/uncertain result.
      const result = await adapter.reconcile({ ...scope, requestKey, payload })
      if (result?.state === 'completed') {
        validateRecord(result.record)
        if (result.record.documentCode !== scope.documentCode || result.record.cycle !== scope.cycle) throw failure('NUMBERING_RETRY_CONFLICT')
        if (!result.record.documentId) throw failure('NUMBERING_INVALID_OFFICIAL_RECORD')
        await adapter.finalize?.(result.record, payload)
        await adapter.verify(result.record, payload)
        const visible = await adapter.list(scope, payload)
        if (!visible.some((record) => record.documentId === result.record.documentId && record.number === result.record.number &&
            record.documentCode === scope.documentCode && record.cycle === scope.cycle)) throw failure('NUMBERING_WRITE_NOT_VISIBLE')
        if (uncertain.get(key) === requestKey) uncertain.delete(key)
        return result.record
      }
      if (result?.state !== 'absent' || uncertain.has(key)) throw failure('NUMBERING_RESULT_UNCERTAIN')
      const records = await adapter.list(scope, payload)
      let maximum = 0
      const used = new Map()
      for (const record of records) {
        validateRecord(record)
        if (record.documentCode !== scope.documentCode || record.cycle !== scope.cycle) continue
        if (!record.documentId || (used.has(record.number) && used.get(record.number) !== record.documentId)) throw failure('NUMBERING_DUPLICATE_OFFICIAL_RECORD')
        used.set(record.number, record.documentId)
        maximum = Math.max(maximum, record.number)
      }
      if (!Number.isSafeInteger(maximum + 1)) throw failure('NUMBERING_SEQUENCE_EXHAUSTED')
      const allocation = { ...scope, requestKey, number: maximum + 1 }
      // Adapter writes a durable attempt identity in Alfresco before an uncertain
      // creation can be retried. There is no local counter or persistent ledger.
      uncertain.set(key, requestKey)
      try {
        const emitted = await adapter.emit(allocation, payload)
        validateRecord(emitted)
        if (!emitted.documentId || emitted.documentCode !== scope.documentCode || emitted.cycle !== scope.cycle || emitted.number !== allocation.number) {
          throw failure('NUMBERING_EMISSION_MISMATCH')
        }
        await adapter.finalize?.(emitted, payload)
        await adapter.verify(emitted, payload) // direct GET, not the creation response
        // Establish read-after-write visibility under the lock, including secondary
        // associations. Failure quarantines the sequence; never issue another number.
        const visible = await adapter.list(scope, payload)
        if (!visible.some((record) => record.documentId === emitted.documentId && record.documentCode === emitted.documentCode &&
            record.cycle === emitted.cycle && record.number === emitted.number)) throw failure('NUMBERING_WRITE_NOT_VISIBLE')
        uncertain.delete(key)
        return emitted
      } catch (cause) {
        throw Object.assign(failure('NUMBERING_RESULT_UNCERTAIN'), { cause })
      }
    })
  }
}
