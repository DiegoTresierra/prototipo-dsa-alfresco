import { sessionDispatchRoles } from '../../frontend/src/utils/sessionDispatch.js'
import { identityResponse } from './testFixtures/institutionalIdentity.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

test('HTTP Alfresco pilot persists verified DSA unit dispatches and preserves documentary scope, ACL and legacy flows', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alfresco-dispatch-http-'))
  const documentId = '11111111-2222-4333-8444-2a29efcb482b'
  const foreignId = '00000000-0000-0000-0000-000000000001'
  const secondId = '00000000-0000-0000-0000-000000000002'
  const additionalId = '00000000-0000-0000-0000-000000000003'
  const hierarchyContainer = '10000000-0000-4000-8000-000000000001'
  const auditContainer = '10000000-0000-4000-8000-000000000002'
  const unitId = '20000000-0000-4000-8000-000000000001'
  const otherUnitId = '20000000-0000-4000-8000-000000000002'
  const inactiveUnitId = '20000000-0000-4000-8000-000000000003'
  const foreignUnitId = '20000000-0000-4000-8000-000000000004'
  const localPath = path.join(directory, 'dispatches.json')
  fs.writeFileSync(localPath, 'legacy data must never be read or changed')
  Object.assign(process.env, {
    PORT: '0', SESSION_SECRET: 'test-only', ALFRESCO_TARGET: 'https://alfresco.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'test', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'fixture_distribution', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'test-only',
    HIERARCHY_READ_STORAGE: 'alfresco', ALFRESCO_HIERARCHY_STORAGE: 'alfresco',
    ALFRESCO_HIERARCHY_SERVICE_USERNAME: 'hierarchy-fixture', ALFRESCO_HIERARCHY_SERVICE_PASSWORD: 'fixture-only',
    ALFRESCO_HIERARCHY_CONTAINER_NODE_ID: hierarchyContainer, ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID: auditContainer,
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
  let base = ''
  const actors = new Map()
  const session = (id, role, dependency = 'DSA') => {
    actors.set(`Basic ${id}`, { id, functionalRole: role, dependency })
    const value = createSession({ alfresco: { id }, authorization: `Basic ${id}`, authorizationStatus: 'active', functionalRole: role,
      dependency, capabilities: ['documents:read', 'documents:write'] })
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(value.id).digest('base64url')
    return { Cookie: `gd_session=${value.id}.${signature}`, 'X-CSRF-Token': value.csrfToken, 'Content-Type': 'application/json' }
  }
  const makeUnit = (id, name, dependency, status = 'ACTIVA') => ({
    id, name, parentId: hierarchyContainer, nodeType: 'gdo:unidad', properties: {
      'gdo:nombreUnidad': name, 'gdo:codigoDependencia': dependency, 'gdo:estadoUnidad': status,
    },
  })
  const units = [
    makeUnit(unitId, 'Unidad DSA de prueba', 'DSA'), makeUnit(otherUnitId, 'Segunda unidad', 'DSA'),
    makeUnit(inactiveUnitId, 'Unidad inactiva', 'DSA', 'INACTIVA'), makeUnit(foreignUnitId, 'Unidad DTI', 'DTI'),
  ]
  const assignment = (id, unit, user, role) => ({
    id, name: id, parentId: unit, nodeType: 'gdo:asignacion', properties: {
      'gdo:idUsuario': user, 'gdo:idUnidad': unit, 'gdo:dependenciaAsignacion': 'DSA',
      'gdo:rolAsignacion': role, 'gdo:estadoAsignacion': 'ACTIVA', 'gdo:asignadoPor': 'fixture-director',
    },
  })
  const unitAssignments = [
    assignment('head-assignment', unitId, 'head', 'jefe-unidad'),
    assignment('staff-assignment', unitId, 'staff', 'especialista'),
    assignment('staff-peer-assignment', unitId, 'staff-peer', 'especialista'),
    assignment('other-head-assignment', otherUnitId, 'head-2', 'jefe-unidad'),
  ]
  const disabledPeople = new Set()
  const hierarchyAuthorization = 'Basic ' + Buffer.from('hierarchy-fixture-ticket').toString('base64')
  const list = (entries) => Response.json({ list: {
    entries: entries.map((entry) => ({ entry })), pagination: { hasMoreItems: false },
  } })
  let auditReadsBeforeChange = 0
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
    if (p.endsWith('/authentication/versions/1/tickets') && method === 'POST') {
      return Response.json({ entry: { id: 'hierarchy-fixture-ticket' } }, { status: 201 })
    }
    if (method === 'GET') reads.push(p)
    assert.ok(['GET', 'PUT'].includes(method))
    if (p.endsWith('/people/-me-')) return Response.json({ entry: {
      id: options.headers.Authorization === hierarchyAuthorization ? 'hierarchy-fixture' : 'fixture_distribution',
      enabled: true, capabilities: { isAdmin: false },
    } })
    if (options.headers.Authorization === hierarchyAuthorization && p.includes('/nodes/')) {
      assert.equal(method, 'GET', 'the hierarchy reader cannot write units or audit events')
      const id = p.split('/').at(-1)
      if (id === hierarchyContainer || id === auditContainer) return Response.json({ entry: {
        id, name: id === hierarchyContainer ? 'GD_JERARQUIAS' : 'GD_JERARQUIAS_AUDITORIA', nodeType: 'cm:folder', isFolder: true,
      } })
      const parentId = p.split('/').at(-2)
      assert.equal(id, 'children')
      if (parentId === hierarchyContainer) return list(units)
      if (parentId === auditContainer) {
        if (auditReadsBeforeChange > 0 && --auditReadsBeforeChange === 0) units[0].properties['gdo:codigoUnidad'] = 'CAMBIO'
        return list([])
      }
      assert.ok(units.some((unit) => unit.id === parentId))
      return list(unitAssignments.filter((item) => item.parentId === parentId))
    }
    if (p.includes('/service/api/groups/')) {
      const group = p.split('/').at(-2)
      const members = { DSA: ['fixture_director_a', 'director-2', 'head', 'head-2', 'staff', 'staff-peer', 'unassigned'], DTI: ['fixture_director_b', 'staff-dti'],
        DIRECTORS: ['fixture_director_a', 'director-2', 'fixture_director_b'], HEADS: ['head', 'head-2'], STAFF: ['staff', 'staff-peer', 'unassigned', 'staff-dti'] }[group]
      return Response.json({ data: members.map((shortName) => ({ shortName, authorityType: 'USER' })), paging: { skipCount: 0, totalItems: members.length } })
    }
    if (p.includes('/people/')) {
      const id = p.split('/').at(-1)
      return Response.json({ entry: { id, enabled: !disabledPeople.has(id) } })
    }
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
    if (denied && options.headers.Authorization === 'Basic fixture_director_a') return Response.json({}, { status: 403 })
    if (method === 'PUT') {
      if (updateDenied) return Response.json({}, { status: 403 })
      assert.ok([documentId, secondId, additionalId].includes(id), 'PUT only mocked institutional PDFs')
      const body = JSON.parse(options.body)
      assert.equal(options.headers.Authorization, 'Basic '+Buffer.from('fixture_distribution:test-only').toString('base64'))
      puts.push(body)
      const target = nodes.get(id)
      Object.assign(target.properties, body.properties)
      if (body.aspectNames) target.aspectNames = body.aspectNames
    }
    if (p.endsWith('/content')) return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
    return Response.json({ entry: nodes.get(id) || { ...node, id, parentId: 'foreign', properties: {}, aspectNames: [] } })
  }
  const { config } = await import('./config.js')
  const { createSession } = await import('./sessionStore.js')
  const { server } = await import('./index.js')
  if (!server.listening) await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const director = session('fixture_director_a', 'direccion')
  const director2 = session('director-2', 'direccion')
  const directorDti = session('fixture_director_b', 'direccion', 'DTI')
  const head = session('head', 'jefe-unidad')
  const staff = session('staff', 'especialista')
  const peer = session('staff-peer', 'especialista')
  const unassigned = session('unassigned', 'especialista')
  const post = (headers, body) => fetch(base + '/api/documents/dispatch', { method: 'POST', headers, body: JSON.stringify(body) })
  const sessionContract = async () => (await fetch(base + '/api/auth/me', { headers: director })).json()
  assert.deepEqual(sessionDispatchRoles(await sessionContract()), ['jefe-unidad', 'especialista'])
  assert.equal((await sessionContract()).officialWritesEnabled, false)
  const directoryResponse = await fetch(base + '/api/directory/dispatch-recipients', { headers: director })
  assert.equal(directoryResponse.status, 200, await directoryResponse.clone().text())
  const destinations = await directoryResponse.json()
  assert.equal(destinations.requiresUnit, true)
  assert.deepEqual(destinations.units.map((unit) => unit.id), [unitId, otherUnitId])
  assert.equal(destinations.units[0].head.id, 'head')
  assert.deepEqual(destinations.units[0].specialists.map((person) => person.id), ['staff', 'staff-peer'])
  assert.ok(!destinations.recipients.some((person) => person.id === 'unassigned'))
  const legacyPayload = { documentId, recipientUserIds: ['head', 'staff-peer'], instruction: 'Atender', priority: 'Normal', requestKey: 'first', originAssignmentId: null }
  const payload = { ...legacyPayload, unitId, hierarchyRevision: destinations.hierarchyRevision }
  const expectError = async (headers, input, status, code) => {
    const rejected = await post(headers, input)
    assert.equal(rejected.status, status, code)
    assert.equal((await rejected.json()).error, code)
  }
  await expectError(director, legacyPayload, 400, 'DISPATCH_UNIT_REQUIRED')
  await expectError(director, { ...payload, unitId: 'una-unidad-por-nombre' }, 400, 'DISPATCH_UNIT_REQUIRED')
  await expectError(director, { ...payload, hierarchyRevision: undefined }, 400, 'DISPATCH_HIERARCHY_REVISION_REQUIRED')
  await expectError(director, { ...payload, unitId: foreignUnitId, dependency: 'DTI' }, 403, 'DISPATCH_UNIT_NOT_ALLOWED')
  await expectError(director, { ...payload, unitId: inactiveUnitId }, 403, 'DISPATCH_UNIT_NOT_ALLOWED')
  await expectError(director, { ...payload, recipientUserIds: ['head', 'head-2'] }, 403, 'DISPATCH_UNIT_RECIPIENT_NOT_ALLOWED')
  await expectError(director, { ...payload, hierarchyRevision: 'f'.repeat(64) }, 409, 'DISPATCH_HIERARCHY_REVISION_CONFLICT')
  await expectError({ ...director, 'X-CSRF-Token': 'wrong' }, payload, 403, 'CSRF_VALIDATION_FAILED')
  disabledPeople.add('staff-peer')
  await expectError(director, payload, 409, 'DISPATCH_HIERARCHY_DATA_INVALID')
  disabledPeople.clear()
  unitAssignments.push(assignment('ambiguous-head-assignment', unitId, 'head-2', 'jefe-unidad'))
  await expectError(director, payload, 409, 'DISPATCH_HIERARCHY_DATA_INVALID')
  unitAssignments.pop()
  auditReadsBeforeChange = 3 // Start of the second directory read, after initial destination validation.
  await expectError(director, payload, 409, 'DISPATCH_HIERARCHY_REVISION_CONFLICT')
  assert.equal(auditReadsBeforeChange, 0)
  delete units[0].properties['gdo:codigoUnidad']
  config.dispatchPilot.writesEnabled = false
  assert.deepEqual(sessionDispatchRoles(await sessionContract()), [])
  await expectError(director, payload, 503, 'DISPATCH_ALFRESCO_WRITES_DISABLED')
  config.dispatchPilot.writesEnabled = true
  assert.equal(puts.length, 0, 'invalid or stale destinations do not mutate the PDF')
  modelReady = false
  assert.equal((await post(director, payload)).status, 503)
  modelReady = true
  denied = true
  assert.equal((await post(director, payload)).status, 403)
  denied = false
  updateDenied = true
  assert.equal((await post(director, payload)).status, 403)
  updateDenied = false
  const hierarchySnapshot = await fetch(base + '/api/hierarchy', { headers: director })
  assert.equal(hierarchySnapshot.status, 200)
  const administrativeCapabilities = (await hierarchySnapshot.json()).capabilities
  assert.equal(administrativeCapabilities.assignHeads, false)
  assert.equal(administrativeCapabilities.createUnits, false)
  const firstResponse = await post(director, payload)
  assert.equal(firstResponse.status, 201)
  const parent = (await firstResponse.json()).dispatch
  assert.equal(parent.recipients.length, 2)
  assert.equal(parent.unitId, unitId)
  assert.ok(parent.recipients.every((person) => person.unitId === unitId && person.unit.name === 'Unidad DSA de prueba'))
  assert.equal((await (await post(director, { ...payload, recipientUserIds: [...payload.recipientUserIds].reverse() })).json()).dispatch.id, parent.id)
  assert.equal((await post(director, payload)).status, 200)
  await expectError(director, { ...payload, unitId: otherUnitId }, 409, 'DISPATCH_REQUEST_CONFLICT')
  await expectError(director, { ...payload, recipientUserIds: ['head'] }, 409, 'DISPATCH_REQUEST_CONFLICT')
  assert.equal(puts.length, 1)
  const peerInbox = await fetch(base + '/api/documents/dispatches?include=documents', { headers: peer })
  assert.equal(peerInbox.status, 200)
  const peerAssignments = await peerInbox.json()
  assert.equal(peerAssignments.documents[0].id, documentId)
  assert.equal(peerAssignments.dispatches[0].recipients.find((person) => person.userId === 'staff-peer').unitId, unitId)
  const originalUrl = base + '/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/' + documentId + '/content'
  assert.equal((await fetch(originalUrl, { headers: peer })).status, 200)
  assert.equal((await fetch(originalUrl, { headers: unassigned })).status, 403)
  const directorDispatches = await (await fetch(base + '/api/documents/dispatches', { headers: director })).json()
  assert.equal(directorDispatches.dispatches.find((record) => record.id === parent.id).unitId, unitId)
  const secondResponse = await post(director, { ...payload, documentId: secondId, requestKey: 'second-pdf', recipientUserIds: ['head'] })
  assert.equal(secondResponse.status, 201, 'second PDF is authorized by folders without a UUID registration')
  assert.equal((await secondResponse.json()).persistence, 'alfresco')
  assert.equal(JSON.parse(secondNode.properties['gd:asignaciones']).documentId, secondId)
  const additionalResponse = await post(director, { ...payload, documentId: additionalId, requestKey: 'additional-institutional-document' })
  assert.equal(additionalResponse.status, 201, 'any authorized institutional PDF is in scope without a separate test-folder association')
  assert.equal(JSON.parse(additionalNode.properties['gd:asignaciones']).documentId, additionalId)
  assert.equal((await post(director, { ...payload, documentId: foreignId, requestKey: 'foreign', dependency: 'DSA', folderId: 'dsa-folder' })).status, 403)
  const provider = config.organizationalHierarchyProvider
  delete config.organizationalHierarchyProvider
  await expectError(director, { ...payload, requestKey: 'directory-unconfigured' }, 503, 'DISPATCH_HIERARCHY_UNAVAILABLE')
  assert.equal((await post(head, { ...legacyPayload, recipientUserIds: ['staff'], requestKey: 'hierarchy-unconfigured', originAssignmentId: parent.recipients[0].id })).status, 503)
  config.organizationalHierarchyProvider = provider
  assert.equal((await post(head, { ...legacyPayload, recipientUserIds: ['staff'], requestKey: 'no-origin' })).status, 403)
  assert.equal((await post(staff, { ...legacyPayload, recipientUserIds: ['head'] })).status, 403)
  const derived = await post(head, { ...legacyPayload, recipientUserIds: ['staff'], requestKey: 'child', originAssignmentId: parent.recipients[0].id })
  assert.equal(derived.status, 201)
  const concurrent = await Promise.all([
    post(director, { ...payload, requestKey: 'parallel-a' }), post(director2, { ...payload, requestKey: 'parallel-b' }),
  ])
  assert.deepEqual(concurrent.map((response) => response.status), [201, 201])
  assert.equal((await post(directorDti, { ...legacyPayload, recipientUserIds: ['staff-dti'], requestKey: 'dti' })).status, 201)
  const envelope = JSON.parse(node.properties['gd:asignaciones'])
  assert.equal(envelope.dispatches.length, 5)
  assert.equal(envelope.dispatches.find((record) => record.requestKey === 'dti').unitId, undefined)
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
  const savedEnvelope = node.properties['gd:asignaciones']
  const changed = JSON.parse(savedEnvelope)
  changed.dispatches.find(record => record.id === parent.id).recipients.find(person => person.userId === 'head').status = 'ANULADO'
  node.properties['gd:asignaciones'] = JSON.stringify(changed)
  const staleReplay = await post(head, { ...legacyPayload, recipientUserIds: ['staff'], requestKey: 'child', instruction: 'changed', originAssignmentId: parent.recipients[0].id })
  assert.equal(staleReplay.status, 403)
  assert.deepEqual(await staleReplay.json(), { error: 'DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED' })
  node.properties['gd:asignaciones'] = savedEnvelope
  originalInInstitutionalScope = false
  const removedOrigin = await post(head, { ...legacyPayload, recipientUserIds: ['staff'], requestKey: 'removed-from-institutional-scope', originAssignmentId: parent.recipients[0].id })
  assert.equal(removedOrigin.status, 403, 'an assigned Jefatura still needs verified institutional membership')
  assert.equal((await post(director, payload)).status, 403, 'retry must revalidate scope too')
  assert.equal(puts.length, completedPuts)
  assert.equal(fs.readFileSync(localPath, 'utf8'), 'legacy data must never be read or changed')
  originalInInstitutionalScope = true
  const current = node.properties['gd:asignaciones']
  actors.get('Basic fixture_director_a').groups = ['GROUP_DSA', 'GROUP_STAFF']
  for (const path of ['/api/directory/office-inboxes', '/api/documents/dispatches', originalUrl.slice(base.length)]) {
    const read = await fetch(base + path, { headers: director })
    assert.equal(read.status, 403)
    assert.equal((await read.json()).error, 'INSTITUTIONAL_IDENTITY_REJECTED')
  }
  actors.get('Basic head').enabled = false
  assert.equal((await fetch(base + '/api/documents/dispatches', { headers: head })).status, 403)
  actors.get('Basic head').enabled = true
  const previousAccount = config.responseTimes.username
  try {
    config.responseTimes.username = 'head'
    assert.equal((await fetch(base + '/api/documents/dispatches', { headers: head })).status, 403)
  } finally {
    config.responseTimes.username = previousAccount
  }
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
