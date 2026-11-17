import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeNodeRead, filterDocumentCollection, validateDocumentReadRequest } from './documentReadPolicy.js'

const core = '/api/-default-/public/alfresco/versions/1'
function fixture() {
  const unit = { code: 'fixture', name: 'Unidad de prueba', dependency: 'DSA' }
  const nodes = {
    own: { createdByUser: { id: 'head' }, parentId: 'foreign-office' },
    assigned: { parentId: 'dsa-attention' },
    knowledge: { parentId: 'dsa-knowledge' },
    secondary: { parentId: 'dti-emitted' },
    unassigned: { parentId: 'dsa-attention' },
    foreign: { parentId: 'foreign-office' },
    denied: { parentId: 'dsa-attention' },
  }
  const calls = []
  const context = {
    session: { alfresco: { id: 'head' }, dependency: 'DSA', functionalRole: 'jefe-unidad', capabilities: ['documents:read'], authorization: 'Basic head-ticket' },
    settings: { alfrescoTarget: 'https://alfresco.invalid', userUnitAssignments: { head: unit }, officeInboxNodeIds: { DSA: { porAtender: 'dsa-attention', porConocimiento: 'dsa-knowledge', emitidos: 'dsa-emitted' } } },
    listDispatches: () => ['assigned', 'denied'].map((documentId) => ({ documentId, status: 'PARCIAL', recipients: [{ userId: 'head', functionalRole: 'jefe-unidad', dependency: 'dsa', status: 'ASIGNADO' }] })),
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Basic head-ticket', 'never use service identity for document reads')
      calls.push(String(url))
      const path = new URL(url).pathname
      const id = path.split('/').at(-1)
      if (id === 'denied') return Response.json({}, { status: 403 })
      if (path.endsWith('/parents')) {
        const nodeId = path.split('/').at(-2)
        return Response.json({ list: { entries: nodeId === 'secondary' ? [{ entry: { id: 'dsa-knowledge' } }] : [], pagination: { hasMoreItems: false } } })
      }
      return nodes[id] ? Response.json({ entry: { id, isFile: true, ...nodes[id] } }) : Response.json({}, { status: 404 })
    },
  }
  return { context, calls }
}

test('one read policy preserves own, knowledge, secondary parents and assigned documents; denies attention without assignment', async () => {
  const { context } = fixture()
  for (const id of ['own', 'assigned', 'knowledge', 'secondary']) assert.equal(await authorizeNodeRead(context, id), true, id)
  for (const id of ['unassigned', 'foreign', 'denied', 'missing']) assert.equal(await authorizeNodeRead(context, id), false, id)
})

test('metadata and PDF paths require read capability and identical policy; folders and search cannot expand scope', () => {
  const { context } = fixture()
  for (const suffix of ['', '/content']) {
    const request = { method: 'GET', path: `${core}/nodes/foreign${suffix}`, session: context.session }
    assert.equal(validateDocumentReadRequest(request, context.settings).nodeId, 'foreign')
    assert.throws(() => validateDocumentReadRequest({ ...request, session: { ...context.session, capabilities: [] } }, context.settings), /DOCUMENT_READ_REQUIRED/)
  }
  assert.throws(() => validateDocumentReadRequest({ method: 'GET', path: `${core}/nodes/foreign/children`, session: context.session }, context.settings), /DOCUMENT_FOLDER_NOT_ALLOWED/)
  assert.throws(() => validateDocumentReadRequest({ method: 'POST', path: '/api/-default-/public/search/versions/1/search', session: context.session, body: { query: { query: '*' }, facets: {} } }, context.settings), /UNSUPPORTED_DOCUMENT_QUERY/)
})

test('search and folder lists repaginate allowed results and never expose totals or facets from upstream', async () => {
  for (const collection of ['children', 'search']) {
    const { context } = fixture()
    const original = context.fetchImpl
    context.fetchImpl = async (url, options) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/children') || parsed.pathname.endsWith('/search')) {
        const skip = options.body ? JSON.parse(options.body).paging.skipCount : Number(parsed.searchParams.get('skipCount'))
        const ids = skip === 0 ? ['foreign', 'knowledge'] : ['own', 'unassigned']
        return Response.json({ list: { entries: ids.map((id) => ({ entry: { id } })), pagination: { hasMoreItems: skip === 0, totalItems: 9999 } }, context: { facets: ['secret'] } })
      }
      return original(url, options)
    }
    const result = await filterDocumentCollection(context, { url: '/?maxItems=1', body: { query: { query: '*' } } }, { collection, nodeId: 'dsa-knowledge', skipCount: 1, maxItems: 1 })
    assert.deepEqual(result.list.entries.map(({ entry }) => entry.id), ['own'])
    assert.equal(result.list.pagination.totalItems, 2)
    assert.equal(result.list.pagination.hasMoreItems, false)
    assert.equal(result.context, undefined)
  }
})

test('assignments do not depend on units; legitimate institutional reads survive a failed assignment store', async () => {
  const { context } = fixture()
  context.listDispatches = () => { throw new Error('disk unavailable') }
  assert.equal(await authorizeNodeRead(context, 'secondary'), true)
  await assert.rejects(authorizeNodeRead(context, 'assigned'), /DISPATCH_STORE_UNAVAILABLE/)
  delete context.settings.userUnitAssignments.head
  context.listDispatches = () => [{ documentId: 'assigned', recipients: [{ userId: 'head', functionalRole: 'jefe-unidad', dependency: 'dsa', status: 'ASIGNADO' }] }]
  assert.equal(await authorizeNodeRead(context, 'assigned'), true)
})

test('specialist reading requires own or assigned documents, never merely a known UUID or an outgoing record', async () => {
  const { context } = fixture()
  context.session.functionalRole = 'especialista'
  context.listDispatches = () => [{ documentId: 'assigned', recipients: [{ userId: 'head', functionalRole: 'especialista', dependency: 'dsa', status: 'ASIGNADO' }] }, { documentId: 'foreign', recipients: [{ userId: 'someone-else', functionalRole: 'especialista', dependency: 'dsa', status: 'ASIGNADO' }] }]
  assert.equal(await authorizeNodeRead(context, 'assigned'), true)
  assert.equal(await authorizeNodeRead(context, 'own'), true)
  for (const id of ['foreign', 'knowledge', 'secondary', 'denied']) assert.equal(await authorizeNodeRead(context, id), false)
})
