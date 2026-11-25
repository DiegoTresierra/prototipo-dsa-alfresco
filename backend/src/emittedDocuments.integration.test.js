import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { emittedFixture } from './testFixtures/emitted.js'

test('GET emitted endpoint enforces session and dependency, rejects client scope and forwards the real actor ACL', async (t) => {
  Object.assign(process.env, { PORT: '0', SESSION_SECRET: 'emitted-fixture', ALFRESCO_TARGET: 'https://emitted.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'test', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    DISPATCH_PERSISTENCE: 'alfresco', DISPATCH_ALFRESCO_WRITES_ENABLED: 'false', OFFICIAL_EMISSION_WRITES_ENABLED: 'false' })
  const f = emittedFixture()
  const { config } = await import('./config.js')
  Object.assign(config, f.settings)
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, options) => new URL(url).hostname === 'emitted.invalid' ? f.fetch(url, options) : realFetch(url, options)
  const { server } = await import('./index.js')
  if (!server.listening) await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); globalThis.fetch = realFetch })
  const { createSession } = await import('./sessionStore.js')
  const cookie = (dependency, role = 'direccion') => {
    const session = createSession(f.session(dependency, role))
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(session.id).digest('base64url')
    return { Cookie: `gd_session=${session.id}.${signature}` }
  }
  const url = `http://127.0.0.1:${server.address().port}/api/documents/emitted`
  assert.equal((await realFetch(url)).status, 401)
  const staff = await realFetch(url, { headers: cookie('DSA', 'especialista') })
  assert.equal(staff.status, 200); assert.equal((await staff.json()).documents.length, 0)
  assert.equal((await realFetch(url + '?dependency=DTI', { headers: cookie('DSA') })).status, 400)
  const dti = await realFetch(url, { headers: cookie('DTI') })
  assert.equal(dti.status, 200)
  assert.equal(dti.headers.get('cache-control'), 'no-store')
  assert.equal((await dti.json()).documents.length, 3)
  const dsa = await realFetch(url, { headers: cookie('DSA') })
  assert.deepEqual((await dsa.json()).documents.map((n) => n.id), ['dsa-original'])
  f.denied.add('dsa-root')
  assert.equal((await realFetch(url, { headers: cookie('DSA') })).status, 403)
  assert.ok(f.calls.every((call) => call.method === 'GET'))
})
