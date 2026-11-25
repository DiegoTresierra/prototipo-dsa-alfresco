import test from 'node:test'
import assert from 'node:assert/strict'
import { createAlfrescoNumberedIssuer, enumerateIssuedRecords } from './alfrescoNumbering.js'

function fixture() {
  const records = []
  const attempts = new Map()
  const log = []
  const adapter = {
    async assertReady() {},
    async reconcile({ requestKey }) { return attempts.has(requestKey) ? { state: 'completed', record: attempts.get(requestKey) } : { state: 'absent' } },
    async list() { return records.slice() },
    async emit(allocation) {
      await new Promise((resolve) => setImmediate(resolve))
      const record = { ...allocation, documentId: `pdf-${records.length}` }
      records.push(record)
      attempts.set(allocation.requestKey, record)
      log.push('emit')
      return record
    },
    async verify() { log.push('GET') },
  }
  return { records, adapter, log }
}
const request = (requestKey, documentCode = 'DTI') => ({ requestKey, documentCode, now: new Date('2026-11-18T12:00:00Z') })

test('same sequence waits through emission and GET; maximum includes cancelled records, not latest date', async () => {
  const { records, adapter, log } = fixture()
  records.push({ documentId: 'old', documentCode: 'DTI', cycle: 2026, number: 9, status: 'ANULADO' },
    { documentId: 'recent', documentCode: 'DTI', cycle: 2026, number: 2 })
  const issue = createAlfrescoNumberedIssuer(adapter)
  const results = await Promise.all([issue(request('a')), issue(request('b'))])
  assert.deepEqual(results.map((r) => r.number), [10, 11])
  assert.deepEqual(log, ['emit', 'GET', 'emit', 'GET'])
  assert.equal((await issue(request('a'))).number, 10)
  assert.equal((await createAlfrescoNumberedIssuer(adapter)(request('a'))).number, 10)
  assert.equal(records.length, 4)
})

test('complete codes and January 2 cycles remain independent', async () => {
  const { adapter } = fixture()
  const issue = createAlfrescoNumberedIssuer(adapter)
  const results = await Promise.all(['DTI', 'DTI-UNIT', 'DTI-UNIT-SIGN'].map((code) => issue(request(code, code))))
  assert.deepEqual(results.map((r) => r.number), [1, 1, 1])
  assert.equal((await issue({ ...request('jan1'), now: new Date('2027-01-01T20:00:00Z') })).number, 2)
  assert.equal((await issue({ ...request('jan2'), now: new Date('2027-01-02T05:00:00Z') })).number, 1)
})

test('timeout after creation is reconciled before new allocation; unknown result quarantines sequence', async () => {
  const { adapter, records } = fixture()
  const emit = adapter.emit
  adapter.emit = async (...args) => { await emit(...args); throw new Error('timeout') }
  const issue = createAlfrescoNumberedIssuer(adapter)
  await assert.rejects(issue(request('timeout')), /NUMBERING_RESULT_UNCERTAIN/)
  await assert.rejects(issue(request('another')), /NUMBERING_RESULT_UNCERTAIN/)
  assert.equal((await issue(request('timeout'))).number, 1)
  assert.equal(records.length, 1)
  adapter.emit = emit
  assert.equal((await issue(request('after'))).number, 2)
})

test('read-after-write failure, invalid metadata and missing coverage fail closed', async () => {
  const { adapter } = fixture()
  adapter.list = async () => []
  const issue = createAlfrescoNumberedIssuer(adapter)
  await assert.rejects(issue(request('invisible')), /NUMBERING_RESULT_UNCERTAIN/)
  await assert.rejects(issue(request('next')), /NUMBERING_RESULT_UNCERTAIN/)
  const broken = fixture().adapter
  broken.list = async () => [{ documentCode: 'DTI', cycle: 2026, number: '9' }]
  await assert.rejects(createAlfrescoNumberedIssuer(broken)(request('bad')), /NUMBERING_INVALID_OFFICIAL_RECORD/)
  broken.assertReady = async () => { throw new Error('NUMBERING_COVERAGE_NOT_VERIFIED') }
  await assert.rejects(createAlfrescoNumberedIssuer(broken)(request('no-coverage')), /NUMBERING_COVERAGE_NOT_VERIFIED/)
})

test('failed preflight releases queue; existing duplicate official numbers block allocation', async () => {
  const { adapter, records } = fixture()
  const issue = createAlfrescoNumberedIssuer(adapter)
  adapter.assertReady = async () => { throw new Error('offline') }
  await assert.rejects(issue(request('offline')), /offline/)
  adapter.assertReady = async () => {}
  assert.equal((await issue(request('recovered'))).number, 1)
  records.push({ ...records[0], documentId: 'external-duplicate' })
  await assert.rejects(issue(request('duplicate')), /NUMBERING_DUPLICATE_OFFICIAL_RECORD/)
  assert.equal(records.length, 2)
})

test('direct enumeration paginates cm:contains, includes secondary and cancelled nodes, deduplicates UUIDs', async () => {
  const calls = []
  const get = async (url) => {
    calls.push(url)
    if (!url.includes('/children?')) {
      const id = url.split('/')[2].split('?')[0]
      return { entry: id === 'root' ? { id, isFolder: true } : { id, isFile: true } }
    }
    const second = url.includes('skipCount=1')
    return { list: { entries: [{ entry: { id: second ? 'secondary' : 'cancelled', association: { assocType: 'cm:contains' } } }], pagination: {
      totalItems: 2, skipCount: second ? 1 : 0, count: 1, hasMoreItems: !second,
    } } }
  }
  const result = await enumerateIssuedRecords({ rootIds: ['root', 'secondary'], get,
    decode: async (node) => ({ documentCode: 'DTI', cycle: 2026, number: node.id === 'cancelled' ? 8 : 2 }) })
  assert.deepEqual(result.map((r) => r.number), [8, 2])
  assert.ok(calls.filter((url) => url.includes('/children?')).every((url) => url.includes('where=%28assocType%3D%27cm%3Acontains%27%29')))
  assert.equal(calls.filter((url) => url.startsWith('/nodes/secondary?')).length, 1)
  await assert.rejects(enumerateIssuedRecords({ rootIds: [], get }), /NUMBERING_COVERAGE_NOT_VERIFIED/)
  await assert.rejects(enumerateIssuedRecords({ rootIds: ['root'], get: async () => ({}) , decode: () => null }), /NUMBERING_INVALID_REPOSITORY_RESPONSE/)
})
