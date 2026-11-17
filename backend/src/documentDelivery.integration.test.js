import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { once } from 'node:events'

test('director delivery preserves a partial node and retries only ACL/association with authorization', async (t) => {
  Object.assign(process.env, {
    DISPATCH_PERSISTENCE: 'local', DISPATCH_ALFRESCO_WRITES_ENABLED: 'false',
    PORT: '0', SESSION_SECRET: 'test-secret-only', ALFRESCO_TARGET: 'http://alfresco.invalid',
    KEYCLOAK_ISSUER: 'http://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'test', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({ dependencies: { DTI: 'GROUP_DTI', DSA: 'GROUP_DSA' }, functions: { direccion: 'GROUP_directors' } }),
    ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON: JSON.stringify({ DTI: { emitidos: 'emitted-folder', porAtender: 'dti-attention', porConocimiento: 'dti-knowledge' }, DSA: { emitidos: 'dsa-emitted', porAtender: 'received-folder', porConocimiento: 'dsa-knowledge' } }),
    ALFRESCO_OFFICE_GROUP_IDS_JSON: JSON.stringify({ DTI: 'GROUP_DTI', DSA: 'GROUP_DSA' }),
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'gd_distribucion', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'test-password-only',
    ALFRESCO_DISTRIBUTION_USERNAME: '', ALFRESCO_DISTRIBUTION_PASSWORD: '',
  })
  const { server } = await import('./index.js')
  const { createSession } = await import('./sessionStore.js')
  if (!server.listening) await once(server, 'listening')
  const originalFetch = globalThis.fetch
  t.after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const session = createSession({ authorizationStatus: 'active', functionalRole: 'direccion', capabilities: ['documents:write'], dependency: 'DTI', alfresco: { id: 'sender' }, authorization: 'Basic test-ticket' })
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(session.id).digest('base64url')
  const cookie = `gd_session=${session.id}.${signature}`
  const base = `http://127.0.0.1:${server.address().port}`
  let permissions = { isInheritanceEnabled: true }
  let failUpdate = true
  let associationConflict = false
  let matchingParent = false
  let creator = 'sender'
  let emittedFolder = 'emitted-folder'
  let receivedFolder = 'received-folder'
  let serviceCanRead = true
  let serviceCanAssociate = true
  let serviceCanAuthenticate = true
  const serviceAuthorization = `Basic ${Buffer.from('service-test-ticket').toString('base64')}`
  const calls = []
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const node = () => ({ id: 'pdf-node', parentId: emittedFolder, isFile: true, createdByUser: { id: creator }, content: { mimeType: 'application/pdf' }, permissions })
  globalThis.fetch = async (url, options = {}) => {
    if (new URL(url).hostname !== 'alfresco.invalid') return originalFetch(url, options)
    const path = new URL(url).pathname
    const method = options.method || 'GET'
    calls.push({ path, method })
    if (path.endsWith('/authentication/versions/1/tickets')) {
      assert.equal(JSON.parse(options.body).userId, 'gd_distribucion')
      return serviceCanAuthenticate ? json({ entry: { id: 'service-test-ticket' } }, 201) : json({}, 401)
    }
    if (path.endsWith('/people/-me-')) {
      assert.equal(options.headers.Authorization, serviceAuthorization)
      return json({ entry: { id: 'gd_distribucion', enabled: true } })
    }
    const isServiceRequest = path.endsWith('/parents') || path.endsWith('/secondary-children') || (path.endsWith('/pdf-node') && options.headers.Authorization === serviceAuthorization)
    assert.equal(options.headers.Authorization, isServiceRequest ? serviceAuthorization : 'Basic test-ticket')
    if (path.endsWith('/pdf-node') && options.headers.Authorization === serviceAuthorization) {
      assert.equal(method, 'GET', 'the service must never update document content or permissions')
      return serviceCanRead ? json({ entry: node() }) : json({}, 403)
    }
    if (path.endsWith(`/${emittedFolder}/children`)) return json({ entry: node() }, 201)
    if (path.endsWith('/pdf-node/parents')) return json({ list: { entries: matchingParent ? [{ entry: { id: receivedFolder, association: { assocType: 'cm:contains', isPrimary: false } } }] : [], pagination: { hasMoreItems: false } } })
    if (path.endsWith('/pdf-node') && method === 'GET') return json({ entry: node() })
    if (path.endsWith('/pdf-node') && method === 'PUT') {
      if (failUpdate) return json({ error: 'simulated permission denial' }, 403)
      permissions = JSON.parse(options.body).permissions
      return json({ entry: node() })
    }
    if (path.endsWith(`/${receivedFolder}/secondary-children`)) {
      if (!serviceCanAssociate) return json({}, 403)
      assert.equal(JSON.parse(options.body).childId, 'pdf-node')
      return associationConflict ? json({}, 409) : json({ entry: { childId: 'pdf-node', assocType: 'cm:contains' } }, 201)
    }
    throw new Error(`Unexpected upstream request ${method} ${path}`)
  }
  const headers = { Cookie: cookie, 'X-CSRF-Token': session.csrfToken, 'X-UAC-Recipient-Dependency': 'DSA', 'X-UAC-Receipt-Category': 'por-atender' }
  const file = new FormData()
  file.append('filedata', new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'test.pdf')
  const partial = await fetch(`${base}/api/documents/send-to-director`, { method: 'POST', headers, body: file })
  assert.equal(partial.status, 403)
  assert.equal((await partial.json()).emittedNodeId, 'pdf-node')
  assert.equal(calls.some(({ path }) => path.endsWith('/secondary-children')), false)
  failUpdate = false
  const retry = () => fetch(`${base}/api/documents/retry-director-delivery`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: 'pdf-node' }) })
  calls.length = 0
  const success = await retry()
  assert.equal(success.status, 201)
  const result = await success.json()
  assert.equal(result.emittedEntry.id, result.receivedEntry.id)
  assert.equal(calls.some(({ path }) => path.endsWith('/children')), false)
  associationConflict = true
  assert.equal((await retry()).status, 502, 'unverified conflict must not report success')
  matchingParent = true
  assert.equal((await retry()).status, 201, 'the exact existing association makes a retry idempotent')
  serviceCanRead = false
  calls.length = 0
  const deniedRead = await retry()
  assert.equal((await deniedRead.json()).error, 'DISTRIBUTION_SERVICE_DOCUMENT_ACCESS_FAILED')
  assert.equal(calls.some(({ path }) => path.endsWith('/secondary-children')), false)
  serviceCanRead = true
  serviceCanAssociate = false
  const deniedAssociation = await retry()
  const deniedPayload = await deniedAssociation.json()
  assert.equal(deniedPayload.error, 'DIRECTOR_MULTIFILING_PERMISSION_REQUIRED')
  assert.equal(deniedPayload.emittedNodeId, 'pdf-node')
  serviceCanAssociate = true
  creator = 'someone-else'
  calls.length = 0
  assert.equal((await retry()).status, 403)
  assert.equal(calls.some(({ method }) => method !== 'GET'), false)
  const csrf = await fetch(`${base}/api/documents/retry-director-delivery`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: 'pdf-node' }) })
  assert.equal(csrf.status, 403)
  assert.equal((await fetch(`${base}/api/documents/retry-director-delivery`, { method: 'POST' })).status, 401)
  // Exercise both institutional directions and both inbox categories using mapped destinations.
  creator = 'sender'
  associationConflict = false
  const reverseSession = createSession({ authorizationStatus: 'active', functionalRole: 'direccion', capabilities: ['documents:write'], dependency: 'DSA', alfresco: { id: 'sender' }, authorization: 'Basic test-ticket' })
  const reverseSignature = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(reverseSession.id).digest('base64url')
  for (const [source, destination, category, destinationFolder] of [
    ['DTI', 'DSA', 'por-atender', 'received-folder'],
    ['DTI', 'DSA', 'por-conocimiento', 'dsa-knowledge'],
    ['DSA', 'DTI', 'por-atender', 'dti-attention'],
    ['DSA', 'DTI', 'por-conocimiento', 'dti-knowledge'],
  ]) {
    emittedFolder = source === 'DTI' ? 'emitted-folder' : 'dsa-emitted'
    receivedFolder = destinationFolder
    permissions = { isInheritanceEnabled: true }
    calls.length = 0
    const sent = await fetch(`${base}/api/documents/send-to-director`, {
      method: 'POST', body: file,
      headers: { ...headers, 'X-UAC-Recipient-Dependency': destination, 'X-UAC-Receipt-Category': category,
        ...(source === 'DSA' ? { Cookie: `gd_session=${reverseSession.id}.${reverseSignature}`, 'X-CSRF-Token': reverseSession.csrfToken } : {}) },
    })
    assert.equal(sent.status, 201, `${source} to ${destination}, ${category}`)
    assert.equal(calls.filter(({ path }) => path.endsWith('/children')).length, 1)
    assert.ok(calls.some(({ path }) => path.endsWith(`/${destinationFolder}/secondary-children`)))
    const delivered = await sent.json()
    assert.equal(delivered.emittedEntry.id, delivered.receivedEntry.id)
  }
  const { invalidateDistributionAuthorization } = await import('./distributionService.js')
  invalidateDistributionAuthorization()
  serviceCanAuthenticate = false
  calls.length = 0
  const noService = await fetch(`${base}/api/documents/send-to-director`, { method: 'POST', headers, body: file })
  assert.equal(noService.status, 503)
  assert.equal((await noService.json()).error, 'DISTRIBUTION_SERVICE_AUTH_FAILED')
  assert.equal(calls.some(({ path }) => path.endsWith('/children')), false, 'authentication failure must not leave a new PDF')
})
