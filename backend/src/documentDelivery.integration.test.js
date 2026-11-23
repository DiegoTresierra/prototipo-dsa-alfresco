import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { identityResponse } from './testFixtures/institutionalIdentity.js'

test('legacy creation cannot bypass official emission; recovery only associates an authorized original without ACL changes', async (t) => {
  Object.assign(process.env, {
    DISPATCH_PERSISTENCE: 'local', DISPATCH_ALFRESCO_WRITES_ENABLED: 'false', OFFICIAL_EMISSION_WRITES_ENABLED: 'false',
    PORT: '0', SESSION_SECRET: 'delivery-fixture', ALFRESCO_TARGET: 'https://alfresco.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'test', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({ dependencies: { DTI: 'GROUP_DTI', DSA: 'GROUP_DSA' }, functions: { direccion: 'GROUP_DIRECTORS' } }),
    ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON: JSON.stringify({ DTI: { emitidos: 'dti-emitted', porAtender: 'dti-attention', porConocimiento: 'dti-knowledge' }, DSA: { emitidos: 'dsa-emitted', porAtender: 'dsa-attention', porConocimiento: 'dsa-knowledge' } }),
    ALFRESCO_OFFICE_GROUP_IDS_JSON: JSON.stringify({ DTI: 'GROUP_DTI', DSA: 'GROUP_DSA' }),
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'distribution', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'fixture-password',
  })
  const { server } = await import('./index.js')
  const { config } = await import('./config.js')
  const { createSession } = await import('./sessionStore.js')
  if (!server.listening) await once(server, 'listening')
  const realFetch = globalThis.fetch
  t.after(async () => { globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) })
  const actors = new Map()
  const headers = (dependency) => {
    const id = 'director-' + dependency
    const authorization = 'Basic actor-' + dependency
    actors.set(authorization, { id, dependency, functionalRole: 'direccion' })
    const session = createSession({ alfresco: { id }, authorization, dependency, functionalRole: 'direccion', authorizationStatus: 'active', capabilities: ['documents:read', 'documents:write'] })
    const sig = crypto.createHmac('sha256', config.sessionSecret).update(session.id).digest('base64url')
    return { Cookie: 'gd_session=' + session.id + '.' + sig, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }
  }
  const dti = headers('DTI'), dsa = headers('DSA')
  let source = 'DTI', destination = 'DSA', creator = 'director-DTI', permitted = false, conflict = false, linked = false, deniedRead = false, associationDenied = false, official = false
  const calls = []
  const serviceAuth = 'Basic ' + Buffer.from('service-ticket').toString('base64')
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.hostname === '127.0.0.1') return realFetch(url, options)
    assert.equal(parsed.hostname, 'alfresco.invalid')
    const identity = identityResponse(url, options, actors, config.groupMappings)
    if (identity) return identity
    const p = parsed.pathname, method = options.method || 'GET'
    calls.push({ p, method })
    assert.notEqual(method, 'PUT', 'recovery must never change ACLs or properties')
    if (p.endsWith('/tickets')) return Response.json({ entry: { id: 'service-ticket' } }, { status: 201 })
    if (p.endsWith('/people/-me-')) return Response.json({ entry: { id: 'distribution', enabled: true } })
    if (p.endsWith('/pdf-node')) {
      if (deniedRead) return Response.json({}, { status: 403 })
      return Response.json({ entry: { id: 'pdf-node', nodeType: 'cm:content', parentId: source.toLowerCase() + '-emitted', createdByUser: { id: creator }, isFile: true, content: { mimeType: 'application/pdf' },
        properties: official ? { 'gd:identidadEmision': 'reserved' } : {}, permissions: { isInheritanceEnabled: true, locallySet: permitted ? [{ authorityId: 'GROUP_' + destination, name: 'Consumer', accessStatus: 'ALLOWED' }] : [] } } })
    }
    if (p.endsWith('/secondary-children')) {
      assert.equal(options.headers.Authorization, serviceAuth)
      assert.equal(JSON.parse(options.body).childId, 'pdf-node')
      if (associationDenied) return Response.json({}, { status: 403 })
      return conflict ? Response.json({}, { status: 409 }) : Response.json({ entry: { childId: 'pdf-node', assocType: 'cm:contains' } }, { status: 201 })
    }
    if (p.endsWith('/parents')) return Response.json({ list: { entries: linked ? [{ entry: { id: destination.toLowerCase() + '-attention', association: { assocType: 'cm:contains', isPrimary: false } } }] : [], pagination: { hasMoreItems: false } } })
    throw Error('Unexpected upstream operation: ' + method + ' ' + p)
  }
  const base = 'http://127.0.0.1:' + server.address().port
  const options = () => ({ method: 'POST', headers: { ...(source === 'DTI' ? dti : dsa), 'X-UAC-Recipient-Dependency': destination, 'X-UAC-Receipt-Category': 'por-atender' }, body: JSON.stringify({ nodeId: 'pdf-node' }) })
  const retry = () => realFetch(base + '/api/documents/retry-director-delivery', options())
  assert.equal((await realFetch(base + '/api/documents/send-to-director', options())).status, 403)
  assert.equal(calls.length, 0, 'no new PDF or service write when official emission is disabled')
  const missing = await retry()
  assert.equal(missing.status, 409)
  assert.equal((await missing.json()).error, 'DIRECTOR_RECIPIENT_NODE_READ_REQUIRED')
  assert.ok(calls.every((c) => !c.p.endsWith('/secondary-children')))
  permitted = true
  for (const dep of ['DTI', 'DSA']) {
    source = dep; destination = dep === 'DTI' ? 'DSA' : 'DTI'; creator = 'director-' + dep
    for (const category of ['por-atender', 'por-conocimiento']) {
      const request = options(); request.headers['X-UAC-Receipt-Category'] = category
      const response = await realFetch(base + '/api/documents/retry-director-delivery', request)
      assert.equal(response.status, 201)
      const body = await response.json()
      assert.equal(body.emittedEntry.id, body.receivedEntry.id)
    }
  }
  source = 'DTI'; destination = 'DSA'; creator = 'director-DTI'
  conflict = true
  assert.equal((await retry()).status, 502)
  linked = true
  assert.equal((await retry()).status, 201, 'verified existing secondary association is idempotent')
  associationDenied = true
  assert.equal((await retry()).status, 403)
  associationDenied = false
  creator = 'foreign'
  assert.equal((await retry()).status, 403)
  creator = 'director-DTI'; official = true
  assert.equal((await retry()).status, 403, 'official records must use official reconciliation')
  official = false; deniedRead = true
  assert.equal((await retry()).status, 403)
  assert.ok(calls.every((c) => c.method !== 'PUT' && !c.p.endsWith('/children')))
})
