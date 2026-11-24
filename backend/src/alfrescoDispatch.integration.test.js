import { identityResponse } from './testFixtures/institutionalIdentity.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

test('HTTP Alfresco pilot authorizes secondary membership, persists all readers, and rejects forged scope/ACL/roles', async (t) => {
  process.env.ALFRESCO_HIERARCHY_STORAGE = '' // Provider absence is an explicit fixture, independent of private DEV configuration.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alfresco-dispatch-http-'))
  const documentId = '11111111-2222-4333-8444-2a29efcb482b'
  const foreignId = '00000000-0000-0000-0000-000000000001'
  const secondId = '00000000-0000-0000-0000-000000000002'
  const additionalId = '00000000-0000-0000-0000-000000000003'
  const localPath = path.join(directory, 'dispatches.json')
  fs.writeFileSync(localPath, 'legacy data must never be read or changed')
  Object.assign(process.env, {
    PORT: '0', SESSION_SECRET: 'test-only', ALFRESCO_TARGET: 'https://alfresco.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'test', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'gd_distribucion', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'test-only',
    ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({ dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' },
      functions: { direccion: 'GROUP_DIRECTORS', 'jefe-unidad': 'GROUP_HEADS', especialista: 'GROUP_STAFF' } }),
    ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON: JSON.stringify({ DSA: { porAtender: 'dsa-folder' }, DTI: { emitidos: 'dti-folder' } }),
    DISPATCH_PERSISTENCE: 'alfresco', DISPATCH_ALFRESCO_WRITES_ENABLED: 'true',
    DISPATCH_PILOT_ENVIRONMENT: 'dev',
    DISPATCH_PILOT_ACK: 'single-instance-exclusive-writer-dev-institutional-documents',
    DISPATCH_PILOT_ALFRESCO_TARGET: 'https://alfresco.invalid',
    DISPATCH_PILOT_LEASE_PATH: path.join(directory, 'pilot.lock'), DISPATCH_STORE_PATH: localPath,
  })
  const originalFetch = globalThis.fetch
  const { server } = await import('./index.js')
  const { config } = await import('./config.js')
  const { createSession } = await import('./sessionStore.js')
  if (!server.listening) await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const actors = new Map()
  const session = (id, role, dependency = 'DSA') => {
    actors.set(`Basic ${id}`, { id, functionalRole: role, dependency })
    const value = createSession({ alfresco: { id }, authorization: `Basic ${id}`, authorizationStatus: 'active', functionalRole: role,
      dependency, capabilities: ['documents:read', 'documents:write'] })
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(value.id).digest('base64url')
    return { Cookie: `gd_session=${value.id}.${signature}`, 'X-CSRF-Token': value.csrfToken, 'Content-Type': 'application/json' }
  }
  const director = session('DSA_T', 'direccion')
  const director2 = session('director-2', 'direccion')
  const directorDti = session('DTI_T', 'direccion', 'DTI')
  const head = session('head', 'jefe-unidad')
  const staff = session('staff', 'especialista')
  const node = { id: documentId, nodeType: 'cm:content', isFile: true, content: { mimeType: 'application/pdf' }, parentId: 'dti-folder',
    aspectNames: ['cm:versionable'], allowableOperations: ['update'], properties: { 'gd:estado': 'preserve' } }
  const secondNode = { ...structuredClone(node), id: secondId }
  const additionalNode = { ...structuredClone(node), id: additionalId }
  const nodes = new Map([[documentId, node], [secondId, secondNode], [additionalId, additionalNode]])
  let denied = false
  let updateDenied = false
  let modelReady = true
  let originalInInstitutionalScope = true
  const puts = []
  const readOnlyNodes = []
  const reads = []
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.origin === base) return originalFetch(url, options)
    assert.equal(parsed.hostname, 'alfresco.invalid', 'never call real DEV')
    const identity = identityResponse(url, options, actors, config.groupMappings)
    if (identity) return identity
    const p = parsed.pathname
    const method = options.method || 'GET'
    if (method === 'GET') reads.push(p)
    assert.ok(['GET', 'PUT'].includes(method))
    if (p.endsWith('/people/-me-')) return Response.json({ entry: { id: 'gd_distribucion', enabled: true, capabilities: { isAdmin: false } } })
    if (p.includes('/service/api/groups/')) {
      const group = p.split('/').at(-2)
      const members = { DSA: ['DSA_T', 'director-2', 'head', 'head-2', 'staff'], DTI: ['DTI_T', 'staff-dti'],
        DIRECTORS: ['DSA_T', 'director-2', 'DTI_T'], HEADS: ['head', 'head-2'], STAFF: ['staff', 'staff-dti'] }[group]
      return Response.json({ data: members.map((shortName) => ({ shortName, authorityType: 'USER' })), paging: { skipCount: 0, totalItems: members.length } })
    }
    if (p.includes('/people/')) return Response.json({ entry: { id: p.split('/').at(-1), enabled: true } })
    if (p.endsWith('/classes/gd_tramite')) return Response.json({ properties: modelReady ? {
      'gd:asignaciones': { dataType: 'd:text', multiValued: false, indexed: false },
      'gd:responsablesActuales': { dataType: 'd:text', multiValued: true },
      'gd:dependenciasResponsablesActuales': { dataType: 'd:text', multiValued: true },
    } : {} })
    if (p.endsWith('/children')) {
      assert.ok(['dsa-folder', 'dti-folder', 'knowledge-folder'].includes(p.split('/').at(-2)), 'only institutional folders are consulted')
      const entries = (p.includes('/knowledge-folder/') ? readOnlyNodes.filter((n) => n.id === 'knowledge-readonly') :
        [...(originalInInstitutionalScope ? [node, secondNode, additionalNode] : [secondNode, additionalNode]), ...readOnlyNodes])
        .map((entry) => ({ entry: { ...entry, association: { assocType: 'cm:contains', isPrimary: false } } }))
      return Response.json({ list: { entries, pagination: { hasMoreItems: false } } })
    }
    if (p.endsWith('/parents')) return Response.json({}, { status: 403 })
    const id = p.endsWith('/content') ? p.split('/').at(-2) : p.split('/').at(-1)
    if (denied && options.headers.Authorization === 'Basic DSA_T') return Response.json({}, { status: 403 })
    if (method === 'PUT') {
      if (updateDenied) return Response.json({}, { status: 403 })
      assert.ok([documentId, secondId, additionalId].includes(id), 'PUT only mocked institutional PDFs')
      const body = JSON.parse(options.body)
      assert.equal(options.headers.Authorization, 'Basic '+Buffer.from('gd_distribucion:test-only').toString('base64'))
      puts.push(body)
      const target = nodes.get(id)
      Object.assign(target.properties, body.properties)
      if (body.aspectNames) target.aspectNames = body.aspectNames
    }
    if (p.endsWith('/content')) return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
    return Response.json({ entry: nodes.get(id) || { ...node, id, parentId: 'foreign', properties: {}, aspectNames: [] } })
  }
  const post = (headers, body) => fetch(`${base}/api/documents/dispatch`, { method: 'POST', headers, body: JSON.stringify(body) })
  const payload = { documentId, recipientUserIds: ['head', 'head-2'], instruction: 'Atender', priority: 'Normal', requestKey: 'first', originAssignmentId: null }
  modelReady = false
  assert.equal((await post(director, payload)).status, 503)
  modelReady = true
  denied = true
  assert.equal((await post(director, payload)).status, 403)
  denied = false
  updateDenied = true
  assert.equal((await post(director, payload)).status, 403)
  updateDenied = false
  const firstResponse = await post(director, payload)
  assert.equal(firstResponse.status, 201)
  const parent = (await firstResponse.json()).dispatch
  assert.equal(parent.recipients.length, 2)
  assert.equal((await post(director, payload)).status, 200)
  assert.equal(puts.length, 1)
  const secondResponse = await post(director, { ...payload, documentId: secondId, requestKey: 'second-pdf', recipientUserIds: ['head'] })
  assert.equal(secondResponse.status, 201, 'second PDF is authorized by folders without a UUID registration')
  assert.equal((await secondResponse.json()).persistence, 'alfresco')
  assert.equal(JSON.parse(secondNode.properties['gd:asignaciones']).documentId, secondId)
  const additionalResponse = await post(director, { ...payload, documentId: additionalId, requestKey: 'additional-institutional-document' })
  assert.equal(additionalResponse.status, 201, 'any authorized institutional PDF is in scope without a separate test-folder association')
  assert.equal(JSON.parse(additionalNode.properties['gd:asignaciones']).documentId, additionalId)
  assert.equal((await post(director, { ...payload, documentId: foreignId, requestKey: 'foreign', dependency: 'DSA', folderId: 'dsa-folder' })).status, 403)
  assert.equal((await post(head, { ...payload, recipientUserIds: ['staff'], requestKey: 'hierarchy-unconfigured' })).status, 503)
  config.organizationalHierarchyProvider = {
    async resolveSpecialists() {
      return { verified: true, members: [{ userId: 'staff', groupIds: ['GROUP_fixture_supervision'] }] }
    },
  }
  t.after(() => { delete config.organizationalHierarchyProvider })
  assert.equal((await post(head, { ...payload, recipientUserIds: ['staff'], requestKey: 'no-origin' })).status, 403)
  assert.equal((await post(staff, { ...payload, recipientUserIds: ['head'] })).status, 403)
  const derived = await post(head, { ...payload, recipientUserIds: ['staff'], requestKey: 'child', originAssignmentId: parent.recipients[0].id })
  assert.equal(derived.status, 201)
  const concurrent = await Promise.all([
    post(director, { ...payload, requestKey: 'parallel-a' }), post(director2, { ...payload, requestKey: 'parallel-b' }),
  ])
  assert.deepEqual(concurrent.map((response) => response.status), [201, 201])
  assert.equal((await post(directorDti, { ...payload, recipientUserIds: ['staff-dti'], requestKey: 'dti' })).status, 201)
  const envelope = JSON.parse(node.properties['gd:asignaciones'])
  assert.equal(envelope.dispatches.length, 5)
  assert.equal(envelope.dispatches[0].recipients[0].status, 'ASIGNADO')
  assert.ok(envelope.dispatches.every((record) => record.documentId === documentId))
  assert.equal(node.properties['gd:estado'], 'preserve')
  for (let page = 0; page < 2; page++) {
    reads.length = 0
    const response = await fetch(`${base}/api/documents/dispatches?include=documents`, { headers: staff })
    assert.equal(response.status, 200)
    const inbox = await response.json()
    assert.equal(inbox.persistence, 'alfresco')
    assert.equal(inbox.dispatches.length, 1)
    assert.equal(inbox.documents[0].id, documentId)
    assert.equal(reads.filter((path) => path.endsWith('/children')).length, 2, 'one snapshot for received/sent/authorization')
    assert.equal(reads.filter((path) => /\/nodes\/[^/]+$/.test(path)).length, 0, 'actor child properties avoid N+1 and policy rescan')
  }
  const content = await fetch(`${base}/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/${documentId}/content`, { headers: staff })
  assert.equal(content.status, 200)
  const completedPuts = puts.length
  originalInInstitutionalScope = false
  const removedOrigin = await post(head, { ...payload, recipientUserIds: ['staff'], requestKey: 'removed-from-institutional-scope', originAssignmentId: parent.recipients[0].id })
  assert.equal(removedOrigin.status, 403, 'an assigned Jefatura still needs verified institutional membership')
  assert.equal((await post(director, payload)).status, 403, 'retry must revalidate scope too')
  assert.equal(puts.length, completedPuts)
  assert.equal(fs.readFileSync(localPath, 'utf8'), 'legacy data must never be read or changed')
  originalInInstitutionalScope = true
  const current = node.properties['gd:asignaciones']
  actors.get('Basic DSA_T').groups = ['GROUP_DSA', 'GROUP_STAFF']
  const revoked = await post(director, { ...payload, requestKey: 'revoked-director' })
  assert.equal(revoked.status, 403)
  assert.equal((await revoked.json()).error, 'INSTITUTIONAL_IDENTITY_REJECTED')
  assert.equal(node.properties['gd:asignaciones'], current)
  assert.equal(puts.length, completedPuts, 'a stale Direction session never invokes the technical PUT')
  config.officeInboxNodeIds.DSA.porConocimiento = 'knowledge-folder'
  for (const [id, creator] of [['own-readonly', 'head'], ['knowledge-readonly', 'foreign'], ['unassigned-attention', 'foreign']]) {
    const unassigned = { ...structuredClone(node), id, parentId: 'dti-folder', createdByUser: { id: creator }, properties: {}, aspectNames: [] }
    readOnlyNodes.push(unassigned); nodes.set(id, unassigned)
  }
  const institutional = await (await fetch(`${base}/api/documents/dispatches?include=documents`, { headers: head })).json()
  assert.ok(institutional.documents.some((n) => n.id === 'own-readonly'))
  assert.ok(institutional.documents.some((n) => n.id === 'knowledge-readonly'))
  assert.ok(!institutional.documents.some((n) => n.id === 'unassigned-attention'))
  assert.ok(!institutional.dispatches.some((record) => record.documentId === 'knowledge-readonly'))
  const knowledgeRead = await fetch(`${base}/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/knowledge-readonly/content`, { headers: head })
  assert.equal(knowledgeRead.status, 200, 'knowledge secondary membership remains verifiable even when /parents is forbidden')
})
