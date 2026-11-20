import { identityResponse } from './testFixtures/institutionalIdentity.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

test('provisional organization requires Direction and CSRF but never authorizes hierarchical dispatch', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hierarchy-http-'))
  Object.assign(process.env, {
    PORT: '0', SESSION_SECRET: 'hierarchy-fixture', ALFRESCO_TARGET: 'https://hierarchy.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'fixture', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    DISPATCH_PERSISTENCE: 'local', DISPATCH_ALFRESCO_WRITES_ENABLED: 'false', OFFICIAL_EMISSION_WRITES_ENABLED: 'false',
    ORGANIZATION_STORE_PATH: path.join(temporary, 'organization.json'), DISPATCH_STORE_PATH: path.join(temporary, 'dispatches.json'),
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'directory', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'fixture-password',
    ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({ dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' }, functions: { direccion: 'GROUP_DIR', 'jefe-unidad': 'GROUP_HEAD', especialista: 'GROUP_STAFF' } }),
  })
  const groups = { DSA: ['director', 'head', 'staff'], DTI: ['foreign'], DIR: ['director'], HEAD: ['head'], STAFF: ['staff', 'foreign'] }
  const realFetch = globalThis.fetch
  const actors = new Map()
  const calls = []
  const creations = []
  let identityUnavailable = false
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.hostname === '127.0.0.1') return realFetch(url, options)
    assert.equal(parsed.hostname, 'hierarchy.invalid')
    if (identityUnavailable && parsed.pathname.endsWith('/people/-me-')) return Response.json({}, { status: 503 })
    if (parsed.pathname.endsWith('/nodes/upload-folder/children') && options.method === 'POST') {
      assert.ok(options.body instanceof FormData, 'the backend reconstructs the multipart body')
      creations.push([...options.body.keys()])
      return Response.json({ entry: { id: 'new-pdf' } }, { status: 201 })
    }
    assert.equal(options.method || 'GET', 'GET', 'no Alfresco writes')
    const identity = identityResponse(url, options, actors, config.groupMappings)
    if (identity) return identity
    if (parsed.pathname.endsWith('/nodes/upload-folder')) return Response.json({ entry: { id: 'upload-folder', isFolder: true, allowableOperations: ['create'] } })
    calls.push(parsed.pathname)
    const group = parsed.pathname.match(/\/groups\/([^/]+)\/children$/)?.[1]
    if (group) return Response.json({ data: groups[group].map((shortName) => ({ shortName, authorityType: 'USER' })), paging: { skipCount: 0, totalItems: groups[group].length } })
    const id = decodeURIComponent(parsed.pathname.split('/').at(-1))
    return Response.json({ entry: { id: id === '-me-' ? 'directory' : id, enabled: true } })
  }
  const { server } = await import('./index.js')
  const { config } = await import('./config.js')
  const { createSession } = await import('./sessionStore.js')
  if (!server.listening) await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    globalThis.fetch = realFetch
    fs.rmSync(temporary, { recursive: true, force: true })
  })
  const headers = (id, functionalRole, dependency = 'DSA') => {
    actors.set(`Basic ${id}-fixture`, { id, functionalRole, dependency })
    const session = createSession({ authorization: `Basic ${id}-fixture`, alfresco: { id }, functionalRole, dependency, authorizationStatus: 'active', capabilities: ['documents:read', 'documents:write'] })
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(session.id).digest('base64url')
    return { Cookie: `gd_session=${session.id}.${signature}`, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }
  }
  const base = `http://127.0.0.1:${server.address().port}`
  const director = headers('director', 'direccion'), head = headers('head', 'jefe-unidad')
  const assignments = [{ laneId: 'jefes', userId: 'head' }, { laneId: 'especialistas', userId: 'staff', unitHeadUserId: 'head' }]
  const put = (auth, values) => realFetch(`${base}/api/hierarchy`, { method: 'PUT', headers: auth, body: JSON.stringify({ assignments: values, dependency: 'DTI' }) })
  assert.equal((await realFetch(`${base}/api/hierarchy`)).status, 401)
  assert.equal((await realFetch(`${base}/api/hierarchy`, { headers: head })).status, 403)
  assert.equal((await realFetch(`${base}/api/hierarchy`, { headers: headers('staff', 'especialista') })).status, 403)
  assert.equal((await put({ ...director, 'X-CSRF-Token': 'invalid' }, assignments)).status, 403)
  assert.equal((await put(director, [...assignments, { laneId: 'especialistas', userId: 'foreign' }])).status, 400)
  assert.equal((await put(director, [{ laneId: 'especialistas', userId: 'staff', unitHeadUserId: 'foreign' }])).status, 400)
  assert.equal((await put(director, assignments)).status, 200)
  const saved = await (await realFetch(`${base}/api/hierarchy`, { headers: director })).json()
  assert.equal(saved.dependency, 'dsa')
  assert.equal(saved.assignments[1].unitHeadUserId, 'head')
  assert.ok(saved.assignments.every((a) => a.dependency === 'dsa' && a.updatedBy === 'director'))
  assert.equal(JSON.parse(fs.readFileSync(config.organizationStorePath, 'utf8')).audit.length, 1)
  assert.deepEqual((await (await realFetch(`${base}/api/hierarchy`, { headers: headers('dti', 'direccion', 'DTI') })).json()).assignments, [])
  const recipients = await realFetch(`${base}/api/directory/dispatch-recipients`, { headers: head })
  assert.equal(recipients.status, 503)
  assert.equal((await recipients.json()).error, 'ORGANIZATIONAL_HIERARCHY_PENDING')
  const dispatch = await realFetch(`${base}/api/documents/dispatch`, { method: 'POST', headers: head, body: JSON.stringify({ documentId: 'pdf', recipientUserIds: ['staff'], instruction: 'test', priority: 'Normal', requestKey: 'fixture', originAssignmentId: 'assignment' }) })
  assert.equal(dispatch.status, 503)
  assert.equal((await dispatch.json()).error, 'ORGANIZATIONAL_HIERARCHY_PENDING')
  assert.ok(calls.length > 0)

  const original = fs.readFileSync(config.organizationStorePath, 'utf8')
  const actor = actors.get('Basic director-fixture')
  actor.groups = ['GROUP_DSA', 'GROUP_STAFF']
  assert.equal((await put(director, assignments)).status, 403, 'role revoked after login')
  actor.groups = undefined; actor.enabled = false
  assert.equal((await put(director, assignments)).status, 403, 'disabled actor')
  actor.enabled = true; identityUnavailable = true
  assert.equal((await put(director, assignments)).status, 503, 'unavailable Alfresco fails closed')
  assert.equal(fs.readFileSync(config.organizationStorePath, 'utf8'), original, 'no rejected operation changes the organigram')
  identityUnavailable = false
  config.userInboxNodeIds = { staff: 'upload-folder', forbidden: 'dsa-emitted' }
  config.officeInboxNodeIds = { DSA: { emitidos: 'dsa-emitted' } }
  const form = (reserved) => {
    const value = new FormData()
    value.set('filedata', new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'fixture.pdf')
    value.set('cm:title', 'Legitimate title')
    if (reserved) value.set(reserved, '{}')
    return value
  }
  const uploadHeaders = { ...director, 'X-UAC-Recipient-User': 'staff', 'X-UAC-Recipient-Dependency': 'dsa', 'X-UAC-Recipient-Role': 'especialista' }
  delete uploadHeaders['Content-Type']
  const uploadUrl = `${base}/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/upload-folder/children`
  for (const reserved of ['gd:asignaciones', 'gd:responsablesActuales', 'aspectNames', 'permissions', 'properties', 'cm:author', 'gd:identidadEmision']) {
    assert.equal((await realFetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: form(reserved) })).status, 403)
  }
  assert.equal(creations.length, 0)
  actor.enabled = false
  assert.equal((await realFetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: form() })).status, 403)
  actor.enabled = true
  assert.equal((await realFetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: form() })).status, 201)
  assert.deepEqual(creations[0], ['filedata', 'name', 'nodeType', 'cm:title'])
  assert.equal((await realFetch(uploadUrl.replace('upload-folder', 'dsa-emitted'), { method: 'POST', headers: { ...uploadHeaders, 'X-UAC-Recipient-User': 'forbidden' }, body: form() })).status, 403, 'generic upload never bypasses official Emitidos, even when the flag is disabled')
})
