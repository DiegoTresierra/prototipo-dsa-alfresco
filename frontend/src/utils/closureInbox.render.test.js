import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

test('actual closure API mapping renders MET, blocked, indeterminate and closed interventions, not Emitidos', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  const previous = globalThis.fetch
  const documents = ['MET', 'BLOCKED', 'INDETERMINATE', 'CLOSED'].map((state, i) => {
    const id = `original-${i}`
    return { id, name: `${id}.pdf`, properties: { 'cm:title': `Asunto ${state}` }, closure: {
      key: `${id}:dsa`, dependency: 'dsa', responsibleUserIds: ['staff-fixture'], closed: state === 'CLOSED',
      category: state === 'CLOSED' ? 'CERRADAS' : state === 'MET' ? 'APTAS' : 'PENDIENTES',
      ...(state === 'CLOSED' ? { closedAt: '2026-11-23T15:00:00Z', closedBy: 'direction-fixture', closureProcessId: 'real-fixture',
        closureReceipt: { schemaVersion: 2, executionMode: 'ALFRESCO', documentId: id, dependency: 'dsa' } } : {}),
      compliance: state === 'CLOSED' ? 'MET' : state, writesEnabled: false, canClose: false,
      evaluation: { documentId: id, blockingReasons: state === 'BLOCKED' ? ['OBLIGATIONS_PENDING'] : [], summary: { pending: state === 'BLOCKED' ? 1 : 0 } } } }
  })
  let status = 200
  globalThis.fetch = async url => {
    assert.equal(url, '/api/documents/closure')
    return Response.json({ source: 'alfresco', semantics: 'dependency-closure-interventions', dependency: 'dsa', documents, documentErrors: [], complete: true,
      counts: { APTAS: 1, PENDIENTES: 2, CERRADAS: 1 } }, { status })
  }
  try {
    const { getClosureInbox } = await server.ssrLoadModule('/src/api/alfresco.js')
    const { ClosureInboxView } = await server.ssrLoadModule('/src/components/ClosureInbox.jsx')
    const inbox = await getClosureInbox()
    const render = extra => renderToStaticMarkup(createElement(ClosureInboxView, { allowed: true, inbox, ...extra }))
    const html = render()
    for (const text of ['Asunto MET', 'Aptas para cierre (1)', 'Pendientes (2)', 'Cerradas (1)', 'Abrir y evaluar', 'UUID: original-0']) assert.ok(html.includes(text))
    const pending = render({ initialCategory: 'PENDIENTES' })
    for (const text of ['Asunto BLOCKED', 'Asunto INDETERMINATE', 'OBLIGATIONS_PENDING', 'Indeterminada']) assert.ok(pending.includes(text))
    const closed = render({ initialCategory: 'CERRADAS' })
    assert.ok(closed.includes('Cierre real verificado')); assert.ok(closed.includes('direction-fixture'))
    const partial = render({ inbox: { ...inbox, complete: false } })
    assert.ok(!partial.includes('Pendientes (2)')); assert.ok(partial.includes('Información parcial'))
    assert.ok(!html.includes('Cerrar intervención'))
    assert.ok(!render({ allowed: false }).includes('Asunto MET'))
    assert.ok(render({ inbox: { documents: [], error: 'Lectura incompleta' } }).includes('Lectura incompleta'))
    assert.ok(!render({ inbox: { documents: [], error: 'Lectura incompleta' } }).includes('No hay intervenciones'))
    status = 403; await assert.rejects(getClosureInbox())
  } finally { globalThis.fetch = previous; await server.close() }
})

test('official HTTP client accepts own issuance with no fabricated receipt and rejects inconsistent delivery', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  const previous = globalThis.fetch
  const fields = { requestKey: 'fixture-key', title: 'Own document', description: 'Fixture', documentType: 'Oficio', documentPeriod: '2026 - II', priority: 'Normal', recipientDependency: '', receiptCategory: '' }
  let receivedEntry = null
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/documents/official-emissions'); assert.equal(options.method, 'POST')
    assert.equal(options.headers['X-CSRF-Token'], 'fixture-csrf')
    assert.equal(options.body.get('recipientDependency'), '')
    assert.equal(options.body.get('documentCode'), null)
    return Response.json({ officialEmission: true, distributed: false, emittedEntry: { id: 'official-fixture' }, receivedEntry })
  }
  try {
    const { emitOfficialDocument } = await server.ssrLoadModule('/src/api/alfresco.js')
    const file = new Blob(['%PDF-1.7 fixture'], { type: 'application/pdf' }); file.name = 'fixture.pdf'
    assert.equal((await emitOfficialDocument(file, fields, 'fixture-csrf')).receivedEntry, null)
    receivedEntry = { id: 'official-fixture' }; await assert.rejects(emitOfficialDocument(file, fields, 'fixture-csrf'), /verificar/)
  } finally { globalThis.fetch = previous; await server.close() }
})

test('existing official response has its own composer; active Head/Specialist can reuse without a new response issuance action', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  try {
    const { ResponseComposer } = await server.ssrLoadModule('/src/components/ResponseComposer.jsx')
    const { AttentionActions } = await server.ssrLoadModule('/src/components/AttentionActions.jsx')
    const html = renderToStaticMarkup(createElement(ResponseComposer, { existingResponseDocumentId: 'official-fixture', csrfToken: 'fixture' }))
    assert.ok(html.includes('UUID del original')); assert.ok(html.includes('Vincular este documento oficial como respuesta'))
    assert.ok(!html.includes('Generar nueva emisión')); assert.ok(html.includes('borrador'))
    const props = { documentId: 'original-fixture', assignment: { id: 'assignment-fixture', status: 'ASIGNADO' }, canLink: true, canIssue: false, canAttend: true }
    assert.ok(renderToStaticMarkup(createElement(AttentionActions, props)).includes('Responder con documento'))
    assert.ok(!renderToStaticMarkup(createElement(AttentionActions, { ...props, assignment: { ...props.assignment, status: 'ATENDIDO' } })).includes('Responder con documento'))
  } finally { await server.close() }
})

test('reverse response HTTP reader accepts only traced responses, not arbitrary annex associations', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  const previous = globalThis.fetch
  const link = { documentId: 'official-fixture', originalDocumentId: 'original-fixture', relationType: 'response', direction: 'response-to-original', node: { id: 'original-fixture' } }
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/documents/assignment-responses?documentId=official-fixture&direction=originals'); assert.equal(options.credentials, 'include')
    return Response.json({ responseDocumentId: 'official-fixture', originals: [link], complete: true })
  }
  try {
    const { getResponseOriginals } = await server.ssrLoadModule('/src/api/alfresco.js')
    assert.equal((await getResponseOriginals('official-fixture')).originals[0].originalDocumentId, 'original-fixture')
    link.relationType = 'annex'; await assert.rejects(getResponseOriginals('official-fixture'))
  } finally { globalThis.fetch = previous; await server.close() }
})
