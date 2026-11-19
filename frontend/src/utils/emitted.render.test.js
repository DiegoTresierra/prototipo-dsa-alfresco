import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { listInstitutionalEmitted } from '../../../backend/src/emittedDocuments.js'
import { emittedFixture } from '../../../backend/src/testFixtures/emitted.js'

test('actual HTTP mapping and React workspace render institutional historical originals with an empty browser cache', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  const realFetch = globalThis.fetch
  try {
    const f = emittedFixture()
    let snapshot = await listInstitutionalEmitted(f.settings, f.session('DTI'), f.fetch)
    let status = 200
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/documents/emitted')
      assert.equal(options.credentials, 'include')
      return new Response(JSON.stringify(snapshot), { status, headers: { 'Content-Type': 'application/json' } })
    }
    const { getEmittedDocuments } = await server.ssrLoadModule('/src/api/alfresco.js')
    const { DirectorWorkspacePage } = await server.ssrLoadModule('/src/pages/DirectorWorkspacePage.jsx')
    const props = { activePanel: 'documentos-enviados', title: 'Emitidos', office: { userId: 'DTI_T', office: 'DTI' },
      allowAlfresco: true, alfrescoDocuments: [], inbox: { documents: [] } }
    const render = (inbox, extra = {}) => renderToStaticMarkup(createElement(DirectorWorkspacePage, { ...props, ...extra, emittedInbox: { ...inbox, refresh() {} } }))
    const inbox = await getEmittedDocuments()
    const html = render(inbox)
    for (const id of ['dti-original', 'dti-legacy', 'dti-unit']) assert.ok(html.includes(id))
    assert.ok(!html.includes('dsa-original'))
    assert.ok(html.includes('admin'))
    assert.ok(html.includes('gd_distribucion'))
    assert.ok(html.includes('Actualizar bandeja'))
    assert.ok(html.includes('Registro en Alfresco'))
    assert.ok(!html.includes('Fecha de envío'))
    assert.ok(html.includes('PDF registrado sin contenido'))
    assert.ok(!html.includes('DSA_T'), 'dispatcher is not substituted for creator')
    const mine = render(inbox, { activePanel: 'mis-documentos' })
    assert.ok(mine.includes('dti-original'))
    assert.ok(!mine.includes('dti-legacy'))
    const emptyDSA = render({ documents: [], loading: false, error: '' }, { office: { userId: 'DSA_T' }, inbox: { documents: inbox.documents } })
    assert.ok(!emptyDSA.includes('dti-original'))
    assert.ok(emptyDSA.includes('No hay documentos emitidos'))
    assert.ok(render({ documents: [], error: 'ACL failed' }).includes('ACL failed'))
    snapshot = { ...snapshot, documentErrors: [{ documentId: 'denied', status: 403 }] }
    assert.ok(render(await getEmittedDocuments()).includes('La lista es parcial'))
    status = 403
    await assert.rejects(getEmittedDocuments(), /autorización/)
  } finally { globalThis.fetch = realFetch; await server.close() }
})
