import { identityResponse } from './testFixtures/institutionalIdentity.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { attentionFixture, originalId, responseId } from './testFixtures/attention.js'

test('HTTP attention, existing institutional emission, verified response relation, and historical read authorization', async (t) => {
  const f = attentionFixture()
  const root = await f.seed()
  const { config } = await import('./config.js')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'attention-http-'))
  Object.assign(config, f.settings, { port: 0, sessionSecret: 'attention-test-only' })
  config.dispatchPilot.leasePath = path.join(temporary, 'pilot.lock')
  const originalFetch = globalThis.fetch
  const actors = new Map()
  let base
  globalThis.fetch = (url, options) => String(url).startsWith(base + '/') ? originalFetch(url, options) : identityResponse(url, options, actors, config.groupMappings) || f.fetchImpl(url, options)
  const { server } = await import('./index.js')
  const { createSession } = await import('./sessionStore.js')
  if (!server.listening) await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(temporary, { recursive: true, force: true })
  })
  const session = (id, role) => {
    actors.set(`Basic actor-${id}`, { id, functionalRole: role, dependency: 'DSA' })
    const value = createSession({ alfresco: { id }, authorization: `Basic actor-${id}`, functionalRole: role, dependency: 'DSA',
      authorizationStatus: 'active', capabilities: ['documents:read', 'documents:write'] })
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(value.id).digest('base64url')
    return { Cookie: `gd_session=${value.id}.${signature}`, 'X-CSRF-Token': value.csrfToken, 'Content-Type': 'application/json' }
  }
  const director = session('director', 'direccion')
  const head = session('head', 'jefe-unidad')
  const staff = session('staff', 'especialista')
  const proposalUrl = base + `/api/documents/response-proposals?documentId=${originalId}`
  const emptyProposals = await fetch(proposalUrl, { headers: director })
  assert.equal(emptyProposals.status, 200)
  assert.equal(emptyProposals.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await emptyProposals.json(), { proposals: [], persistence: 'alfresco', writesEnabled: false })
  assert.equal((await fetch(base + `/api/documents/proposal-version-content?documentId=${originalId}&processId=forged&versionId=1.0`, { headers: director })).status, 403)
  f.state.denyActor = true
  assert.equal((await fetch(proposalUrl, { headers: director })).status, 403)
  f.state.denyActor = false
  actors.get('Basic actor-director').enabled = false
  assert.equal((await fetch(proposalUrl, { headers: director })).status, 403)
  actors.get('Basic actor-director').enabled = true
  const post = (endpoint, headers, body) => fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  const input = { documentId: originalId, assignmentId: root.recipients[1].id, requestKey: 'staff-attended', responseDocumentId: null }
  assert.equal((await post('/api/documents/assignments/attend', head, input)).status, 403)
  const done = await post('/api/documents/assignments/attend', staff, input)
  assert.equal(done.status, 200)
  assert.equal((await done.json()).assignment.status, 'ATENDIDO')
  assert.equal((await post('/api/documents/assignments/attend', staff, input)).status, 200)
  const history = await fetch(base + '/api/documents/dispatches?include=documents', { headers: staff })
  assert.equal(history.status, 200)
  assert.equal((await history.json()).documents[0].id, originalId, 'own attended history retains actor-ACL-authorized PDF read')
  f.state.denyActor = true
  assert.equal((await fetch(base + `/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/${originalId}/content`, { headers: staff })).status, 403)
  f.state.denyActor = false
  const staffCandidates = await fetch(base + '/api/documents/response-candidates', { headers: staff })
  assert.equal(staffCandidates.status, 200)
  assert.deepEqual((await staffCandidates.json()).documents, [])
  // Fixture represents Dirección already having an own obligation; the dispatch API still cannot target Dirección.
  const own = f.seedDirectionOwnAssignment()
  // Link an already emitted institutional PDF. New creation is covered by the
  // official-emission suite; the legacy route must no longer issue new records.
  f.addResponse()
  assert.notEqual(responseId, originalId)
  const linkInput = { documentId: originalId, assignmentId: own.id, requestKey: 'response-link-http', responseDocumentId: responseId }
  const linked = await post('/api/documents/assignments/response', director, linkInput)
  assert.equal(linked.status, 200, JSON.stringify(await linked.clone().json()))
  assert.equal((await linked.json()).assignment.status, 'ASIGNADO', 'emission and linkage do not complete the original obligation')
  const related = await fetch(base + `/api/documents/assignment-responses?documentId=${originalId}`, { headers: director })
  const bundle = await related.json()
  assert.equal(bundle.documentIdentity.originalDependency, 'DTI')
  assert.equal(bundle.responses[0].emitterDependency, 'dsa')
  assert.equal(bundle.responses[0].available, true)
  const originals = await fetch(base + `/api/documents/assignment-responses?documentId=${responseId}&direction=originals`, { headers: director })
  assert.equal(originals.status, 200)
  assert.equal((await originals.json()).originals[0].originalDocumentId, originalId)
  assert.equal((await fetch(base + `/api/documents/assignment-responses?documentId=${responseId}&direction=annex`, { headers: director })).status, 400)
  const content = await fetch(base + `/api/documents/response-content?documentId=${originalId}&responseDocumentId=${responseId}`, { headers: director })
  assert.equal(content.status, 200)
  assert.equal((await fetch(base + `/api/documents/response-content?documentId=${originalId}&responseDocumentId=arbitrary-uuid`, { headers: director })).status, 403)
  assert.equal((await post('/api/documents/assignments/attend', director, { ...linkInput, requestKey: 'response-attention-http' })).status, 200)
  assert.equal(f.envelope().dispatches[0].recipients[0].status, 'ATENDIDO')
  assert.equal(f.nodes.get(originalId).properties['gd:estado'], 'unchanged')
  const current = f.nodes.get(originalId).properties['gd:asignaciones']
  actors.get('Basic actor-staff').enabled = false
  const disabled = await post('/api/documents/assignments/attend', staff, { ...input, requestKey: 'disabled-after-login' })
  assert.equal(disabled.status, 403)
  assert.equal((await disabled.json()).error, 'INSTITUTIONAL_IDENTITY_REJECTED')
  assert.equal(f.nodes.get(originalId).properties['gd:asignaciones'], current)
})
