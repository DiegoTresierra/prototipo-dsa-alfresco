import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { derivePersonCode, getIssuerCode } from './issuerIdentifier.js'
import { File as NodeFile } from 'node:buffer'

test('display names and unit names can never create official institutional codes', () => {
  assert.equal(derivePersonCode('Any Full Name'), '')
  assert.equal(getIssuerCode({ roleId: 'especialista-dsa', dependencyAcronym: 'DSA', unitAcronym: 'UNIT', personCode: 'NAME' }), '')
  assert.equal(getIssuerCode({ verifiedCode: 'DSA' }), 'DSA')
})

test('Jefatura renders legitimate read-only documents separately without attention or derivation controls', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  try {
    const { AssignmentsPage } = await server.ssrLoadModule('/src/pages/AssignmentsPage.jsx')
    const html = renderToStaticMarkup(createElement(AssignmentsPage, { title: 'Institutional', allowAlfresco: true, userId: 'head',
      inbox: { documents: [{ id: 'read-only', subject: 'Authorized knowledge' }], dispatchRecords: [] }, recipientRoles: ['especialista'] }))
    assert.match(html, /Authorized knowledge/)
    assert.match(html, /Lectura institucional sin encargo/)
    assert.ok(!html.includes('Marcar atendido'))
    assert.ok(!html.includes('Confirmar despacho'))
  } finally { await server.close() }
})

test('generic frontend contract sends a business type and exact recipient selection without privileged properties', async () => {
  const realFetch = globalThis.fetch, originalWindow = globalThis.window, originalFile = globalThis.File
  globalThis.File = NodeFile
  globalThis.window = { sessionStorage: { getItem: () => null } }
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  let uncertain = false
  const node = { id: 'generic-document', nodeType: 'cm:content', isFile: true, content: { mimeType: 'application/pdf' }, properties: { 'gd:tipoDocumental': 'Oficio' } }
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      assert.equal(options.headers['X-UAC-Recipient-User'], 'real-target')
      assert.equal(options.headers['X-UAC-Recipient-Dependency'], 'dsa')
      assert.equal(options.headers['X-UAC-Recipient-Role'], 'especialista')
      assert.equal(options.body.get('documentType'), 'Oficio')
      assert.equal(options.body.has('gd:tipoDocumental'), false)
      assert.equal(options.body.has('aspectnames'), false)
      assert.equal(options.body.has('priority'), false)
      assert.equal(options.body.has('documentPeriod'), false)
      return uncertain ? Response.json({ error: 'GENERIC_CREATE_OUTCOME_UNCERTAIN', uncertain: true, emittedNodeId: node.id }, { status: 502 }) : Response.json({ entry: node }, { status: 201 })
    }
    assert.ok(String(url).includes('/nodes/generic-document'))
    return Response.json({ entry: node })
  }
  try {
    const api = await server.ssrLoadModule('/src/api/alfresco.js')
    const fields = { title: 'Title', description: 'Description', documentType: 'Oficio', recipientDependency: 'dsa', recipientFunctionalRole: 'especialista' }
    const file = new NodeFile(['%PDF-1.7\nfixture'], 'fixture.pdf', { type: 'application/pdf' })
    const created = await api.uploadPdfToFolder('target-folder', file, fields, 'csrf-fixture', 'real-target')
    assert.equal(created.properties['gd:tipoDocumental'], 'Oficio')
    assert.equal((await api.getAuthorizedDocument(created.id)).documentType, 'Oficio')
    uncertain = true
    await assert.rejects(api.uploadPdfToFolder('target-folder', file, fields, 'csrf-fixture', 'real-target'), (error) => error.uncertain === true && error.emittedNodeId === node.id)
    const { DocumentForm } = await server.ssrLoadModule('/src/components/DocumentForm.jsx')
    const html = renderToStaticMarkup(createElement(DocumentForm, { user: { userId: 'head', roleId: 'jefe-unidad-dsa' }, allowAlfrescoUpload: true }))
    assert.ok(html.match(/<select[^>]*name="documentType"[^>]*>/)[0].includes('required'))
    // Generic API remains compatible, but the institutional form now uses own
    // official emission for Head/Specialist, with the existing official inputs.
    for (const name of ['documentPeriod', 'priority']) assert.ok(html.match(new RegExp('<select[^>]*name="' + name + '"[^>]*>'))[0].includes('required'))
  } finally {
    globalThis.fetch = realFetch
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow
    if (originalFile === undefined) delete globalThis.File; else globalThis.File = originalFile
    await server.close()
  }
})
