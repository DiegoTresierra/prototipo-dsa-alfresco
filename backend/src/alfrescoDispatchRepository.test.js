import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAlfrescoDispatchRepository, assignmentProperty, responsibleProperty, dependencyProperty, parseAssignments, maxAssignmentBytes } from './alfrescoDispatchRepository.js'
import { acquirePilotLease } from './dispatchPilot.js'

const documentId = '18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097'
const director = { alfresco: { id: 'director' }, authorization: 'Basic actor', functionalRole: 'direccion', dependency: 'DSA' }
const input = (key = 'one', recipients = ['head-a']) => ({ documentId, requestKey: key, senderUserId: 'director',
  senderDependency: 'dsa', senderRole: 'direccion', originAssignmentId: null, instruction: 'Atender', priority: 'Normal',
  recipients: recipients.map((id) => ({ id, dependency: 'dsa', functionalRole: 'jefe-unidad', unit: null })) })

function fixture() {
  const settings = { alfrescoTarget: 'https://alfresco.invalid', distributionService: { username: 'gd_distribucion', password: 'test-only' },
    dispatchPilot: { writesEnabled: true, controlledEnvironment: true, expectedTarget: 'https://alfresco.invalid', documentIds: [documentId] },
    officeInboxNodeIds: { DSA: { porAtender: 'folder' } } }
  const state = { node: { id: documentId, isFile: true, parentId: 'foreign-primary', content: { mimeType: 'application/pdf' },
    aspectNames: ['cm:versionable'], allowableOperations: ['update'], properties: { 'gd:estado': 'existing-state', 'cm:title': 'preserve' } },
    model: true, actorDenied: false, writeStatus: 200, reads: 0, calls: [], onGet: null, onPut: null }
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname
    state.calls.push({ pathname, ...options })
    assert.equal(new URL(url).hostname, 'alfresco.invalid')
    if (pathname.endsWith('/people/-me-')) return Response.json({ entry: { id: 'gd_distribucion', enabled: true, capabilities: { isAdmin: false } } })
    if (pathname.endsWith('/classes/gd_tramite')) return Response.json({ properties: state.model ? Object.fromEntries([
      [assignmentProperty, false], [responsibleProperty, true], [dependencyProperty, true],
    ].map(([name, multiValued]) => [name, { dataType: 'd:text', multiValued, protected: false, indexed: name !== assignmentProperty }])) : {} })
    if (pathname.endsWith('/children')) return Response.json({ list: { entries: [{ entry: { ...state.node,
      association: { assocType: 'cm:contains', isPrimary: false } } }], pagination: { hasMoreItems: false } } })
    assert.equal(pathname.split('/').at(-1), documentId)
    if (options.method === 'PUT') {
      if (state.writeStatus !== 200) return Response.json({}, { status: state.writeStatus })
      const body = JSON.parse(options.body)
      assert.deepEqual(Object.keys(body.properties).sort(), [assignmentProperty, responsibleProperty, dependencyProperty].sort())
      assert.equal(options.headers.Authorization, 'Basic '+Buffer.from('gd_distribucion:test-only').toString('base64'))
      state.node.properties = { ...state.node.properties, ...body.properties }
      if (body.aspectNames) state.node.aspectNames = body.aspectNames
      await state.onPut?.()
    } else {
      if (state.actorDenied && options.headers.Authorization === director.authorization) return Response.json({}, { status: 403 })
      state.reads++
      await state.onGet?.(state.reads, options)
    }
    return Response.json({ entry: structuredClone(state.node) })
  }
  const repo = createAlfrescoDispatchRepository(settings, fetchImpl)
  const create = (value = input(), session = director) => repo.withDocument(value.documentId, () => repo.createDispatch(value, session))
  return { settings, state, repo, create, fetchImpl }
}

test('PUT/GET preserves original UUID, other aspects/properties and equivalent multiple recipients', async () => {
  const { state, create } = fixture()
  const result = await create(input('one', ['head-a', 'head-b']))
  assert.equal(result.documentId, documentId)
  assert.equal(result.recipients.length, 2)
  assert.equal(new Set(result.recipients.map((r) => r.id)).size, 2)
  assert.ok(result.recipients.every((r) => r.documentId === documentId && r.status === 'ASIGNADO'))
  assert.deepEqual(state.node.properties[responsibleProperty], ['head-a', 'head-b'])
  assert.deepEqual(state.node.properties[dependencyProperty], ['dsa'])
  assert.equal(state.node.properties['gd:estado'], 'existing-state')
  assert.equal(state.node.properties['cm:title'], 'preserve')
  assert.deepEqual(state.node.aspectNames, ['cm:versionable', 'gd:tramite'])
  const put = state.calls.findIndex((call) => call.method === 'PUT')
  assert.equal(state.calls[put + 1].method, 'GET')
  assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 1)
})

test('two simultaneous requests serialize entire read/modify/PUT/verification and preserve assignments', async () => {
  const { create, state } = fixture()
  await Promise.all([create(input('a')), create(input('b', ['head-b']))])
  const envelope = parseAssignments(state.node.properties[assignmentProperty], documentId)
  assert.equal(envelope.revision, 2)
  assert.equal(envelope.dispatches.length, 2)
  assert.equal(envelope.history.length, 2)
  assert.deepEqual(state.node.properties[responsibleProperty], ['head-a', 'head-b'])
})

test('idempotent retry survives repository restart and page/list reload without local JSON', async () => {
  const { create, state, settings, fetchImpl } = fixture()
  const first = await create()
  const restarted = createAlfrescoDispatchRepository(settings, fetchImpl)
  const second = await restarted.withDocument(documentId, () => restarted.createDispatch(input(), director))
  assert.equal(first.id, second.id)
  assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 1)
  for (let page = 0; page < 2; page++) {
    const records = await restarted.listDispatchesForUser('head-a', 'jefe-unidad', 'DSA', director)
    assert.equal(records[0].id, first.id)
  }
  await assert.rejects(restarted.withDocument(documentId, () => restarted.createDispatch({ ...input(), instruction: 'Changed' }, director)), /DISPATCH_REQUEST_CONFLICT/)
})

test('chained dispatch preserves original obligation, IDs and individual trace', async () => {
  const { create, state } = fixture()
  const parent = await create()
  const derived = { ...input('child'), senderUserId: 'head-a', senderRole: 'jefe-unidad', originAssignmentId: parent.recipients[0].id,
    recipients: [{ id: 'staff', dependency: 'dsa', functionalRole: 'especialista' }] }
  const result = await create(derived, { ...director, alfresco: { id: 'head-a' } })
  const value = parseAssignments(state.node.properties[assignmentProperty], documentId)
  assert.equal(result.originAssignmentId, parent.recipients[0].id)
  assert.deepEqual(value.dispatches[0], parent)
  assert.deepEqual(state.node.properties[responsibleProperty], ['head-a', 'staff'])
  assert.equal(value.history[1].assignmentIds[0], result.recipients[0].id)
  await assert.rejects(create({ ...derived, requestKey: 'wrong', originAssignmentId: 'unknown' }, { ...director, alfresco: { id: 'head-a' } }), /DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED/)
})

test('missing model, disabled writing and non-test UUID fail before PUT', async () => {
  for (const scenario of ['model', 'disabled', 'scope']) {
    const { create, state, settings } = fixture()
    if (scenario === 'model') state.model = false
    if (scenario === 'disabled') settings.dispatchPilot.writesEnabled = false
    if (scenario === 'scope') settings.dispatchPilot.documentIds = []
    await assert.rejects(create(), /DISPATCH_ALFRESCO_MODEL_NOT_READY|DISPATCH_ALFRESCO_WRITES_DISABLED|DISPATCH_PILOT_DOCUMENT_NOT_ALLOWED/)
    assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0)
  }
})

test('actor ACL and technical update permission are both mandatory; denied PUT preserves previous data and releases queue', async () => {
  const { create, state } = fixture()
  state.actorDenied = true
  await assert.rejects(create(), /DISPATCH_NODE_READ_DENIED/)
  state.actorDenied = false
  state.node.allowableOperations = ['read']
  await assert.rejects(create(), /DISPATCH_NODE_UPDATE_DENIED/)
  state.node.allowableOperations = ['update']
  state.writeStatus = 403
  const previous = JSON.stringify(state.node)
  await assert.rejects(create(), /DISPATCH_NODE_UPDATE_DENIED/)
  assert.equal(JSON.stringify(state.node), previous)
  state.writeStatus = 200
  await create()
})

test('corrupt/unsupported data is never silently reset; size limit is enforced', async () => {
  const { create, state } = fixture()
  state.node.aspectNames.push('gd:tramite')
  for (const raw of ['{broken', '{}', JSON.stringify({ schemaVersion: 2 }), null, 'x'.repeat(maxAssignmentBytes + 1)]) {
    state.node.properties[assignmentProperty] = raw
    await assert.rejects(create(), /DISPATCH_INVALID_ASSIGNMENTS/)
  }
  assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0)
})

test('observable external modification before PUT is rejected, not overwritten', async () => {
  const { create, state } = fixture()
  state.onGet = (count) => {
    if (count === 3) {
      state.node.aspectNames.push('gd:tramite')
      state.node.properties[assignmentProperty] = JSON.stringify({ schemaVersion: 1, revision: 1, documentId, dispatches: [], history: [] })
    }
  }
  await assert.rejects(create(), /DISPATCH_EXTERNAL_MODIFICATION/)
  assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0)
})

test('post-write mismatch is reported; never attempts a destructive rollback', async () => {
  const { create, state } = fixture()
  state.onPut = () => { state.node.properties[responsibleProperty] = ['external'] }
  await assert.rejects(create(), /DISPATCH_WRITE_VERIFICATION_FAILED/)
  assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 1)
})

test('server error and transport failure report uncertain outcome; committed retry is idempotent and queue is released', async () => {
  const { create, state } = fixture()
  state.writeStatus = 500
  await assert.rejects(create(), /DISPATCH_WRITE_OUTCOME_UNKNOWN/)
  assert.equal(state.node.properties[assignmentProperty], undefined)
  state.writeStatus = 200
  state.onPut = () => { throw new Error('simulated connection loss after repository commit') }
  await assert.rejects(create(), /DISPATCH_WRITE_OUTCOME_UNKNOWN/)
  const saved = JSON.parse(state.node.properties[assignmentProperty]).dispatches[0]
  state.onPut = null
  assert.equal((await create()).id, saved.id)
  assert.equal(JSON.parse(state.node.properties[assignmentProperty]).dispatches.length, 1)
})

test('projection corruption blocks even an idempotent success, rather than pretending consistency', async () => {
  const { create, state } = fixture()
  await create()
  state.node.properties[responsibleProperty] = ['foreign']
  await assert.rejects(create(), /DISPATCH_ASSIGNMENTS_PROJECTION_MISMATCH/)
  assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 1)
})

test('new serialized JSON exceeding the UTF-8 limit is rejected before writing', async () => {
  const { create, state } = fixture()
  const oversized = input()
  oversized.recipients[0].displayName = 'x'.repeat(maxAssignmentBytes)
  await assert.rejects(create(oversized), /DISPATCH_ASSIGNMENTS_SIZE_LIMIT/)
  assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0)
})

test('external writes after verification CAN lose data: local queue provides no cross-process guarantee', async () => {
  const { create, state } = fixture()
  const first = await create()
  const stale = structuredClone(state.node)
  await create(input('second', ['head-b']))
  state.node = stale // Simulated other process overwrites AFTER our verified success.
  const envelope = parseAssignments(state.node.properties[assignmentProperty], documentId)
  assert.deepEqual(envelope.dispatches.map((record) => record.id), [first.id])
  assert.equal(envelope.dispatches.length, 1, 'this test demonstrates the explicitly accepted limitation')
})

test('pilot requires explicit deployment attestation and exclusive local lease; stale lock is not auto-removed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-lease-'))
  try {
    const { settings } = fixture()
    settings.dispatchPersistence = 'alfresco'
    settings.dispatchPilot.leasePath = path.join(directory, 'pilot.lock')
    settings.dispatchPilot.controlledEnvironment = false
    assert.throws(() => acquirePilotLease(settings), /DISPATCH_PILOT_ENVIRONMENT_REQUIRED/)
    settings.dispatchPilot.controlledEnvironment = true
    const release = acquirePilotLease(settings)
    assert.throws(() => acquirePilotLease(settings), /DISPATCH_PILOT_LEASE_UNAVAILABLE/)
    release()
    const releaseAfterRestart = acquirePilotLease(settings)
    releaseAfterRestart()
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
