import assert from 'node:assert/strict'
import { createAlfrescoDispatchRepository, assignmentProperty, projections } from '../alfrescoDispatchRepository.js'
import { pilotAcknowledgements } from '../dispatchPilot.js'
import { identityResponse } from './institutionalIdentity.js'

export const originalId = '00000000-0000-0000-0000-000000000010'
export const responseId = '00000000-0000-0000-0000-000000000020'
export const actor = (id, role) => ({ alfresco: { id }, authorization: `Basic actor-${id}`, authorizationStatus: 'active',
  functionalRole: role, dependency: 'DSA', capabilities: ['documents:read', 'documents:write'] })
export function attentionFixture() {
  const settings = { alfrescoTarget: 'https://alfresco.invalid', distributionService: { username: 'fixture_distribution', password: 'test-only' },
    dispatchPersistence: 'alfresco', dispatchPilot: { writesEnabled: true, environment: 'dev', environments: {
      dev: { enabled: true, acknowledgement: pilotAcknowledgements.dev, expectedTarget: 'https://alfresco.invalid' },
    } }, officeInboxNodeIds: { DSA: { emitidos: 'dsa-emitted', porAtender: 'dsa-attention' }, DTI: { emitidos: 'dti-emitted', porAtender: 'dti-attention' } },
    officeGroupIds: { DSA: 'GROUP_GD_DSA', DTI: 'GROUP_GD_DTI' },
    groupMappings: { dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' }, functions: { direccion: 'GROUP_DIRECTORS', 'jefe-unidad': 'GROUP_HEADS', especialista: 'GROUP_STAFF' } } }
  const pdf = (id, creator, parent, dependency) => ({ id, nodeType: 'cm:content', isFile: true, name: `${id}.pdf`,
    parentId: parent, createdByUser: { id: creator }, content: { mimeType: 'application/pdf' }, aspectNames: ['cm:versionable', 'gd:identificacion'],
    allowableOperations: ['update'], properties: { 'gd:dependenciaOrigen': dependency, 'cm:author': 'not-an-institution', 'gd:estado': 'unchanged' },
    permissions: { isInheritanceEnabled: true, locallySet: [{ authorityId: 'GROUP_GD_DTI', name: 'Consumer', accessStatus: 'ALLOWED' }] } })
  const nodes = new Map([[originalId, pdf(originalId, 'fixture_director_b', 'dti-emitted', 'DTI')]])
  const folders = new Map([['dsa-attention', new Set([originalId])], ['dti-emitted', new Set([originalId])], ['dsa-emitted', new Set()], ['dti-attention', new Set()]])
  const references = new Map()
  const state = { denyActor: false, originalPutStatus: 200, failAfterCommit: false, associationStatus: 201, calls: [] }
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    assert.equal(parsed.hostname, 'alfresco.invalid', 'all Alfresco writes must be mocked')
    const p = parsed.pathname
    const method = options.method || 'GET'
    state.calls.push({ path: p, method })
    const institutionalActors = new Map([['head', 'jefe-unidad'], ['other-head', 'jefe-unidad'], ['staff', 'especialista'], ['director', 'direccion'], ['fixture_director_b', 'direccion']]
      .map(([id, functionalRole]) => [`Basic actor-${id}`, { id, functionalRole, dependency: id === 'fixture_director_b' ? 'DTI' : 'DSA' }]))
    const identity = identityResponse(url, options, institutionalActors, settings.groupMappings)
    if (identity) return identity
    const json = (body, status = 200) => Response.json(body, { status })
    if (p.endsWith('/tickets')) return json({ entry: { id: 'test-ticket' } }, 201)
    if (p.endsWith('/people/-me-')) return json({ entry: { id: 'fixture_distribution', enabled: true, capabilities: { isAdmin: false } } })
    if (p.includes('/service/api/groups/')) {
      const groups = { DSA: ['director', 'head', 'staff', 'other-head'], DTI: ['fixture_director_b'], DIRECTORS: ['director', 'fixture_director_b'], HEADS: ['head', 'other-head'], STAFF: ['staff'] }
      const members = groups[p.split('/').at(-2)]
      return json({ data: members.map((shortName) => ({ shortName, authorityType: 'USER' })), paging: { skipCount: 0, totalItems: members.length } })
    }
    if (p.includes('/people/')) return json({ entry: { id: p.split('/').at(-1), enabled: true } })
    if (p.endsWith('/classes/gd_tramite')) return json({ properties: Object.fromEntries([
      ['gd:asignaciones', false], ['gd:responsablesActuales', true], ['gd:dependenciasResponsablesActuales', true],
    ].map(([name, multiValued]) => [name, { dataType: 'd:text', multiValued, indexed: name !== 'gd:asignaciones' }])) })
    if (p.endsWith('/classes/cm_referencing')) return json({ associations: { 'cm:references': { target: { class: 'cm:content' } } } })
    if (state.denyActor && String(options.headers?.Authorization).startsWith('Basic actor-')) return json({}, 403)
    const segments = p.split('/')
    if (p.endsWith('/children')) {
      const folder = segments.at(-2)
      if (method === 'POST') {
        assert.equal(folder, 'dsa-emitted')
        nodes.set(responseId, pdf(responseId, 'director', folder, 'DSA'))
        folders.get(folder).add(responseId)
        return json({ entry: nodes.get(responseId) }, 201)
      }
      return json({ list: { entries: [...(folders.get(folder) || [])].map((id) => ({ entry: { ...nodes.get(id), association: { assocType: 'cm:contains', isPrimary: nodes.get(id).parentId === folder } } })), pagination: { hasMoreItems: false, skipCount: 0, count: folders.get(folder)?.size || 0, totalItems: folders.get(folder)?.size || 0 } } })
    }
    if (p.endsWith('/secondary-children')) {
      const folder = segments.at(-2)
      const input = JSON.parse(options.body)
      folders.get(folder).add(input.childId)
      return json({ entry: { childId: input.childId, assocType: 'cm:contains' } }, 201)
    }
    if (p.endsWith('/parents')) return json({}, 403)
    if (p.endsWith('/targets')) {
      const source = segments.at(-2)
      if (method === 'POST') {
        if (state.associationStatus !== 201) return json({}, state.associationStatus)
        const body = JSON.parse(options.body)
        assert.equal(body.assocType, 'cm:references')
        if (!references.has(source)) references.set(source, new Set())
        references.get(source).add(body.targetId)
        return json({ entry: body }, 201)
      }
      return json({ list: { entries: [...(references.get(source) || [])].map((id) => ({ entry: { ...nodes.get(id), association: { assocType: 'cm:references' } } })), pagination: { hasMoreItems: false, skipCount: 0, count: references.get(source)?.size || 0, totalItems: references.get(source)?.size || 0 } } })
    }
    const id = p.endsWith('/content') ? segments.at(-2) : segments.at(-1)
    if (folders.has(id)) return json({ entry: { id, isFolder: true, nodeType: 'cm:folder' } })
    const node = nodes.get(id)
    if (!node) return json({}, 404)
    if (method === 'PUT') {
      const body = JSON.parse(options.body)
      assert.equal(body.permissions, undefined, 'attention and response never change ACL')
      if (id === originalId) {
        if (state.originalPutStatus !== 200) return json({}, state.originalPutStatus)
        assert.deepEqual(Object.keys(body.properties).sort(), ['gd:asignaciones', 'gd:responsablesActuales', 'gd:dependenciasResponsablesActuales'].sort())
      }
      if (body.properties) Object.assign(node.properties, body.properties)
      if (body.aspectNames) node.aspectNames = body.aspectNames
      if (state.failAfterCommit) { state.failAfterCommit = false; throw new Error('simulated lost response after commit') }
    }
    if (p.endsWith('/content')) return new Response('%PDF-1.7\nfixture', { headers: { 'Content-Type': 'application/pdf' } })
    return json({ entry: node })
  }
  const repository = createAlfrescoDispatchRepository(settings, fetchImpl)
  async function seed() {
    const input = { documentId: originalId, requestKey: 'root', senderUserId: 'director', senderDependency: 'dsa', senderRole: 'direccion', originAssignmentId: null,
      instruction: 'Atender', priority: 'Normal', recipients: [
        { id: 'head', displayName: 'Head', dependency: 'dsa', functionalRole: 'jefe-unidad' },
        { id: 'staff', displayName: 'Staff', dependency: 'dsa', functionalRole: 'especialista' },
      ] }
    return repository.withDocument(originalId, () => repository.createDispatch(input, actor('director', 'direccion')))
  }
  const envelope = () => JSON.parse(nodes.get(originalId).properties[assignmentProperty])
  function seedDirectionOwnAssignment() {
    const value = envelope()
    const assignment = value.dispatches[0].recipients[0]
    assignment.userId = 'director'; assignment.functionalRole = 'direccion'
    nodes.get(originalId).properties[assignmentProperty] = JSON.stringify(value)
    Object.assign(nodes.get(originalId).properties, projections(value))
    return assignment
  }
  const addResponse = () => {
    const node = pdf(responseId, 'director', 'dsa-emitted', 'DSA')
    Object.assign(node.properties, { 'gd:numero': '1', 'gd:codigoDocumental': 'DSA', 'gd:cicloDocumental': 2026,
      'gd:fechaDocumento': '2026-11-23', 'gd:identidadEmision': JSON.stringify({ version: 1, actorId: 'director', requestKey: 'official-fixture', payloadHash: 'a'.repeat(64) }) })
    nodes.set(responseId, node); folders.get('dsa-emitted').add(responseId)
  }
  return { settings, nodes, folders, references, state, fetchImpl, repository, seed, envelope, seedDirectionOwnAssignment, addResponse }
}
