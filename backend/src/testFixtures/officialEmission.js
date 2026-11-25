import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOfficialEmissionService, officialEmissionAck } from '../officialEmissionService.js'
import { sha256 } from '../emissionReconciliation.js'

export function officialFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'official-emission-'))
  const settings = {
    alfrescoTarget: 'https://official.invalid', dispatchPersistence: 'alfresco',
    dispatchPilot: { writesEnabled: true, environment: 'dev', environments: { dev: { enabled: true,
      expectedTarget: 'https://official.invalid', acknowledgement: 'single-instance-exclusive-writer-dev-institutional-documents' } } },
    distributionService: { username: 'fixture_distribution', password: 'test-only' },
    groupMappings: { dependencies: { DTI: 'GROUP_DTI', DSA: 'GROUP_DSA' }, functions: { direccion: 'GROUP_DIRECTION', 'jefe-unidad': 'GROUP_HEAD', especialista: 'GROUP_STAFF' } },
    officeInboxNodeIds: { DTI: { emitidos: 'DTI-emitted', porAtender: 'DTI-attention', porConocimiento: 'DTI-knowledge' },
      DSA: { emitidos: 'DSA-emitted', porAtender: 'DSA-attention', porConocimiento: 'DSA-knowledge' } },
    officeGroupIds: { DTI: 'GROUP_DTI', DSA: 'GROUP_DSA' },
    officialEmission: { writesEnabled: true, expectedTarget: 'https://official.invalid', acknowledgement: officialEmissionAck,
      reconciliationPath: path.join(directory, 'reconciliation.json'), leasePath: path.join(directory, 'official.lock') },
  }
  const manifest = { version: 2, fingerprintVersion: 2, target: settings.alfrescoTarget, approvedBy: 'test-operator', decisionReference: 'test-decision',
    approvedAt: '2026-11-18T12:00:00Z', emitidos: { DTI: 'DTI-emitted', DSA: 'DSA-emitted' }, exclusions: [] }
  function writeManifest() {
    const raw = JSON.stringify(manifest)
    fs.writeFileSync(settings.officialEmission.reconciliationPath, raw)
    settings.officialEmission.reconciliationSha256 = sha256(raw)
  }
  writeManifest()
  const nodes = new Map()
  const children = new Map()
  const calls = []
  const conditions = { timeoutAfterCreate: false, readDenied: false, createDenied: false, noRecipientRead: false, rejectService: false, corruptContent: false, noNodeRecipientRead: false, associationDenied: false }
  for (const dep of ['DTI', 'DSA']) for (const id of Object.values(settings.officeInboxNodeIds[dep])) {
    nodes.set(id, { id, isFolder: true, allowableOperations: ['create'], permissions: { isInheritanceEnabled: true,
      inherited: ['DTI', 'DSA'].map((d) => ({ authorityId: `GROUP_${d}`, name: 'Consumer', accessStatus: 'ALLOWED' })) } })
    children.set(id, [])
  }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.hostname !== 'official.invalid') throw new Error('unexpected target')
    const method = options.method || 'GET'
    calls.push({ method, path: parsed.pathname, query: parsed.search })
    assertSafe(method, parsed.pathname)
    const auth = options.headers?.Authorization
    const [dep, actorUser] = auth?.startsWith('actor:') ? auth.slice(6).split('|') : [null, null]
    if (parsed.pathname.endsWith('/people/-me-')) return json({ entry: { id: dep ? actorUser : 'fixture_distribution', enabled: !conditions.rejectService || Boolean(dep),
      capabilities: !dep && conditions.missingServiceCapabilities ? {} : { isAdmin: dep ? false : conditions.adminService ?? false } } })
    if (/\/people\/[^/]+\/groups$/.test(parsed.pathname)) return json({ list: { entries: [`GROUP_${dep}`, settings.groupMappings.functions[conditions.actorRole || 'direccion']].map((id) => ({ entry: { id } })), pagination: { skipCount: 0, count: 2, totalItems: 2, hasMoreItems: false } } })
    if (parsed.pathname === '/alfresco/service/api/classes/gd_identificacion') return json({ properties: Object.fromEntries([
      ...['gd:dependenciaOrigen','gd:dependenciaDestino','gd:remitente','gd:destinatario','gd:fechaDocumento'].map((name) => [name, 'd:text']), ['gd:numero', 'd:text'], ['gd:codigoDocumental', 'd:text'], ['gd:cicloDocumental', 'd:int'], ['gd:identidadEmision', 'd:text'],
    ].map(([name, dataType]) => [name, { dataType, multiValued: false }])) })
    if (parsed.pathname === '/alfresco/service/api/classes/gd_clasificacion') return json({ properties: { 'gd:tipoDocumental': { dataType: 'd:text', multiValued: false } } })
    const match = parsed.pathname.match(/\/nodes\/([^/]+)(?:\/(.*))?$/)
    if (!match) return json({}, 404)
    const id = decodeURIComponent(match[1]), action = match[2]
    if (method === 'GET' && parsed.searchParams.has('relativePath')) {
      const found = [...nodes.values()].find((n) => n.parentId === id && n.name === parsed.searchParams.get('relativePath'))
      return found ? json({ entry: found }) : json({}, 404)
    }
    if (method === 'GET' && action === 'children') {
      const entries = (children.get(id) || []).map((child) => ({ entry: { ...nodes.get(child), id: child, association: { assocType: 'cm:contains' } } }))
      return json({ list: { entries, pagination: { skipCount: 0, count: entries.length, totalItems: entries.length, hasMoreItems: false } } })
    }
    if (method === 'GET' && action === 'content') return conditions.readDenied ? json({}, 403) : new Response(conditions.corruptContent ? 'corrupt' : nodes.get(id)?.file)
    if (method === 'GET') {
      if (conditions.readDenied && !nodes.get(id)?.isFolder) return json({}, 403)
      const value = nodes.get(id)
      if (!value) return json({}, 404)
      if (value.isFolder && conditions.noRecipientRead) return json({ entry: { ...value, permissions: { isInheritanceEnabled: true, inherited: [] } } })
      return json({ entry: value })
    }
    if (method === 'POST' && action === 'children') {
      if (conditions.createDenied) return json({}, 403)
      const form = options.body
      if (form.get('aspectnames') !== JSON.stringify(['gd:identificacion', 'gd:clasificacion']) || form.get('autoRename') !== 'false' || form.get('overwrite') !== 'false') throw new Error('invalid multipart contract')
      if ([...nodes.values()].some((n) => n.parentId === id && n.name === form.get('name'))) return json({}, 409)
      const nodeId = `pdf-${[...nodes.values()].filter((n) => n.isFile).length + 1}`
      const file = Buffer.from(await form.get('filedata').arrayBuffer())
      const entry = { id: nodeId, nodeType: 'cm:content', isFile: true, parentId: id, name: form.get('name'),
        allowableOperations: ['update'], aspectNames: ['gd:identificacion', 'gd:clasificacion'],
        createdByUser: { id: actorUser }, content: { mimeType: 'application/pdf', sizeInBytes: file.length }, file,
        permissions: conditions.noNodeRecipientRead ? { isInheritanceEnabled: true, inherited: [] } : nodes.get(id).permissions, properties: {
          'cm:title': form.get('cm:title'), 'cm:description': form.get('cm:description'),
          ...Object.fromEntries(['gd:dependenciaOrigen','gd:dependenciaDestino','gd:remitente','gd:destinatario','gd:fechaDocumento','gd:tipoDocumental'].map((name) => [name, form.get(name)])), 'gd:numero': form.get('gd:numero'), 'gd:codigoDocumental': form.get('gd:codigoDocumental'),
          'gd:cicloDocumental': Number(form.get('gd:cicloDocumental')), 'gd:identidadEmision': form.get('gd:identidadEmision'),
        } }
      nodes.set(nodeId, entry); children.get(id).push(nodeId)
      if (conditions.timeoutAfterCreate) { conditions.timeoutAfterCreate = false; throw new Error('timeout') }
      return json({ entry }, 201)
    }
    if (method === 'POST' && action === 'secondary-children') {
      if (conditions.associationDenied) return json({}, 403)
      const { childId, assocType } = JSON.parse(options.body)
      if (children.get(id).includes(childId)) return json({}, 409)
      children.get(id).push(childId)
      return json({ entry: { childId, assocType } }, 201)
    }
    return json({}, 405)
  }
  function assertSafe(method, pathname) {
    if (['PUT', 'DELETE', 'PATCH'].includes(method)) throw new Error('forbidden mutation in official flow')
    if (method === 'POST' && !/\/(children|secondary-children)$/.test(pathname)) throw new Error('unexpected mutation')
  }
  const clock = { now: new Date('2026-11-18T12:00:00Z') }
  const cleanupTasks = []
  let service = createOfficialEmissionService(settings, fetch, () => clock.now)
  const session = (dep = 'DSA', actorId = `director-${dep}`) => ({ alfresco: { id: actorId }, authorization: `actor:${dep}|${actorId}`, dependency: dep,
    functionalRole: 'direccion', authorizationStatus: 'active', capabilities: ['documents:read', 'documents:write'] })
  const input = (key = 'request-1', dep = 'DSA') => ({ requestKey: key, title: 'Test title', description: 'Test description',
    documentType: 'OFICIO', documentPeriod: '2026 - II', priority: 'Normal', recipientDependency: dep === 'DSA' ? 'DTI' : 'DSA', receiptCategory: 'por-atender', file: Buffer.from('%PDF-1.7\nTest fixture') })
  t.after(async () => { for (const task of cleanupTasks) await task(); service.release(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { settings, manifest, writeManifest, nodes, children, calls, conditions, clock, session, input, fetch,
    beforeCleanup(task) { cleanupTasks.push(task) },
    get service() { return service },
    restart() { service.release(); service = createOfficialEmissionService(settings, fetch, () => clock.now); return service },
  }
}
