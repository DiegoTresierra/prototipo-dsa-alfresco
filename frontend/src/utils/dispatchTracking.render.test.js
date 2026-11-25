import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dispatchTrackingRows } from './dispatchTracking.js'

const unitId = '20000000-0000-4000-8000-000000000001'
const documents = [{ id: 'original', subject: 'Oficio recibido' }]
const records = [
  { documentId: 'original', createdAt: '2026-11-25T10:00:00Z', persistence: 'alfresco',
    recipients: [{ id: 'a-current', userId: 'head', displayName: 'Jefatura de prueba', unitId,
      unit: { id: unitId, name: 'Unidad verificada' }, status: 'ASIGNADO' }] },
  { documentId: 'original', createdAt: '2026-11-24T10:00:00Z', persistence: 'alfresco',
    recipients: [{ id: 'a-previous', userId: 'head', unit: { id: unitId, name: 'Etiqueta provisional' }, status: 'ATENDIDO' }] },
]

test('documentary tracking keeps each assignment and never infers its unit from historical labels', () => {
  const rows = dispatchTrackingRows([...records, { ...records[0], persistence: 'local' }], documents)
  assert.deepEqual(rows.map(({ id, unitName, active }) => ({ id, unitName, active })), [
    { id: 'a-current', unitName: 'Unidad verificada', active: true },
    { id: 'a-previous', unitName: 'Unidad no registrada', active: false },
  ])
})

test('the Director tracking view renders persisted units, responsible users, dates and separate histories', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] } })
  try {
    const { DirectorWorkspacePage } = await server.ssrLoadModule('/src/pages/DirectorWorkspacePage.jsx')
    const html = renderToStaticMarkup(createElement(DirectorWorkspacePage, { activePanel: 'seguimiento', title: 'Seguimiento',
      inbox: { documents }, allowAlfresco: true, dispatchRecords: records }))
    assert.match(html, /Oficio recibido/)
    assert.match(html, /Unidad verificada/)
    assert.match(html, /Jefatura de prueba/)
    assert.match(html, /Asignado/)
    assert.match(html, /Fecha del despacho/)
    assert.match(html, /Unidad no registrada/)
    assert.doesNotMatch(html, /Etiqueta provisional/)
    const { DispatchAssignmentDetails } = await server.ssrLoadModule('/src/components/DispatchTracking.jsx')
    const detail = renderToStaticMarkup(createElement(DispatchAssignmentDetails, { rows: dispatchTrackingRows(records, documents) }))
    assert.match(detail, /Encargos activos[\s\S]+Unidad verificada[\s\S]+Historial de encargos[\s\S]+Atendido/)
  } finally { await server.close() }
})
