import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

test('official form restores same key and parameters after reload, including a previous academic year, without reserving a number', async () => {
  const previous = globalThis.window
  const pending = { uncertain: true, official: true, requestKey: 'same-original-key', officialParameters: {
    recipientDependencyId: 'dti', recipientUnitId: 'dti-direccion', recipientPositionId: 'dti-puesto-direccion',
    documentType: 'Oficio', documentPeriod: '2025 - II', subject: 'Original subject', description: 'Original description', priority: 'Normal',
  } }
  globalThis.window = { sessionStorage: { getItem: () => JSON.stringify(pending) } }
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  try {
    const { DocumentForm } = await server.ssrLoadModule('/src/components/DocumentForm.jsx')
    const html = renderToStaticMarkup(createElement(DocumentForm, { user: { userId: 'fixture_director_a', roleId: 'director-dsa', issuerCode: 'DSA' }, allowAlfrescoUpload: true }))
    assert.ok(html.includes('La emisión oficial está deshabilitada'))
    assert.match(html, /<button[^>]*disabled=""[^>]*type="submit"/)
    assert.ok(html.includes('same-original-key'))
    assert.ok(html.includes('Original subject'))
    assert.ok(html.includes('Original description'))
    assert.match(html, /value="2025 - II" selected=""/)
    assert.ok(html.includes('Conciliar emisión pendiente'))
    assert.ok(html.includes('Se determina al emitir'))
  } finally {
    await server.close()
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})
