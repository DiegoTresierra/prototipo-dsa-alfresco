import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { identityResponse } from './testFixtures/institutionalIdentity.js'

test('generic creation revalidates the exact current recipient, constructs type metadata and verifies the resulting node', async (t) => {
  Object.assign(process.env, { PORT: '0', SESSION_SECRET: 'generic-fixture', ALFRESCO_TARGET: 'https://generic.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'fixture', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    DISPATCH_PERSISTENCE: 'local', DISPATCH_ALFRESCO_WRITES_ENABLED: 'false', OFFICIAL_EMISSION_WRITES_ENABLED: 'false',
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'directory', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'fixture-only',
    ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({ dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' }, functions: { direccion: 'GROUP_DIR', 'jefe-unidad': 'GROUP_HEAD', especialista: 'GROUP_STAFF' } }),
    ALFRESCO_USER_INBOX_NODE_IDS_JSON: JSON.stringify({ target: 'target-folder' }),
    ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON: JSON.stringify({ DSA: { emitidos: 'official-folder' } }) })
  const { config } = await import('./config.js')
  const { server } = await import('./index.js')
  const { createSession } = await import('./sessionStore.js')
  if (!server.listening) await once(server, 'listening')
  const realFetch = globalThis.fetch
  t.after(async () => { globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) })
  const actor = { id: 'sender', dependency: 'DSA', functionalRole: 'jefe-unidad' }
  const actors = new Map([['Basic actor', actor]])
  const session = createSession({ alfresco: { id: actor.id }, ...actor, authorization: 'Basic actor', authorizationStatus: 'active', capabilities: ['documents:read', 'documents:write'] })
  const signature = crypto.createHmac('sha256', config.sessionSecret).update(session.id).digest('base64url')
  const headers = { Cookie: `gd_session=${session.id}.${signature}`, 'X-CSRF-Token': session.csrfToken,
    'X-UAC-Recipient-User': 'target', 'X-UAC-Recipient-Dependency': 'dsa', 'X-UAC-Recipient-Role': 'especialista' }
  const state = { enabled: true, dependency: 'DSA', role: 'STAFF', personStatus: 200, directoryStatus: 200, folderAllowed: true,
    mismatchFolder: false, mismatchModel: false, failVerification: false, creations: 0, reads: 0, remap: false }
  let saved
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url)
    if (u.hostname === '127.0.0.1') return realFetch(url, options)
    assert.equal(u.hostname, 'generic.invalid')
    const identity = identityResponse(url, options, actors, config.groupMappings)
    if (identity) return identity
    const p = u.pathname
    if (p.endsWith('/people/-me-')) return state.directoryStatus === 200 ? Response.json({ entry: { id: 'directory', enabled: true } }) : Response.json({}, { status: state.directoryStatus })
    if (p.includes('/service/api/groups/')) {
      const group = p.split('/').at(-2)
      const ids = group === 'HEAD' ? ['sender'] : group === 'DSA' ? ['sender'] : []
      if (group === state.dependency || group === state.role) ids.push('target')
      return Response.json({ data: ids.map((shortName) => ({ shortName, authorityType: 'USER' })), paging: { skipCount: 0, totalItems: ids.length } })
    }
    if (p.endsWith('/people/target')) {
      if (state.remap) config.userInboxNodeIds.target = 'changed-folder'
      if (state.personStatus === 'network') throw new Error('simulated directory transport failure')
      if (state.personStatus !== 200) return Response.json({}, { status: state.personStatus })
      return Response.json({ entry: { id: 'target', enabled: state.enabled } })
    }
    if (p.endsWith('/people/sender')) return Response.json({ entry: { id: 'sender', enabled: true } })
    if (p.endsWith('/classes/gd_clasificacion')) return Response.json({ properties: state.mismatchModel ? {} : { 'gd:tipoDocumental': { dataType: 'd:text', multiValued: false, protected: false } } })
    if (p.endsWith('/nodes/target-folder')) return Response.json({ entry: { id: state.mismatchFolder ? 'other-folder' : 'target-folder', isFolder: true, allowableOperations: state.folderAllowed ? ['create'] : [] } })
    if (p.endsWith('/nodes/target-folder/children') && options.method === 'POST') {
      assert.ok(options.body instanceof FormData)
      assert.equal(options.body.get('documentType'), null, 'raw business fields never reach Alfresco')
      assert.equal(options.body.get('gd:tipoDocumental'), 'Oficio')
      assert.deepEqual(JSON.parse(options.body.get('aspectnames')), ['gd:clasificacion'])
      assert.equal(options.body.get('gd:asignaciones'), null)
      state.creations++
      saved = { id: 'created-pdf', nodeType: 'cm:content', isFile: true, createdByUser: { id: 'sender' }, content: { mimeType: 'application/pdf' },
        aspectNames: ['gd:clasificacion'], properties: { 'cm:title': options.body.get('cm:title'), 'gd:tipoDocumental': options.body.get('gd:tipoDocumental') } }
      return Response.json({ entry: { id: saved.id } }, { status: 201 })
    }
    if (p.endsWith('/nodes/created-pdf')) {
      state.reads++
      return state.failVerification ? Response.json({}, { status: 500 }) : Response.json({ entry: saved })
    }
    throw new Error(`Unexpected mocked request ${options.method} ${p}`)
  }
  const base = `http://127.0.0.1:${server.address().port}`
  const path = '/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/target-folder/children'
  const form = (type = 'Oficio') => { const f = new FormData(); f.set('filedata', new Blob(['%PDF-1.7\nfixture']), 'fixture.pdf'); f.set('cm:title', 'Title'); f.set('documentType', type); return f }
  const post = (extraHeaders = {}, body = form()) => realFetch(base + path, { method: 'POST', headers: { ...headers, ...extraHeaders }, body })
  for (const [key, value, expected] of [['enabled', false, 403], ['dependency', 'DTI', 403], ['role', 'DIR', 403], ['role', 'MISSING', 403],
    ['personStatus', 404, 503], ['personStatus', 500, 503], ['personStatus', 'network', 503], ['directoryStatus', 503, 503], ['folderAllowed', false, 403], ['mismatchFolder', true, 403], ['mismatchModel', true, 503], ['remap', true, 403]]) {
    const previous = state[key]; state[key] = value
    assert.equal((await post()).status, expected, key)
    assert.equal(state.creations, 0, 'no rejected selection creates a node')
    state[key] = previous; config.userInboxNodeIds.target = 'target-folder'
  }
  assert.equal((await post({ 'X-UAC-Recipient-Role': 'jefe-unidad' })).status, 403)
  assert.equal((await post({ 'X-UAC-Recipient-User': 'another-user' })).status, 403)
  assert.equal((await post({}, form('unapproved type'))).status, 400)
  const injected = form(); injected.set('gd:tipoDocumental', 'arbitrary')
  assert.equal((await post({}, injected)).status, 403)
  const valid = await post()
  assert.equal(valid.status, 201)
  assert.equal((await valid.json()).entry.properties['gd:tipoDocumental'], 'Oficio')
  assert.equal(state.reads, 1, 'the successful POST is followed by an actor GET')
  const after = await realFetch(base + '/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/created-pdf?include=properties', { headers })
  assert.equal(after.status, 200)
  assert.equal((await after.json()).entry.properties['gd:tipoDocumental'], 'Oficio')
  state.failVerification = true
  const uncertain = await post()
  assert.equal(uncertain.status, 502)
  const result = await uncertain.json()
  assert.equal(result.uncertain, true)
  assert.equal(result.emittedNodeId, 'created-pdf')
})
