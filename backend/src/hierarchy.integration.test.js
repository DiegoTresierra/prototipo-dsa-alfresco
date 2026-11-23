import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

test('provisional organization requires Direction and CSRF but never authorizes hierarchical dispatch', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hierarchy-http-'))
  const containerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const dsaUnitId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const dtiUnitId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const auditContainerId = '99999999-9999-4999-8999-999999999999'
  let failAlfrescoRead = false
  let emptyAlfrescoContainer = false
  Object.assign(process.env, {
    PORT: '0', SESSION_SECRET: 'hierarchy-fixture', ALFRESCO_TARGET: 'https://hierarchy.invalid',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'fixture', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    DISPATCH_PERSISTENCE: 'local', DISPATCH_ALFRESCO_WRITES_ENABLED: 'false', OFFICIAL_EMISSION_WRITES_ENABLED: 'false',
    ORGANIZATION_STORE_PATH: path.join(temporary, 'organization.json'), DISPATCH_STORE_PATH: path.join(temporary, 'dispatches.json'),
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'directory', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'fixture-password',
    ALFRESCO_HIERARCHY_SERVICE_USERNAME: 'hierarchy-service', ALFRESCO_HIERARCHY_SERVICE_PASSWORD: 'fixture-hierarchy-password',
    ALFRESCO_HIERARCHY_CONTAINER_NODE_ID: containerId, ALFRESCO_HIERARCHY_STORAGE: 'alfresco', HIERARCHY_READ_STORAGE: 'json',
    ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID: auditContainerId,
    ALFRESCO_HIERARCHY_LAB_CONTAINER_NODE_ID: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    ALFRESCO_HIERARCHY_UNIT_WRITES_ENABLED: 'false',
    ALFRESCO_HIERARCHY_UNIT_EDITS_ENABLED: 'false',
    ALFRESCO_HIERARCHY_HEAD_WRITES_ENABLED: 'false',
    ALFRESCO_HIERARCHY_SPECIALIST_WRITES_ENABLED: 'false',
    ALFRESCO_HIERARCHY_HEAD_CHANGES_ENABLED: 'false',
    ALFRESCO_HIERARCHY_SPECIALIST_REASSIGNMENTS_ENABLED: 'false',
    ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({ dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' }, functions: { direccion: 'GROUP_DIR', 'jefe-unidad': 'GROUP_HEAD', especialista: 'GROUP_STAFF' } }),
  })
  const groups = { DSA: ['director', 'head', 'staff'], DTI: ['foreign'], DIR: ['director'], HEAD: ['head'], STAFF: ['staff', 'foreign'] }
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.hostname === '127.0.0.1') return realFetch(url, options)
    assert.equal(parsed.hostname, 'hierarchy.invalid')
    const method = options.method || 'GET'
    calls.push({ method, pathname: parsed.pathname })
    if (method === 'POST' && parsed.pathname.endsWith('/authentication/versions/1/tickets')) return Response.json({ entry: { id: 'fixture-ticket' } }, { status: 201 })
    assert.equal(method, 'GET', 'hierarchy integration must not write Alfresco nodes')
    if (parsed.pathname.endsWith('/people/-me-')) {
      const hierarchyTicket = options.headers?.Authorization === `Basic ${Buffer.from('fixture-ticket').toString('base64')}`
      return Response.json({ entry: { id: hierarchyTicket ? 'hierarchy-service' : 'directory', enabled: true, capabilities: { isAdmin: false } } })
    }
    if (failAlfrescoRead && parsed.pathname.endsWith(`/nodes/${containerId}`)) return Response.json({ error: 'unavailable' }, { status: 503 })
    if (parsed.pathname.endsWith(`/nodes/${containerId}`)) return Response.json({ entry: { id: containerId, name: 'GD_JERARQUIAS', nodeType: 'cm:folder', isFolder: true, allowableOperations: ['create'] } })
    if (parsed.pathname.endsWith(`/nodes/${auditContainerId}`)) return Response.json({ entry: { id: auditContainerId, name: 'GD_JERARQUIAS_AUDITORIA', nodeType: 'cm:folder', isFolder: true } })
    if (parsed.pathname.endsWith(`/nodes/${auditContainerId}/children`)) return Response.json({ list: { entries: [
      { entry: { id: '10000000-0000-4000-8000-000000000001', name: 'EVENT_DSA', nodeType: 'gdo:eventoJerarquia', parentId: auditContainerId, properties: {
        'gdo:claveEvento': 'key-dsa', 'gdo:idOperacionEvento': 'op-dsa', 'gdo:faseEvento': 'COMPLETADA', 'gdo:accionEvento': 'UNIDAD_CREADA',
        'gdo:dependenciaEvento': 'DSA', 'gdo:actorEvento': 'director', 'gdo:fechaEvento': '2026-11-22T10:00:00.000Z',
        'gdo:datosDespuesEvento': JSON.stringify({ entity: 'unidad', name: 'Unidad DSA', code: 'DSA-01' }),
      } } },
      { entry: { id: '10000000-0000-4000-8000-000000000002', name: 'EVENT_DTI', nodeType: 'gdo:eventoJerarquia', parentId: auditContainerId, properties: {
        'gdo:claveEvento': 'key-dti', 'gdo:idOperacionEvento': 'op-dti', 'gdo:faseEvento': 'PARCIAL', 'gdo:accionEvento': 'OPERACION_PARCIAL',
        'gdo:dependenciaEvento': 'DTI', 'gdo:actorEvento': 'director-dti', 'gdo:fechaEvento': '2026-11-23T10:00:00.000Z',
        'gdo:datosDespuesEvento': JSON.stringify({ entity: 'unidad', name: 'Unidad DTI' }),
      } } },
    ], pagination: { hasMoreItems: false } } })
    if (parsed.pathname.endsWith(`/nodes/${containerId}/children`)) {
      if (failAlfrescoRead) return Response.json({ error: 'unavailable' }, { status: 503 })
      const entries = emptyAlfrescoContainer ? [] : [
        { entry: { id: dsaUnitId, name: 'DSA_UNIT', nodeType: 'gdo:unidad', parentId: containerId, properties: { 'gdo:nombreUnidad': 'Unidad DSA', 'gdo:codigoDependencia': 'DSA', 'gdo:codigoUnidad': 'DSA-01', 'gdo:descripcionUnidad': '', 'gdo:estadoUnidad': 'ACTIVA' } } },
        { entry: { id: dtiUnitId, name: 'DTI_UNIT', nodeType: 'gdo:unidad', parentId: containerId, properties: { 'gdo:nombreUnidad': 'Unidad DTI', 'gdo:codigoDependencia': 'DTI', 'gdo:codigoUnidad': 'DTI-01', 'gdo:descripcionUnidad': '', 'gdo:estadoUnidad': 'ACTIVA' } } },
      ]
      return Response.json({ list: { entries, pagination: { hasMoreItems: false } } })
    }
    if (parsed.pathname.endsWith(`/nodes/${dsaUnitId}/children`)) {
      const entries = [
        { entry: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'HEAD_ASSIGNMENT', nodeType: 'gdo:asignacion', parentId: dsaUnitId, modifiedAt: '2026-11-20T10:00:00Z', properties: { 'gdo:idUsuario': 'head', 'gdo:idUnidad': dsaUnitId, 'gdo:dependenciaAsignacion': 'DSA', 'gdo:rolAsignacion': 'jefe-unidad', 'gdo:estadoAsignacion': 'ACTIVA', 'gdo:asignadoPor': 'director' } } },
        { entry: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'STAFF_ASSIGNMENT', nodeType: 'gdo:asignacion', parentId: dsaUnitId, properties: { 'gdo:idUsuario': 'staff', 'gdo:idUnidad': dsaUnitId, 'gdo:dependenciaAsignacion': 'DSA', 'gdo:rolAsignacion': 'especialista', 'gdo:estadoAsignacion': 'ACTIVA', 'gdo:asignadoPor': 'director' } } },
      ]
      return Response.json({ list: { entries, pagination: { hasMoreItems: false } } })
    }
    if (parsed.pathname.endsWith(`/nodes/${dtiUnitId}/children`)) return Response.json({ list: { entries: [
      { entry: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'FOREIGN_ASSIGNMENT', nodeType: 'gdo:asignacion', parentId: dtiUnitId, properties: { 'gdo:idUsuario': 'foreign', 'gdo:idUnidad': dtiUnitId, 'gdo:dependenciaAsignacion': 'DTI', 'gdo:rolAsignacion': 'especialista', 'gdo:estadoAsignacion': 'ACTIVA', 'gdo:asignadoPor': 'director-dti' } } },
    ], pagination: { hasMoreItems: false } } })
    const hierarchyGroup = parsed.pathname.match(/\/groups\/(GROUP_[^/]+)\/members$/)?.[1]
    if (hierarchyGroup) {
      const hierarchyMembers = {
        GROUP_DSA: ['director', 'head', 'staff'], GROUP_DTI: ['foreign'],
        GROUP_DIR: [], GROUP_HEAD: ['head'], GROUP_STAFF: ['staff', 'foreign'],
      }[hierarchyGroup] || []
      return Response.json({ list: { entries: hierarchyMembers.map((id) => ({ entry: { id } })), pagination: { hasMoreItems: false } } })
    }
    const personId = parsed.pathname.match(/\/people\/([^/]+)$/)?.[1]
    if (personId && personId !== '-me-') return Response.json({ entry: { id: decodeURIComponent(personId), enabled: true, displayName: decodeURIComponent(personId) } })
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
    const session = createSession({ alfresco: { id }, functionalRole, dependency, authorizationStatus: 'active', capabilities: ['documents:read', 'documents:write'] })
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(session.id).digest('base64url')
    return { Cookie: `gd_session=${session.id}.${signature}`, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }
  }
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal(config.hierarchyReadStorage, 'json')
  const director = headers('director', 'direccion'), head = headers('head', 'jefe-unidad')
  const assignments = [{ laneId: 'jefes', userId: 'head' }, { laneId: 'especialistas', userId: 'staff', unitHeadUserId: 'head' }]
  const put = (auth, values) => realFetch(`${base}/api/hierarchy`, { method: 'PUT', headers: auth, body: JSON.stringify({ assignments: values, dependency: 'DTI' }) })
  assert.equal((await realFetch(`${base}/api/hierarchy`)).status, 401)
  assert.equal((await realFetch(`${base}/api/hierarchy`, { headers: head })).status, 403)
  const patchUnit = (auth, body = { operationId: 'unit-edit-http-01', name: 'Unidad editada', code: 'DSA-EDIT', description: 'Actualizada' }) =>
    realFetch(`${base}/api/hierarchy/units/${dsaUnitId}`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) })
  assert.equal((await patchUnit({ ...director, 'X-CSRF-Token': '' })).status, 403, 'unit edits require CSRF')
  assert.equal((await patchUnit(head)).status, 403, 'unit edits require Director role')
  assert.equal((await realFetch(`${base}/api/hierarchy/units/${dsaUnitId}`, { method: 'PATCH', body: '{}' })).status, 401,
    'unauthenticated unit edits are rejected before reaching the service')
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

  // Alfresco mode is opt-in, read-only, and must not fall back to the JSON saved above.
  config.hierarchyReadStorage = 'alfresco'
  assert.equal((await realFetch(`${base}/api/hierarchy`)).status, 401)
  const alfrescoUnitWritesBeforeEdit = calls.filter((call) => call.method === 'PUT' ||
    (call.method === 'POST' && /\/nodes\/.*\/children$/.test(call.pathname))).length
  const editDisabled = await patchUnit(director)
  assert.equal(editDisabled.status, 403, 'unit edits stay disabled until explicitly enabled')
  assert.equal((await editDisabled.json()).error, 'HIERARCHY_UNIT_EDITS_DISABLED')
  assert.equal(calls.filter((call) => call.method === 'PUT' || (call.method === 'POST' && /\/nodes\/.*\/children$/.test(call.pathname))).length, alfrescoUnitWritesBeforeEdit)
  const jsonBeforeReadOnlyPut = fs.readFileSync(config.organizationStorePath, 'utf8')
  const readOnlyPut = await put(director, assignments)
  assert.equal(readOnlyPut.status, 409)
  assert.equal((await readOnlyPut.json()).error, 'HIERARCHY_ALFRESCO_READ_ONLY')
  assert.equal(fs.readFileSync(config.organizationStorePath, 'utf8'), jsonBeforeReadOnlyPut)
  assert.equal((await realFetch(`${base}/api/hierarchy`, { headers: head })).status, 403)
  const alfrescoRead = await (await realFetch(`${base}/api/hierarchy`, { headers: director })).json()
  assert.equal(alfrescoRead.dependency, 'dsa')
  assert.equal(alfrescoRead.capabilities.createUnits, false)
  assert.equal(alfrescoRead.capabilities.editUnits, false)
  assert.equal(alfrescoRead.capabilities.assignHeads, false)
  assert.equal(alfrescoRead.capabilities.assignSpecialists, false)
  assert.equal(alfrescoRead.capabilities.changeHeads, false)
  assert.equal(alfrescoRead.capabilities.reassignSpecialists, false)
  assert.deepEqual(alfrescoRead.units.map((unit) => unit.id), [dsaUnitId])
  assert.deepEqual(alfrescoRead.assignments.map((assignment) => assignment.userId), ['head', 'staff'])
  assert.equal(alfrescoRead.assignments[1].unitHeadUserId, 'head')
  assert.deepEqual(alfrescoRead.recipients.map((recipient) => recipient.id), ['head', 'staff'])
  assert.equal((await realFetch(`${base}/api/hierarchy/audit`)).status, 401)
  assert.equal((await realFetch(`${base}/api/hierarchy/audit`, { headers: head })).status, 403)
  const auditRead = await realFetch(`${base}/api/hierarchy/audit?page=1&pageSize=25&dependency=DTI`, { headers: director })
  assert.equal(auditRead.status, 200)
  const auditBody = await auditRead.json()
  assert.deepEqual(auditBody.events.map((event) => event.unitName), ['Unidad DSA'], 'query parameters cannot change the dependency taken from session')
  assert.equal(auditBody.events[0].operationType, 'unidad')
  assert.equal(auditBody.events[0].actor, 'director')
  assert.equal(auditBody.pagination.totalItems, 1)
  assert.equal((await realFetch(`${base}/api/hierarchy/audit?phase=INVENTADA`, { headers: director })).status, 400)
  const createUnit = (auth, body = { operationId: 'unit-operation-test-01', name: 'Unidad de prueba' }) =>
    realFetch(`${base}/api/hierarchy/units`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  const missingCsrf = { ...director }
  delete missingCsrf['X-CSRF-Token']
  assert.equal((await createUnit(missingCsrf)).status, 403, 'the endpoint requires CSRF even while writes are disabled')
  assert.equal((await createUnit({ ...director, 'X-CSRF-Token': 'invalid' })).status, 403)
  const disabledWrite = await createUnit({ ...director, 'X-CSRF-Token': director['X-CSRF-Token'] })
  assert.equal(disabledWrite.status, 403)
  assert.equal((await disabledWrite.json()).error, 'HIERARCHY_UNIT_WRITES_DISABLED')
  const writesBeforeRoleCheck = calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length
  assert.equal((await createUnit(head)).status, 403, 'a non-director session cannot create units')
  assert.equal(calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, writesBeforeRoleCheck,
    'disabled or unauthorized requests must not write Alfresco nodes')
  const postHead = (auth, body = { operationId: 'head-operation-test-01', userId: 'head' }) =>
    realFetch(`${base}/api/hierarchy/units/${dsaUnitId}/head`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  assert.equal((await postHead(missingCsrf)).status, 403, 'head assignment requires CSRF')
  assert.equal((await postHead({ ...director, 'X-CSRF-Token': 'invalid' })).status, 403)
  assert.equal((await postHead(head)).status, 403, 'a non-director cannot assign a unit head')
  const disabledHeadWrite = await postHead(director, { operationId: 'head-operation-test-01', userId: 'head', dependency: 'DTI', actorId: 'spoofed' })
  assert.equal(disabledHeadWrite.status, 403)
  assert.equal((await disabledHeadWrite.json()).error, 'HIERARCHY_HEAD_WRITES_DISABLED')
  assert.equal(calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, writesBeforeRoleCheck,
    'head assignment must not mutate Alfresco while its dedicated flag is disabled')
  const postSpecialist = (auth, body = { operationId: 'specialist-operation-test-01', userId: 'staff' }) =>
    realFetch(`${base}/api/hierarchy/units/${dsaUnitId}/specialists`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  assert.equal((await postSpecialist(missingCsrf)).status, 403, 'specialist assignment requires CSRF')
  assert.equal((await postSpecialist({ ...director, 'X-CSRF-Token': 'invalid' })).status, 403)
  assert.equal((await postSpecialist(head)).status, 403, 'a non-director cannot assign specialists')
  const disabledSpecialistWrite = await postSpecialist(director, { operationId: 'specialist-operation-test-01', userId: 'staff', dependency: 'DTI', actorId: 'spoofed', role: 'jefe-unidad' })
  assert.equal(disabledSpecialistWrite.status, 403)
  assert.equal((await disabledSpecialistWrite.json()).error, 'HIERARCHY_SPECIALIST_WRITES_DISABLED')
  assert.equal(calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, writesBeforeRoleCheck,
    'specialist assignment must not mutate Alfresco while its dedicated flag is disabled')
  const changeHead = (auth, body = { operationId: 'head-change-operation-01', newHeadUserId: 'head' }) =>
    realFetch(`${base}/api/hierarchy/units/${dsaUnitId}/change-head`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  assert.equal((await changeHead(missingCsrf)).status, 403, 'head changes require CSRF')
  assert.equal((await changeHead({ ...director, 'X-CSRF-Token': 'invalid' })).status, 403)
  assert.equal((await changeHead(head)).status, 403, 'a non-director cannot change the unit head')
  const disabledHeadChange = await changeHead(director, { operationId: 'head-change-operation-01', newHeadUserId: 'head', dependency: 'DTI', actorId: 'spoofed' })
  assert.equal(disabledHeadChange.status, 403)
  assert.equal((await disabledHeadChange.json()).error, 'HIERARCHY_HEAD_CHANGES_DISABLED')
  assert.equal(calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, writesBeforeRoleCheck,
    'head change must not mutate Alfresco while its dedicated flag is disabled')
  const reassignSpecialist = (auth, userId = 'staff', body = { operationId: 'reassign-operation-test-01', destinationUnitId: dsaUnitId }) =>
    realFetch(`${base}/api/hierarchy/specialists/${encodeURIComponent(userId)}/reassign`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  assert.equal((await reassignSpecialist(missingCsrf)).status, 403, 'specialist reassignment requires CSRF')
  assert.equal((await reassignSpecialist({ ...director, 'X-CSRF-Token': 'invalid' })).status, 403)
  assert.equal((await reassignSpecialist(head)).status, 403, 'a non-director cannot reassign specialists')
  const disabledReassignment = await reassignSpecialist(director, 'staff', {
    operationId: 'reassign-operation-test-01', destinationUnitId: dsaUnitId, dependency: 'DTI', actorId: 'spoofed',
  })
  assert.equal(disabledReassignment.status, 403)
  assert.equal((await disabledReassignment.json()).error, 'HIERARCHY_SPECIALIST_REASSIGNMENTS_DISABLED')
  assert.equal(calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/children')).length, writesBeforeRoleCheck,
    'disabled or unauthorized specialist reassignment must not write Alfresco nodes')
  assert.equal(fs.readFileSync(config.organizationStorePath, 'utf8'), jsonBeforeReadOnlyPut,
    'the Alfresco unit endpoint must not modify organization.json')
  const dsaTSession = headers('DSA_T', 'direccion')
  assert.equal((await realFetch(`${base}/api/hierarchy`, { headers: dsaTSession })).status, 200,
    'an already-authorized Director session is not rejected by an empty technical-account Direction group listing')
  emptyAlfrescoContainer = true
  const emptyRead = await (await realFetch(`${base}/api/hierarchy`, { headers: director })).json()
  assert.deepEqual(emptyRead.units, [])
  assert.deepEqual(emptyRead.assignments, [])
  emptyAlfrescoContainer = false
  const jsonBeforeFailedRead = fs.readFileSync(config.organizationStorePath, 'utf8')
  failAlfrescoRead = true
  const failedRead = await realFetch(`${base}/api/hierarchy`, { headers: director })
  assert.equal(failedRead.status, 503)
  assert.equal((await failedRead.json()).error, 'HIERARCHY_ALFRESCO_READ_UNAVAILABLE')
  assert.equal(fs.readFileSync(config.organizationStorePath, 'utf8'), jsonBeforeFailedRead)
  failAlfrescoRead = false
})
