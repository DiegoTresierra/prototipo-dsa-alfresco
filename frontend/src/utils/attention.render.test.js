import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { assignmentRows, canDeriveAssignment } from './assignmentViews.js'

test('actual attention controls, emission permissions, original DTI identity and dispatch DSA are independently rendered', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
  try {
    const { AttentionActions } = await server.ssrLoadModule('/src/components/AttentionActions.jsx')
    const { DocumentIdentitySummary } = await server.ssrLoadModule('/src/components/DocumentIdentitySummary.jsx')
    const render = (component, props) => renderToStaticMarkup(createElement(component, props))
    const active = { id: 'own', userId: 'head', functionalRole: 'jefe-unidad', status: 'ASIGNADO' }
    const head = render(AttentionActions, { documentId: 'original', assignment: active, canAttend: true, canIssue: false })
    assert.ok(head.includes('Marcar como atendido'))
    assert.ok(!head.includes('Responder con documento'))
    const director = render(AttentionActions, { documentId: 'original', assignment: { ...active, userId: 'director', functionalRole: 'direccion' }, canAttend: true, canIssue: true })
    assert.ok(director.includes('Responder con documento'))
    const attended = { ...active, status: 'ATENDIDO', attendedAt: '2026-11-17T12:00:00Z', attendedByUserId: 'head' }
    const history = render(AttentionActions, { documentId: 'original', assignment: attended, canAttend: true })
    assert.ok(history.includes('ATENDIDO'))
    assert.ok(!history.includes('Marcar como atendido'))
    assert.ok(history.includes('Consultar respuestas relacionadas'))
    assert.equal(assignmentRows([{ recipients: [attended] }], 'head').length, 1)
    assert.equal(canDeriveAssignment(['especialista'], attended, 'head'), false)
    const identity = render(DocumentIdentitySummary, { identity: { originalDependency: 'DTI', createdByUserId: 'DTI_T' }, dispatch: { senderUserId: 'DSA_T', senderDependency: 'dsa' } })
    assert.ok(identity.includes('Emisor documental original:</b> DTI'))
    assert.ok(identity.includes('Despachado por:</b> DSA_T'))
    assert.ok(identity.includes('DTI_T'))
    const unknown = render(DocumentIdentitySummary, { identity: { createdByUserId: 'DTI_T', emittedFolderEvidence: ['DTI'] }, dispatch: { senderUserId: 'DSA_T', senderDependency: 'dsa' } })
    assert.ok(unknown.includes('No registrado'))
    assert.ok(unknown.includes('Ubicación verificada en Emitidos'))
  } finally { await server.close() }
})
