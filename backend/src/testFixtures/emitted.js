import { identityResponse } from './institutionalIdentity.js'
export function emittedFixture() {
  const settings = { alfrescoTarget: 'https://emitted.invalid', officeInboxNodeIds: { DTI: { emitidos: 'dti-root' }, DSA: { emitidos: 'dsa-root' } },
    groupMappings: { dependencies: { DTI: 'GROUP_FIXTURE_DTI', DSA: 'GROUP_FIXTURE_DSA' },
      functions: { direccion: 'GROUP_FIXTURE_DIRECTION', 'jefe-unidad': 'GROUP_FIXTURE_HEAD', especialista: 'GROUP_FIXTURE_STAFF' } } }
  const actors = new Map()
  const node = (id, origin, creator, properties = {}) => ({ id, name: `${id}.pdf`, isFile: true, nodeType: 'cm:content', parentId: `${origin.toLowerCase()}-root`,
    createdAt: '2026-11-16T12:00:00Z', createdByUser: { id: creator }, content: { mimeType: 'application/pdf', sizeInBytes: id === 'dti-legacy' ? 0 : 200 },
    properties: { 'cm:title': id, ...properties } })
  const nodes = new Map([
    ['dti-root', { id: 'dti-root', isFolder: true }], ['dsa-root', { id: 'dsa-root', isFolder: true }],
    ['dti-original', node('dti-original', 'DTI', 'fixture_director_b', { 'gd:dependenciaOrigen': 'DTI' })],
    ['dti-legacy', node('dti-legacy', 'DTI', 'admin', { 'gd:numero': 'TEST-MF-001', 'cm:author': 'Home' })],
    ['dti-unit', node('dti-unit', 'DTI', 'fixture_distribution', { 'gd:codigoDocumental': 'DTI-UNIT', 'gd:numero': '2' })],
    ['dsa-original', node('dsa-original', 'DSA', 'fixture_director_a', { 'gd:codigoDocumental': 'DSA', 'gd:numero': '1' })],
  ])
  // Received and internally dispatched original keeps its DTI UUID/creator/origin.
  nodes.get('dti-original').properties['gd:asignaciones'] = JSON.stringify({ dispatches: [{ senderUserId: 'fixture_director_a', senderDependency: 'dsa', recipients: [{ userId: 'head', status: 'ASIGNADO' }] }] })
  const children = new Map([['dti-root', ['dti-original', 'dti-legacy', 'dti-unit', 'dsa-original']], ['dsa-root', ['dsa-original', 'dti-original']]])
  const calls = [], denied = new Set()
  const fetch = async (url, options) => {
    const parsed = new URL(url)
    if (parsed.hostname !== 'emitted.invalid' || options.method !== 'GET') throw new Error('unexpected request')
    calls.push({ method: options.method, path: parsed.pathname, query: parsed.search, authorization: options.headers.Authorization })
    const identity = identityResponse(url, options, actors, settings.groupMappings)
    if (identity) return identity
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const match = parsed.pathname.match(/\/nodes\/([^/]+)(?:\/(children))?$/)
    if (!match) return json({}, 404)
    const id = decodeURIComponent(match[1])
    if (denied.has(id)) return json({}, 403)
    if (!nodes.has(id)) return json({}, 404)
    if (match[2]) {
      const skip = Number(parsed.searchParams.get('skipCount'))
      const all = children.get(id) || []
      const entries = all.slice(skip, skip + 2).map((id) => ({ entry: { id, association: { assocType: 'cm:contains', isPrimary: true } } }))
      return json({ list: { entries, pagination: { skipCount: skip, count: entries.length, totalItems: all.length, hasMoreItems: skip + entries.length < all.length } } })
    }
    return json({ entry: nodes.get(id) })
  }
  const session = (dependency, functionalRole = 'direccion') => {
    const id = functionalRole === 'direccion' ? `${dependency}_T` : `${dependency}-${functionalRole}-fixture`
    const authorization = `actor-${dependency}-${functionalRole}-fixture`
    actors.set(authorization, { id, dependency, functionalRole })
    return { dependency, authorizationStatus: 'active', functionalRole, capabilities: ['documents:read'], alfresco: { id }, authorization }
  }
  return { settings, nodes, children, calls, denied, fetch, session, actors }
}
