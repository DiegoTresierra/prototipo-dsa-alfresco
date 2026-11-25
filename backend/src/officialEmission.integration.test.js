import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { officialFixture } from './testFixtures/officialEmission.js'

test('Express official endpoint parses actual multipart, enforces CSRF/role and never trusts client scope or number', async (t) => {
  const f = officialFixture(t)
  f.service.release() // HTTP backend acquires its own lease on the same controlled fixture.
  Object.assign(process.env, { PORT: '0', SESSION_SECRET: 'test-only', ALFRESCO_TARGET: 'https://official.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'test', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback' })
  const { config } = await import('./config.js')
  Object.assign(config, f.settings, { dispatchPilot: { ...f.settings.dispatchPilot, leasePath: f.settings.officialEmission.leasePath + '.dispatch' }, port: 0 })
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, options) => new URL(url).hostname === 'official.invalid' ? f.fetch(url, options) : realFetch(url, options)
  const { server } = await import('./index.js')
  if (!server.listening) await once(server, 'listening')
  f.beforeCleanup(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); globalThis.fetch = realFetch })
  const { createSession } = await import('./sessionStore.js')
  const headers = (role = 'direccion') => {
    const session = createSession({ ...f.session(), functionalRole: role })
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(session.id).digest('base64url')
    return { Cookie: `gd_session=${session.id}.${signature}`, 'X-CSRF-Token': session.csrfToken }
  }
  const url = `http://127.0.0.1:${server.address().port}/api/documents/official-emissions`
  const makeForm = (extra) => {
    const input = f.input('http-request')
    const form = new FormData()
    form.set('filedata', new Blob([input.file], { type: 'application/pdf' }), 'original.pdf')
    for (const key of ['requestKey', 'title', 'description', 'documentType', 'documentPeriod', 'priority', 'recipientDependency', 'receiptCategory']) form.set(key, input[key])
    if (extra) form.set(extra, 'forged')
    return form
  }
  assert.equal((await realFetch(url, { method: 'POST', body: makeForm() })).status, 401)
  const authenticated = headers()
  assert.equal((await realFetch(url, { method: 'POST', headers: { Cookie: authenticated.Cookie }, body: makeForm() })).status, 403)
  for (const role of ['jefe-unidad', 'especialista']) assert.equal((await realFetch(url, { method: 'POST', headers: headers(role), body: makeForm() })).status, 403)
  for (const key of ['documentCode', 'gd:numero', 'cycle', 'folderId', 'role']) assert.equal((await realFetch(url, { method: 'POST', headers: authenticated, body: makeForm(key) })).status, 400)
  const first = await realFetch(url, { method: 'POST', headers: authenticated, body: makeForm() })
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()))
  const result = await first.json()
  assert.equal(result.emittedEntry.properties['gd:numero'], '1')
  const repeat = await realFetch(url, { method: 'POST', headers: authenticated, body: makeForm() })
  assert.equal(repeat.status, 201)
  assert.equal((await repeat.json()).emittedEntry.id, result.emittedEntry.id)
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/children')).length, 1)
  const legacy = await realFetch(url.replace('official-emissions', 'send-to-director'), { method: 'POST', headers: authenticated, body: makeForm() })
  assert.equal(legacy.status, 403)
  assert.equal((await legacy.json()).error, 'OFFICIAL_EMISSION_ENDPOINT_REQUIRED')
  assert.ok(f.calls.every((call) => !['PUT', 'PATCH', 'DELETE'].includes(call.method)))
  f.conditions.noNodeRecipientRead = true
  const partialForm = () => { const form = makeForm(); form.set('requestKey', 'partial-node-read'); return form }
  const partial = await realFetch(url, { method: 'POST', headers: authenticated, body: partialForm() })
  assert.equal(partial.status, 409)
  const problem = await partial.json()
  assert.equal(problem.error, 'OFFICIAL_RECIPIENT_NODE_READ_REQUIRED')
  assert.equal(problem.emittedNodeId, 'pdf-2')
  assert.equal(problem.uncertain, true)
  f.nodes.get('pdf-2').permissions = { isInheritanceEnabled: true, locallySet: [{ authorityId: 'GROUP_DTI', name: 'Consumer', accessStatus: 'ALLOWED' }] }
  const recovered = await realFetch(url, { method: 'POST', headers: authenticated, body: partialForm() })
  assert.equal(recovered.status, 201)
  assert.equal((await recovered.json()).emittedEntry.id, 'pdf-2')
  assert.equal(f.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/children')).length, 2)
})
