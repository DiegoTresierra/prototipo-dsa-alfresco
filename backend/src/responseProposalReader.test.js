import test from 'node:test'
import assert from 'node:assert/strict'
import { createResponseProposalReader } from './responseProposalReader.js'
import { applyReviewEvent, reviewHash, proposalMetadataHash } from './responseReview.js'

function fixture() {
  const bytes = Buffer.from('%PDF-1.7 fixture')
  const version = { id: '1.0', isFile: true, name: 'Propuesta', content: { mimeType: 'application/pdf' }, properties: { 'cm:title': 'Propuesta' } }
  const event = { id: 'event', requestKey: 'key', action: 'CREATE', actorUserId: 'author', actorRole: 'direccion', dependency: 'dsa',
    at: '2026-11-19T15:00:00Z', expectedRevision: 0, snapshot: { versionId: '1.0', contentSha256: reviewHash(bytes), metadataSha256: proposalMetadataHash(version) }, reason: '', emissionDocumentId: null }
  const process = applyReviewEvent({ schemaVersion: 1, id: 'process', originalDocumentId: 'original', proposalDocumentId: 'secret-proposal',
    authorUserId: 'author', authorRole: 'direccion', dependency: 'dsa', assignmentId: null, revision: 0, state: 'BORRADOR', snapshot: null, events: [], approval: null, emissionDocumentId: null }, event, { verified: true })
  const state = { denied: false, originalDenied: false, foreignDenied: false, bytes, relation: true, version, processes: [process], actorHeaders: [] }
  const envelope = () => ({ schemaVersion: 1, revision: 0, documentId: 'original', dispatches: [], history: [], reviewProcesses: state.processes })
  const page = (entries) => ({ list: { pagination: { skipCount: 0, hasMoreItems: false }, entries: entries.map((entry) => ({ entry })) } })
  const fetch = async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); state.actorHeaders.push(options.headers.Authorization)
    const path = new URL(url).pathname.split('/nodes/')[1]
    if (path === 'original') return state.originalDenied ? new Response('', { status: 403 }) : Response.json({ entry: { id: 'original', isFile: true, properties: { 'gd:asignaciones': JSON.stringify(envelope()) } } })
    if (path.startsWith('secret-proposal') && (state.denied || state.foreignDenied && options.headers.Authorization === 'foreign')) return new Response('', { status: 403 })
    if (path === 'secret-proposal') return Response.json({ entry: { id: 'secret-proposal', isFile: true, nodeType: 'cm:content', content: { mimeType: 'application/pdf' }, aspectNames: ['cm:versionable'], properties: { 'cm:title': 'Propuesta', 'cm:versionLabel': '1.0' } } })
    if (path.endsWith('/targets')) return Response.json(page(state.relation ? [{ id: 'original', association: { assocType: 'cm:references' } }] : []))
    if (path.endsWith('/versions')) return Response.json(page([{ id: '1.0' }]))
    if (path.endsWith('/versions/1.0')) return Response.json({ entry: state.version })
    if (path.endsWith('/versions/1.0/content')) return new Response(state.bytes)
    throw new Error('Unexpected GET')
  }
  return { state, reader: createResponseProposalReader({ alfrescoTarget: 'https://mock.invalid' }, fetch) }
}

test('reader returns empty for legacy documents, verifies persisted version with actor identity only', async () => {
  const { state, reader } = fixture()
  const result = await reader.list('original', { authorization: 'actor' })
  assert.equal(result.proposals[0].status, 'AVAILABLE')
  assert.equal(result.writesEnabled, false)
  assert.deepEqual(await reader.content('original', 'process', '1.0', { authorization: 'actor' }), state.bytes)
  assert.ok(state.actorHeaders.every((h) => h === 'actor'))
  state.processes = undefined
  assert.deepEqual((await reader.list('original', { authorization: 'actor' })).proposals, [])
})

test('ACL denies original, proposals and cross-dependency actors without leaking identifiers', async () => {
  const { state, reader } = fixture()
  state.originalDenied = true
  await assert.rejects(reader.list('original', { authorization: 'actor' }))
  state.originalDenied = false; state.denied = true
  const result = await reader.list('original', { authorization: 'actor' })
  assert.deepEqual(result.proposals, [{ status: 'INACCESSIBLE' }])
  assert.ok(!JSON.stringify(result).includes('secret-proposal'))
  await assert.rejects(reader.content('original', 'process', '1.0', { authorization: 'actor' }))
  await assert.rejects(reader.content('original', 'arbitrary', '1.0', { authorization: 'actor' }))
  state.denied = false; state.foreignDenied = true
  assert.equal((await reader.list('original', { authorization: 'foreign' })).proposals[0].status, 'INACCESSIBLE')
  // Cross-dependency reading is permitted when the original policy and both node ACLs permit it.
  state.foreignDenied = false
  assert.equal((await reader.list('original', { authorization: 'foreign' })).proposals[0].status, 'AVAILABLE')
})

test('empty PDF, forged bytes, missing relation and version metadata are explicit failures', async () => {
  for (const [mutate, expected] of [
    [(s) => { s.bytes = Buffer.alloc(0) }, 'INVALID_VERSION'],
    [(s) => { s.bytes = Buffer.from('not PDF') }, 'INVALID_VERSION'],
    [(s) => { s.bytes = Buffer.from('%PDF-altered') }, 'INCONSISTENT'],
    [(s) => { s.relation = false }, 'INCONSISTENT'],
    [(s) => { s.version.properties = undefined }, 'INCONSISTENT'],
    [(s) => { s.version.properties['cm:title'] = 'altered' }, 'INCONSISTENT'],
  ]) {
    const { state, reader } = fixture(); mutate(state)
    assert.equal((await reader.list('original', { authorization: 'actor' })).proposals[0].status, expected)
  }
})
