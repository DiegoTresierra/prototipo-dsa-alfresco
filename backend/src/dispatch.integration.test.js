import { identityResponse } from './testFixtures/institutionalIdentity.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

test('HTTP hierarchical dispatch preserves one PDF, parent obligations, traceability and document authorization', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-http-'))
  const units = {
    'head-a': { code: 'fixture-a', name: 'Unidad de prueba A', dependency: 'DSA' },
    'head-b': { code: 'fixture-b', name: 'Unidad de prueba B', dependency: 'DSA' },
  }
  Object.assign(process.env, {
    DISPATCH_PERSISTENCE: 'local', DISPATCH_ALFRESCO_WRITES_ENABLED: 'false',
    PORT: '0', SESSION_SECRET: 'dispatch-test-secret', ALFRESCO_TARGET: 'https://alfresco.invalid',
    ALFRESCO_DIAGNOSTICS: 'true',
    KEYCLOAK_ISSUER: 'https://keycloak.invalid', KEYCLOAK_CLIENT_ID: 'test', KEYCLOAK_REDIRECT_URI: 'http://localhost/callback',
    ALFRESCO_DISTRIBUTION_SERVICE_USERNAME: 'directory-service', ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD: 'fixture-password',
    ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({ dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' }, functions: { direccion: 'GROUP_DIRECTORS', 'jefe-unidad': 'GROUP_HEADS', especialista: 'GROUP_SPECIALISTS' } }),
    ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON: '{}',
    ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON: JSON.stringify({ DSA: { emitidos: 'dsa-emitted', porAtender: 'dsa-attention', porConocimiento: 'dsa-knowledge' }, DTI: { emitidos: 'dti-emitted', porAtender: 'dti-attention', porConocimiento: 'dti-knowledge' } }),
    DISPATCH_STORE_PATH: path.join(temporaryDirectory, 'dispatches.json'),
  })
  const { server } = await import('./index.js')
  const { config } = await import('./config.js')
  const { createSession } = await import('./sessionStore.js')
  const { updateDispatch } = await import('./dispatchStore.js')
  if (!server.listening) await once(server, 'listening')
  const originalFetch = globalThis.fetch
  t.after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const actors = new Map()
  const makeSession = (id, role, dependency = 'DSA') => {
    actors.set(`Basic ${id}-ticket`, { id, functionalRole: role, dependency })
    const session = createSession({ alfresco: { id }, authorizationStatus: 'active', functionalRole: role, dependency, capabilities: ['documents:read', 'documents:write'], authorization: `Basic ${id}-ticket`, unit: units[id] })
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(session.id).digest('base64url')
    return { Cookie: `gd_session=${session.id}.${signature}`, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }
  }
  const director = makeSession('director', 'direccion')
  const head = makeSession('head-a', 'jefe-unidad')
  const specialist = makeSession('staff-a', 'especialista')
  const directorDti = makeSession('director-dti', 'direccion', 'DTI')
  const headDti = makeSession('head-dti', 'jefe-unidad', 'DTI')
  const nodes = {
    pdf: { parentId: 'dsa-attention' }, own: { parentId: 'foreign', createdByUser: { id: 'head-a' } },
    secondary: { parentId: 'dti-emitted' }, foreign: { parentId: 'foreign' }, denied: { parentId: 'dsa-knowledge' },
    'dti-pdf': { parentId: 'dti-attention' },
  }
  const groups = { DSA: ['director', 'head-a', 'head-b', 'staff-a', 'staff-b'], DTI: ['director-dti', 'head-dti', 'staff-dti'], DIRECTORS: ['director', 'director-dti'], HEADS: ['head-a', 'head-b', 'head-dti'], SPECIALISTS: ['staff-a', 'staff-b', 'staff-dti'] }
  const disabled = new Set()
  const denied = new Set(['denied'])
  const parentsByNode = new Map()
  const parentsDenied = new Set()
  const scopedChildren = new Map()
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.origin === base) return originalFetch(url, options)
    assert.equal(parsed.hostname, 'alfresco.invalid', 'all Alfresco requests must be mocked')
    const method = options.method || 'GET'
    calls.push({ path: parsed.pathname, method, authorization: options.headers.Authorization })
    const identity = identityResponse(url, options, actors, config.groupMappings)
    if (identity) return identity
    const isSearch = parsed.pathname.endsWith('/search')
    assert.equal(method, isSearch ? 'POST' : 'GET', 'dispatch never writes a node, ACL, PDF or association')
    const json = (value, status = 200) => Response.json(value, { status })
    if (parsed.pathname.endsWith('/people/-me-')) return json({ entry: { id: 'directory-service', enabled: true } })
    if (parsed.pathname.includes('/service/api/groups/')) {
      const group = parsed.pathname.split('/').at(-2)
      const members = groups[group]
      assert.ok(members)
      return json({ data: members.map((id) => ({ shortName: id, authorityType: 'USER' })), paging: { skipCount: 0, totalItems: members.length } })
    }
    if (parsed.pathname.includes('/people/')) {
      const id = parsed.pathname.split('/').at(-1)
      return json({ entry: { id, enabled: !disabled.has(id) } })
    }
    assert.ok(['head-a', 'director', 'staff-a', 'director-dti', 'head-dti', 'DSA_T'].some((id) => options.headers.Authorization === `Basic ${id}-ticket`), 'document requests use the effective user')
    if (parsed.pathname.endsWith('/children')) {
      const folder = parsed.pathname.split('/').at(-2)
      if (scopedChildren.has(folder)) {
        const children = scopedChildren.get(folder)
        if (children === null) return json({}, 403)
        const skip = Number(parsed.searchParams.get('skipCount') || 0)
        return json({ list: { entries: children.slice(skip, skip + 1), pagination: { hasMoreItems: skip + 1 < children.length, totalItems: children.length } } })
      }
    }
    if (isSearch || parsed.pathname.endsWith('/children')) return json({ list: { entries: Object.keys(nodes).map((id) => ({ entry: { id } })), pagination: { hasMoreItems: false, totalItems: 5 } }, context: { facets: 'hidden' } })
    if (parsed.pathname.endsWith('/parents')) {
      const id = parsed.pathname.split('/').at(-2)
      if (parentsDenied.has(id)) return json({}, 403)
      return json({ list: { entries: parentsByNode.get(id) || (id === 'secondary' ? [{ entry: { id: 'dsa-knowledge' } }] : []), pagination: { hasMoreItems: false } } })
    }
    const id = parsed.pathname.endsWith('/content') ? parsed.pathname.split('/').at(-2) : parsed.pathname.split('/').at(-1)
    if (denied.has(id)) return json({}, 403)
    if (!nodes[id]) return json({}, 404)
    if (parsed.pathname.endsWith('/content')) return new Response('%PDF-1.7\nfixture', { headers: { 'Content-Type': 'application/pdf' } })
    return json({ entry: { id, isFile: true, content: { mimeType: 'application/pdf' }, ...nodes[id] } })
  }
  const proxy = `${base}/api/alfresco/api/-default-/public/alfresco/versions/1`
  for (const headers of [director, head, specialist]) {
    for (const [method, suffix] of [['DELETE', ''], ['DELETE', '/secondary-children/child'], ['POST', '/move'], ['POST', '/copy'], ['PUT', '']]) {
      const deniedMutation = await fetch(`${proxy}/nodes/pdf${suffix}`, { method, headers, body: JSON.stringify({ targetParentId: 'foreign' }) })
      assert.equal(deniedMutation.status, 403)
      assert.equal((await deniedMutation.json()).error, 'DOCUMENT_RETENTION_OPERATION_FORBIDDEN')
    }
  }
  const read = (id, suffix = '') => fetch(`${proxy}/nodes/${id}${suffix}`, { headers: head })
  for (const suffix of ['', '/content']) {
    assert.equal((await read('pdf', suffix)).status, 403)
    assert.equal((await read('foreign', suffix)).status, 403)
    assert.equal((await read('own', suffix)).status, 200)
    assert.equal((await read('secondary', suffix)).status, 200, 'secondary knowledge association preserves institutional reading')
    assert.equal((await read('denied', suffix)).status, 403)
  }
  const directory = await fetch(`${base}/api/directory/unit-heads`, { headers: director })
  assert.deepEqual((await directory.json()).recipients.map((recipient) => recipient.id), ['head-a', 'head-b'])
  const input = { documentId: 'pdf', recipientUserIds: ['head-a', 'head-b'], instruction: 'Atender', priority: 'Alta', requestKey: 'retry-key' }
  const dispatch = (value = input, headers = director) => fetch(`${base}/api/documents/dispatch`, { method: 'POST', headers, body: JSON.stringify(value) })
  const created = await dispatch()
  assert.equal(created.status, 201)
  const record = (await created.json()).dispatch
  assert.equal(record.documentId, 'pdf')
  assert.equal(record.recipients.length, 2)
  assert.ok(record.recipients.every((recipient) => recipient.status === 'ASIGNADO'))
  assert.equal(new Set(record.recipients.map((recipient) => recipient.id)).size, 2)
  assert.ok(record.recipients.every((recipient) => recipient.documentId === 'pdf' && recipient.senderUserId === 'director' && recipient.instruction === 'Atender' && recipient.unit === null))
  assert.equal(record.completedAt, undefined, 'assignment completion is not global attention completion')
  assert.equal((await dispatch()).status, 200)
  assert.equal((await dispatch({ ...input, instruction: 'Otra instrucción' })).status, 409)
  assert.equal(JSON.parse(fs.readFileSync(config.dispatchStorePath, 'utf8')).length, 1)
  assert.equal((await read('pdf', '/content')).status, 200)
  const before = (await (await fetch(`${base}/api/documents/dispatches`, { headers: head })).json()).dispatches
  assert.equal(before[0].documentId, 'pdf')
  for (const folder of ['dsa-attention', 'dsa-knowledge', 'dsa-emitted']) {
    const list = await fetch(`${proxy}/nodes/${folder}/children`, { headers: head })
    assert.equal(list.status, 200)
    const payload = await list.json()
    assert.deepEqual(payload.list.entries.map(({ entry }) => entry.id), ['pdf', 'own', 'secondary'])
    assert.equal(payload.list.pagination.totalItems, 3)
  }
  assert.equal((await fetch(`${proxy}/nodes/dti-attention/children`, { headers: head })).status, 403)
  const search = await fetch(`${base}/api/alfresco/api/-default-/public/search/versions/1/search`, { method: 'POST', headers: head, body: JSON.stringify({ query: { query: '*' }, paging: { maxItems: 100 } }) })
  const searchPayload = await search.json()
  assert.equal(search.status, 200)
  assert.deepEqual(searchPayload.list.entries.map(({ entry }) => entry.id), ['pdf', 'own', 'secondary'])
  assert.equal(searchPayload.context, undefined)
  const getDirectory = async (headers) => fetch(`${base}/api/directory/dispatch-recipients`, { headers })
  assert.deepEqual((await (await getDirectory(director)).json()).recipients.map((recipient) => recipient.id), ['head-a', 'head-b', 'staff-a', 'staff-b'])
  const pendingHierarchy = await getDirectory(head)
  assert.equal(pendingHierarchy.status, 503)
  assert.equal((await pendingHierarchy.json()).error, 'ORGANIZATIONAL_HIERARCHY_PENDING')
  const blockedDispatch = await dispatch({ ...input, requestKey: 'pending-hierarchy' }, head)
  assert.equal(blockedDispatch.status, 503, JSON.stringify(await blockedDispatch.json()))
  // Test-only institutional provider: no production mappings or guessed supervisors.
  config.organizationalHierarchyProvider = {
    async resolveSpecialists({ dependency }) {
      return { verified: true, members: (dependency === 'dsa' ? ['staff-a', 'staff-b'] : ['staff-dti'])
        .map((userId) => ({ userId, groupIds: ['GROUP_test_supervision'] })) }
    },
  }
  t.after(() => { delete config.organizationalHierarchyProvider })
  assert.deepEqual((await (await getDirectory(head)).json()).recipients.map((recipient) => recipient.id), ['staff-a', 'staff-b'])
  assert.equal((await getDirectory(specialist)).status, 403)
  assert.deepEqual((await (await getDirectory(directorDti)).json()).recipients.map((recipient) => recipient.id), ['head-dti', 'staff-dti'])
  assert.deepEqual((await (await fetch(`${base}/api/auth/me`, { headers: specialist })).json()).dispatchRecipientRoles, [])
  assert.deepEqual((await (await fetch(`${base}/api/auth/me`, { headers: head })).json()).dispatchRecipientRoles, ['especialista'])
  const direct = await dispatch({ ...input, recipientUserIds: ['staff-a'], requestKey: 'direct-specialist' })
  assert.equal(direct.status, 201, 'Dirección can dispatch directly to a specialist without unit mapping')
  const ownAssignment = record.recipients.find((recipient) => recipient.userId === 'head-a')
  const otherAssignment = record.recipients.find((recipient) => recipient.userId === 'head-b')
  const chained = { ...input, recipientUserIds: ['staff-a', 'staff-b'], requestKey: 'chain', originAssignmentId: ownAssignment.id }
  const childResponse = await dispatch(chained, head)
  assert.equal(childResponse.status, 201)
  const child = (await childResponse.json()).dispatch
  assert.equal(child.documentId, record.documentId)
  assert.equal(child.originAssignmentId, ownAssignment.id)
  assert.equal(child.senderRole, 'jefe-unidad')
  assert.ok(child.recipients.every((recipient) => recipient.originAssignmentId === ownAssignment.id && recipient.senderUserId === 'head-a' && recipient.functionalRole === 'especialista'))
  const parent = JSON.parse(fs.readFileSync(config.dispatchStorePath, 'utf8')).find((item) => item.id === record.id)
  assert.deepEqual(parent, record, 'deriving never changes either jefatura obligation')
  const count = JSON.parse(fs.readFileSync(config.dispatchStorePath, 'utf8')).length
  assert.equal((await dispatch(chained, head)).status, 200)
  assert.equal(JSON.parse(fs.readFileSync(config.dispatchStorePath, 'utf8')).length, count)
  assert.equal((await dispatch({ ...chained, originAssignmentId: otherAssignment.id }, head)).status, 409, 'retry cannot change its parent assignment')
  for (const value of [
    { ...chained, requestKey: 'wrong-parent', originAssignmentId: otherAssignment.id },
    { ...chained, requestKey: 'wrong-document', documentId: 'secondary' },
    { ...chained, requestKey: 'knowledge-only', documentId: 'secondary', originAssignmentId: null },
    { ...chained, requestKey: 'own-without-proof', documentId: 'own', originAssignmentId: null },
    { ...chained, requestKey: 'to-direction', recipientUserIds: ['director'] },
    { ...chained, requestKey: 'to-head', recipientUserIds: ['head-b'] },
    { ...chained, requestKey: 'to-dti', recipientUserIds: ['staff-dti'] },
  ]) assert.equal((await dispatch(value, head)).status, 403, value.requestKey)
  assert.equal((await dispatch({ ...input, requestKey: 'specialist-attempt', recipientUserIds: ['head-a'] }, specialist)).status, 403)
  assert.equal((await dispatch({ ...input, requestKey: 'director-cross-dependency', recipientUserIds: ['staff-dti'] })).status, 403)
  const dtiResponse = await dispatch({ ...input, documentId: 'dti-pdf', recipientUserIds: ['head-dti', 'staff-dti'], requestKey: 'dti-root' }, directorDti)
  assert.equal(dtiResponse.status, 201)
  const dtiRoot = (await dtiResponse.json()).dispatch
  assert.equal((await dispatch({ ...input, documentId: 'dti-pdf', recipientUserIds: ['staff-dti'], requestKey: 'dti-chain', originAssignmentId: dtiRoot.recipients.find((recipient) => recipient.userId === 'head-dti').id }, headDti)).status, 201)
  const inbox = await (await fetch(`${base}/api/documents/dispatches?include=documents`, { headers: specialist })).json()
  assert.equal(inbox.dispatches.length, 2, 'specialist sees both direct and chained assignments')
  assert.deepEqual(inbox.documents.map((document) => document.id), ['pdf'], 'metadata is fetched by unique original UUID without a personal folder')
  assert.equal(inbox.sentDispatches.length, 0)
  const headInbox = await (await fetch(`${base}/api/documents/dispatches?include=documents`, { headers: head })).json()
  assert.equal(headInbox.dispatches.length, 1)
  assert.equal(headInbox.sentDispatches.length, 1)
  for (const suffix of ['', '/content']) {
    assert.equal((await fetch(`${proxy}/nodes/pdf${suffix}`, { headers: specialist })).status, 200)
    assert.equal((await fetch(`${proxy}/nodes/foreign${suffix}`, { headers: specialist })).status, 403)
    assert.equal((await fetch(`${proxy}/nodes/secondary${suffix}`, { headers: specialist })).status, 403)
  }
  denied.add('pdf')
  assert.equal((await dispatch(chained, head)).status, 403, 'even an idempotent retry respects a current Alfresco denial')
  assert.equal((await fetch(`${proxy}/nodes/pdf/content`, { headers: specialist })).status, 403)
  const deniedInbox = await (await fetch(`${base}/api/documents/dispatches?include=documents`, { headers: specialist })).json()
  assert.equal(deniedInbox.dispatches.length, 2)
  assert.deepEqual(deniedInbox.documents, [])
  assert.equal(deniedInbox.documentErrors[0].documentId, 'pdf')
  denied.delete('pdf')
  disabled.add('staff-b')
  assert.ok(!(await (await getDirectory(head)).json()).recipients.some((recipient) => recipient.id === 'staff-b'))
  assert.equal((await dispatch({ ...chained, requestKey: 'inactive-recipient' }, head)).status, 403)
  disabled.delete('staff-b')
  groups.HEADS.push('staff-b')
  assert.ok(!(await (await getDirectory(head)).json()).recipients.some((recipient) => recipient.id === 'staff-b'))
  assert.equal((await dispatch({ ...chained, requestKey: 'ambiguous-recipient' }, head)).status, 403)
  groups.HEADS.pop()
  assert.equal((await dispatch({ ...input, documentId: 'secondary', recipientUserIds: ['staff-a'], requestKey: 'direction-secondary-parent' })).status, 201, 'Dirección manages institutional documents through secondary parents too')
  assert.equal((await fetch(`${proxy}/nodes/secondary/content`, { headers: specialist })).status, 200)
  updateDispatch(record.id, (current) => ({ ...current, recipients: current.recipients.map((recipient) => recipient.id === ownAssignment.id ? { ...recipient, status: 'ATENDIDO' } : recipient) }))
  assert.equal((await dispatch({ ...chained, requestKey: 'closed-origin' }, head)).status, 403)
  const forgedScope = await dispatch({ ...input, documentId: 'foreign', requestKey: 'forged-scope', dependency: 'DSA', parentId: 'dsa-attention', sourceFolderId: 'dsa-attention' })
  assert.equal(forgedScope.status, 403)
  assert.equal((await forgedScope.json()).diagnostic.reason, 'DOCUMENT_OUTSIDE_DEPENDENCY')

  // Exact UUID and folder IDs verified by GET in DEV. Identity and writes here are mocks.
  const actualId = '18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097'
  const actualAttention = '701049e5-a6a9-48c0-9049-e5a6a998c02b'
  nodes[actualId] = { parentId: '69e39272-905e-426c-a392-72905ef26ca6' }
  config.officeInboxNodeIds.DSA.porAtender = actualAttention
  groups.DSA.push('DSA_T', 'JEFE_UNIDAD_DSA_1')
  groups.DIRECTORS.push('DSA_T')
  groups.HEADS.push('JEFE_UNIDAD_DSA_1')
  const realShapeActor = makeSession('DSA_T', 'direccion')
  const realShapeRequest = { documentId: actualId, recipientUserIds: ['JEFE_UNIDAD_DSA_1'], instruction: 'hola', originAssignmentId: null, priority: 'Normal', requestKey: '989b9b26-4714-469c-9436-84e34d7095f9' }
  parentsByNode.set(actualId, [{ entry: { id: nodes[actualId].parentId, association: { assocType: 'cm:contains', isPrimary: true } } }, { entry: { id: actualAttention, association: { assocType: 'cm:contains', isPrimary: false } } }])
  parentsDenied.add(actualId)
  scopedChildren.set('dsa-emitted', null)
  scopedChildren.set(actualAttention, [{ entry: { id: 'another-document', association: { assocType: 'cm:contains', isPrimary: true } } }, { entry: { id: actualId, association: { assocType: 'cm:contains', isPrimary: true } } }])
  const parentFailure = await dispatch(realShapeRequest, realShapeActor)
  assert.equal(parentFailure.status, 201, 'the real DSA_T rejection must be fixed: node is readable and scoped folder proves membership despite parents 403')
  assert.equal((await parentFailure.json()).dispatch.documentId, actualId)
  const unverifiedId = 'unverified-foreign-document'
  nodes[unverifiedId] = { parentId: nodes[actualId].parentId }
  parentsDenied.add(unverifiedId)
  const failureResponse = await dispatch({ ...realShapeRequest, documentId: unverifiedId, requestKey: 'unverified-scope', dependency: 'DSA', sourceFolderId: actualAttention, parentId: actualAttention }, realShapeActor)
  assert.equal(failureResponse.status, 403, 'frontend scope claims cannot replace membership verified in Alfresco')
  const failure = await failureResponse.json()
  assert.equal(failure.error, 'DISPATCH_DOCUMENT_NOT_ALLOWED')
  assert.equal(failure.diagnostic.userId, 'DSA_T')
  assert.equal(failure.diagnostic.functionalRole, 'direccion')
  assert.equal(failure.diagnostic.nodeStatus, 200)
  assert.equal(failure.diagnostic.parentsStatus, 403)
  assert.equal(failure.diagnostic.reason, 'DOCUMENT_SCOPE_NOT_VERIFIED')
  assert.ok(!JSON.stringify(failure).includes('Basic'))
  scopedChildren.set(actualAttention, null)
  assert.equal((await dispatch({ ...realShapeRequest, requestKey: 'scope-folder-acl-denied' }, realShapeActor)).status, 403)
  scopedChildren.set(actualAttention, [{ entry: { id: actualId, association: { assocType: 'custom:reference' } } }])
  assert.equal((await dispatch({ ...realShapeRequest, requestKey: 'not-a-contains-membership' }, realShapeActor)).status, 403)
  parentsDenied.delete(actualId)
  assert.equal((await dispatch(realShapeRequest, realShapeActor)).status, 200, 'ordinary parents verification and idempotence remain valid')
  denied.add(actualId)
  const scopeReadsBeforeDenial = calls.filter(({ path }) => path.includes('/nodes/') && path.endsWith('/children')).length
  const nodeFailure = await dispatch({ ...realShapeRequest, requestKey: 'node-acl-denied' }, realShapeActor)
  assert.equal(nodeFailure.status, 403)
  assert.equal((await nodeFailure.json()).diagnostic.reason, 'ALFRESCO_NODE_READ_REJECTED')
  assert.equal(calls.filter(({ path }) => path.includes('/nodes/') && path.endsWith('/children')).length, scopeReadsBeforeDenial, 'a PDF ACL denial never triggers an alternate scope authorization')
  assert.equal(calls.some(({ method, path }) => method !== 'GET' && !path.endsWith('/search')), false)
})
