import assert from 'node:assert/strict'
import { createAlfrescoProposalAdapter } from '../alfrescoProposalAdapter.js'
import { createDocumentQueue } from '../documentQueue.js'
import { identityResponse } from './institutionalIdentity.js'
import { parseAssignments } from '../alfrescoDispatchRepository.js'

export function fixture() {
  const settings = { alfrescoTarget: 'https://proposals.invalid', officeInboxNodeIds: { DSA: { porAtender: 'inbox' } }, proposalFolderNodeIds: { DSA: 'drafts' },
    groupMappings: { dependencies: { DSA: 'GROUP_DSA' }, functions: { direccion: 'GROUP_DIRECTION', 'jefe-unidad': 'GROUP_HEAD', especialista: 'GROUP_STAFF' } } }
  const session = { alfresco: { id: 'author' }, authorization: 'Basic actor', authorizationStatus: 'active', functionalRole: 'direccion', dependency: 'DSA', capabilities: ['documents:read', 'documents:write'] }
  const actor = { id: 'author', functionalRole: 'direccion', dependency: 'DSA' }
  const actors = new Map([[session.authorization, actor]])
  const original = { id: 'original', isFile: true, nodeType: 'cm:content', content: { mimeType: 'application/pdf' }, aspectNames: ['gd:tramite'], allowableOperations: ['update'],
    properties: { 'gd:estado': 'PENDIENTE', 'gd:asignaciones': JSON.stringify({ schemaVersion: 1, revision: 0, documentId: 'original', dispatches: [], history: [] }), 'gd:responsablesActuales': ['preserve'] } }
  const state = { original, nodes: new Map(), versionMap: new Map(), postCount: 0, putCount: 0, linked: false, failure: '', originalUpdate: true, folderCreate: true, updates: true }
  const json = (v, status = 200) => Response.json(v, { status })
  const page = (entries) => json({ list: { entries: entries.map((entry) => ({ entry })), pagination: { skipCount: 0, count: entries.length, totalItems: entries.length, hasMoreItems: false } } })
  const fetchImpl = async (url, options = {}) => {
    const identity = identityResponse(url, options, actors, settings.groupMappings)
    if (identity) return identity
    assert.ok(actors.has(options.headers.Authorization))
    const u = new URL(url); const method = options.method || 'GET'
    const personMatch = u.pathname.match(/\/people\/([^/]+)(\/groups)?$/)
    if (personMatch) {
      const person = [...actors.values()].find((p) => p.id === decodeURIComponent(personMatch[1]))
      if (!person) return json({}, 404)
      if (!personMatch[2]) return json({ entry: { id: person.id, enabled: person.enabled !== false } })
      return page((person.groups || [settings.groupMappings.dependencies[person.dependency], settings.groupMappings.functions[person.functionalRole]].flat()).map((id) => ({ id })))
    }
    if (u.pathname.includes('/service/api/classes/')) {
      return json({ name: 'cm:versionable', associations: { 'cm:references': { target: { class: 'cm:content' } } },
        properties: { 'gd:dependenciaOrigen': { dataType: 'd:text' }, 'gd:asignaciones': { dataType: 'd:text' } } })
    }
    const parts = u.pathname.split('/nodes/')[1]?.split('/') || []
    const [id, tail, versionId, content] = parts
    if (id === 'original' && !tail) {
      if (method === 'GET' && state.denyOriginalRead) return json({}, 403)
      original.allowableOperations = state.originalUpdate ? ['update'] : []
      if (method === 'GET') return json({ entry: structuredClone(original) })
      assert.equal(method, 'PUT')
      const body = JSON.parse(options.body)
      assert.deepEqual(Object.keys(body.properties), ['gd:asignaciones'])
      original.properties['gd:asignaciones'] = body.properties['gd:asignaciones']
      state.onOriginalPut?.(JSON.parse(body.properties['gd:asignaciones']))
      if (state.failure === 'final-put' && JSON.parse(body.properties['gd:asignaciones']).reviewOperations?.at(-1)?.phase === 'COMMITTED') { state.failure = ''; throw new Error('timeout-after-final-put') }
      return json({ entry: original })
    }
    if (['inbox', 'dti-inbox'].includes(id) && tail === 'children') return page([{ id: 'original', association: { assocType: 'cm:contains' } }])
    if (id === 'drafts' && !tail) {
      const name = u.searchParams.get('relativePath')
      if (name) { const n = [...state.nodes.values()].find((n) => n.name === name); return n ? json({ entry: n }) : json({}, 404) }
      return json({ entry: { id: 'drafts', isFolder: true, allowableOperations: state.folderCreate ? ['create'] : [] } })
    }
    if (id === 'drafts' && tail === 'children') {
      if (method === 'GET') return page([...state.nodes.values()].map((n) => ({ id: n.id, association: { assocType: 'cm:contains' } })))
      state.postCount++
      if (state.failure === 'before-create') { state.failure = ''; throw new Error('timeout-before-create') }
      const form = options.body
      assert.equal(form.get('autoRename'), 'false')
      const n = { id: 'proposal-node', name: form.get('name'), isFile: true, nodeType: 'cm:content', createdByUser: { id: actor.id },
        allowableOperations: ['update'], content: { mimeType: 'application/pdf' }, aspectNames: JSON.parse(form.get('aspectNames')),
        properties: { 'cm:versionLabel': '1.0', 'cm:autoVersion': form.get('cm:autoVersion') === 'true', 'cm:title': form.get('cm:title'), 'cm:description': form.get('cm:description'), 'gd:dependenciaOrigen': form.get('gd:dependenciaOrigen') } }
      state.nodes.set(n.id, n)
      state.versionMap.set('1.0', { node: structuredClone(n), bytes: Buffer.from(await form.get('filedata').arrayBuffer()), description: '' })
      if (state.failure === 'after-create') { state.failure = ''; throw new Error('timeout-after-create') }
      return json({ entry: n }, 201)
    }
    const n = state.nodes.get(id)
    if (n) {
      if (state.denyProposalRead || state.denyVersion && tail === 'versions') return json({}, 403)
      n.allowableOperations = state.updates ? ['update'] : []
      if (!tail) return json({ entry: structuredClone(n) })
      if (tail === 'targets') {
        if (method === 'POST') {
          if (state.failure === 'reference') { state.failure = ''; return json({}, 500) }
          state.linked = true
          return json({ entry: { targetId: 'original' } }, 201)
        }
        return page(state.linked ? [{ id: 'original', association: { assocType: 'cm:references' } }] : [])
      }
      if (tail === 'content') {
        if (method === 'PUT') {
          state.putCount++
          const id = '1.' + state.versionMap.size
          n.properties['cm:versionLabel'] = id
          state.versionMap.set(id, { node: structuredClone(n), bytes: Buffer.from(options.body), description: u.searchParams.get('versionComment') })
          if (state.failure === 'after-update') { state.failure = ''; throw new Error('timeout-after-update') }
          return json({ entry: n })
        }
        return new Response(state.versionMap.get(n.properties['cm:versionLabel']).bytes)
      }
      if (tail === 'versions') {
        if (!versionId) return page([...state.versionMap].map(([id, v]) => ({ id, description: v.description })))
        const v = state.versionMap.get(versionId)
        if (!v) return json({}, 404)
        if (content) return new Response(v.bytes)
        return json({ entry: { ...v.node, id: versionId } })
      }
    }
    throw new Error(`Unexpected fixture request ${method} ${u.pathname}`)
  }
  const withDocument = createDocumentQueue()
  const adapter = () => createAlfrescoProposalAdapter(settings, { fetchImpl, withDocument, simulationOnly: true, clock: () => new Date(state.now || '2026-11-19T15:00:00Z') })
  const input = { action: 'CREATE', documentId: 'original', requestKey: 'create-key', expectedRevision: 0, title: 'Respuesta', description: 'Propuesta', file: Buffer.from('%PDF-1.7 draft') }
  const envelope = () => parseAssignments(original.properties['gd:asignaciones'], 'original')
  return { settings, session, actor, actors, state, input, adapter, envelope, fetchImpl, withDocument }
}
