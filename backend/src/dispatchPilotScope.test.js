import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyPilotDocumentScope } from './dispatchPilotScope.js'
import { pilotAcknowledgements } from './dispatchPilot.js'

const officeFolder = '00000000-0000-0000-0000-000000000088'
const settings = () => ({ alfrescoTarget: 'https://alfresco.invalid', dispatchPilot: {
  writesEnabled: true, environment: 'dev', environments: {
    dev: { enabled: true, acknowledgement: pilotAcknowledgements.dev, expectedTarget: 'https://alfresco.invalid' },
  },
}, officeInboxNodeIds: { DSA: { porAtender: officeFolder }, DTI: { emitidos: 'dti-folder' } } })
const session = { alfresco: { id: 'direction' }, functionalRole: 'direccion', dependency: 'DSA', authorizationStatus: 'active',
  capabilities: ['documents:read', 'documents:write'], authorization: 'Basic actor-only' }
const node = { id: 'another-pdf', nodeType: 'cm:content', isFile: true, content: { mimeType: 'application/pdf' }, parentId: 'dti-folder' }

function requestFor(membership, calls = []) {
  return async (path, options) => {
    assert.equal(options.authorization, session.authorization, 'scope must never be checked with technical credentials')
    calls.push(path)
    const folder = path.split('/').at(-2)
    const entries = membership[folder] || []
    const skip = Number(new URLSearchParams(options.query).get('skipCount'))
    return { list: { entries: entries.slice(skip, skip + 1), pagination: { hasMoreItems: skip + 1 < entries.length } } }
  }
}
const contains = (id, isPrimary = false) => ({ entry: { id, association: { assocType: 'cm:contains', isPrimary } } })

test('existing institutional inbox suffices: pagination recognizes secondary DTI-DSA and primary cm:contains, without other folders', async () => {
  const calls = []
  const request = requestFor({ [officeFolder]: [contains('other'), contains(node.id)] }, calls)
  await verifyPilotDocumentScope(settings(), session, node, request)
  assert.equal(calls.length, 2)
  assert.ok(calls.every((path) => path.includes(officeFolder)))
  await verifyPilotDocumentScope(settings(), session, { ...node, parentId: officeFolder },
    requestFor({ [officeFolder]: [contains(node.id, true)] }))
})

test('known UUID, primary parent, frontend claims, another dependency and non-cm:contains associations cannot grant scope', async () => {
  await assert.rejects(verifyPilotDocumentScope(settings(), { ...session, folderId: officeFolder }, node,
    requestFor({ 'dti-folder': [contains(node.id)] })), /DISPATCH_DOCUMENT_NOT_ALLOWED/)
  await assert.rejects(verifyPilotDocumentScope(settings(), session, { ...node, parentId: officeFolder },
    requestFor({})), /DISPATCH_DOCUMENT_NOT_ALLOWED/)
  await assert.rejects(verifyPilotDocumentScope(settings(), session, node,
    requestFor({ [officeFolder]: [{ entry: { id: node.id, association: { assocType: 'cm:references' } } }] })), /DISPATCH_DOCUMENT_NOT_ALLOWED/)
})

test('folders, non-PDF, non-admitted node types and unauthorized identities cannot pass institutional scope', async () => {
  const request = requestFor({ [officeFolder]: [contains(node.id)] })
  for (const invalid of [{ ...node, isFile: false }, { ...node, nodeType: 'custom:unknown' }, { ...node, content: { mimeType: 'text/plain' } }]) {
    await assert.rejects(verifyPilotDocumentScope(settings(), session, invalid, request), /DISPATCH_INVALID_DOCUMENT/)
  }
  for (const invalidSession of [
    { ...session, functionalRole: 'especialista' }, { ...session, authorization: '' },
    { ...session, authorizationStatus: 'inactive' }, { ...session, capabilities: ['documents:read'] },
    { ...session, dependency: 'another-office' },
  ]) {
    await assert.rejects(verifyPilotDocumentScope(settings(), invalidSession, node, request), /HIERARCHICAL_DISPATCH_REQUIRED/)
  }
})

test('denied folder, failed upstream and broken pagination never become authorization', async () => {
  await assert.rejects(verifyPilotDocumentScope(settings(), session, node,
    async () => { throw Object.assign(new Error('DISPATCH_NODE_READ_DENIED'), { status: 403 }) }), /DISPATCH_DOCUMENT_NOT_ALLOWED/)
  await assert.rejects(verifyPilotDocumentScope(settings(), session, node,
    async () => { throw new Error('DISPATCH_ALFRESCO_UNAVAILABLE') }), /DISPATCH_ALFRESCO_UNAVAILABLE/)
  await assert.rejects(verifyPilotDocumentScope(settings(), session, node,
    async () => ({ list: { entries: [], pagination: { hasMoreItems: true } } })), /DISPATCH_SCOPE_QUERY_LIMIT/)
})
