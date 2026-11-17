import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Exact response reported in Network by Dirección DSA, including unit: null.
const response = {
  recipients: [
    { id: '021200931d@uandina.edu.pe', displayName: 'DIEGO ANDRES TRESIERRA ZAMORA', dependency: 'dsa', functionalRole: 'especialista', unit: null },
    { id: 'JEFE_UNIDAD_DSA_1', displayName: 'JEFE_UNIDAD_DSA_1', dependency: 'dsa', functionalRole: 'jefe-unidad', unit: null },
    { id: 'JEFE_UNIDAD_DSA_2', displayName: 'JEFE_UNIDAD_DSA_2', dependency: 'dsa', functionalRole: 'jefe-unidad', unit: null },
  ],
  allowedRecipientRoles: ['jefe-unidad', 'especialista'],
}
let server
let DirectorPage
let DispatchPanel
let EspecialistaPage
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] },
  })
  ;({ DirectorPage } = await server.ssrLoadModule('/src/pages/DirectorPage.jsx'))
  ;({ DispatchPanel } = await server.ssrLoadModule('/src/components/DispatchPanel.jsx'))
  ;({ EspecialistaPage } = await server.ssrLoadModule('/src/pages/EspecialistaPage.jsx'))
})
after(async () => { await server?.close() })

const document = { id: 'original-uuid', subject: 'Documento de prueba', attachmentName: 'oficio.pdf', mimeType: 'application/pdf' }
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props))

test('Dirección DSA renders all three Network recipients as dropdown options with unit null', () => {
  const html = render(DirectorPage, {
    title: 'Recibidos DSA', allowAlfresco: true, canDispatch: true,
    inbox: { documents: [document] }, recipients: response.recipients,
    recipientRoles: response.allowedRecipientRoles, onPersonalAttentionChange: () => {}, onDispatch: () => {},
  })
  const select = html.match(/<select[^>]*aria-label="Asignar responsable a Documento de prueba"[^>]*>([\s\S]*?)<\/select>/)?.[1]
  assert.ok(select, 'the row dropdown must exist')
  for (const recipient of response.recipients) {
    assert.ok(select.includes(`value="dispatch:${recipient.id}"`), `missing option ${recipient.id}`)
    assert.ok(select.includes(recipient.displayName), `missing label ${recipient.displayName}`)
  }
  assert.equal((select.match(/value="dispatch:/g) || []).length, 3)
  assert.ok(select.includes('Para mí'), 'personal attention remains separate')
})

test('shared derivation form keeps the selected row recipient and allows multiple equivalent recipients', () => {
  const html = render(DispatchPanel, {
    document, recipients: response.recipients, allowedRecipientRoles: response.allowedRecipientRoles,
    initialRecipientIds: ['JEFE_UNIDAD_DSA_1'], onDispatch: () => {},
  })
  assert.equal((html.match(/type="checkbox"/g) || []).length, 3)
  assert.equal((html.match(/checked=""/g) || []).length, 1)
})

test('successive persisted dispatches show every responsible user even when they share one unit', () => {
  const unit = { code: 'fixture', name: 'Unidad de prueba' }
  const html = render(DirectorPage, {
    title: 'Recibidos', allowAlfresco: true, inbox: { documents: [document] },
    dispatchRecords: [
      { persistence: 'alfresco', documentId: document.id, recipients: [{ userId: 'head', displayName: 'Jefatura responsable', status: 'ASIGNADO', unit }] },
      { persistence: 'alfresco', documentId: document.id, recipients: [{ userId: 'staff', displayName: 'Especialista responsable', status: 'ASIGNADO', unit }] },
    ],
  })
  assert.ok(html.includes('Jefatura responsable'))
  assert.ok(html.includes('Especialista responsable'))
})

test('dropdown marks only persisted active recipients, keeps annulled/unassigned candidates and separates Para mi', () => {
  const records = [
    { persistence: 'alfresco', documentId: document.id, status: 'ASIGNADO', recipients: [
      { userId: response.recipients[0].id, status: 'ASIGNADO' },
      { userId: response.recipients[1].id, status: 'ANULADO' },
      { userId: response.recipients[2].id, status: 'DESPACHADO' },
    ] },
    { persistence: 'local', documentId: document.id, recipients: [{ userId: response.recipients[1].id, status: 'ASIGNADO' }] },
  ]
  for (let reload = 0; reload < 2; reload++) {
    const html = render(DirectorPage, {
      title: 'Recibidos', allowAlfresco: true, canDispatch: true, inbox: { documents: [document] },
      recipients: response.recipients, recipientRoles: response.allowedRecipientRoles,
      dispatchRecords: structuredClone(records), attentionIds: [document.id], onPersonalAttentionChange: () => {},
    })
    const options = [...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)]
    for (const [index, recipient] of response.recipients.entries()) {
      const option = options.find((match) => match[1].includes(`dispatch:${recipient.id}`))
      assert.ok(option, 'already assigned users remain selectable; no duplicate rule changed')
      assert.equal(option[2].includes('Ya asignado'), index !== 1)
      assert.ok(!option[1].includes('disabled'))
    }
    const personal = options.find((match) => match[1].includes('value="self"'))
    assert.ok(!personal[2].includes('Ya asignado'))
    assert.ok(html.includes('document-table__row--assigned'))
    assert.ok(html.includes('--assignment-background:linear-gradient'))
    assert.ok(html.includes('/ 0.06)'))
    assert.equal((html.match(/data-user-id=/g) || []).length, 2)
  }
})

test('local provisional records and personal attention alone never create an official visual indicator', () => {
  const html = render(DirectorPage, {
    title: 'Recibidos', allowAlfresco: true, inbox: { documents: [document] }, attentionIds: [document.id],
    dispatchRecords: [{ persistence: 'local', documentId: document.id, recipients: [{ userId: 'head', status: 'ASIGNADO' }] }],
  })
  assert.ok(!html.includes('document-assignment-markers'))
  assert.ok(!html.includes('document-table__row--assigned'))
})

test('Jefatura only renders specialists even when passed the complete Dirección response', () => {
  const html = render(DispatchPanel, {
    document, recipients: response.recipients, allowedRecipientRoles: ['especialista'],
    originAssignmentId: 'own-assignment', onDispatch: () => {},
  })
  assert.ok(html.includes('DIEGO ANDRES TRESIERRA ZAMORA'))
  assert.ok(!html.includes('JEFE_UNIDAD_DSA_1'))
  assert.ok(!html.includes('JEFE_UNIDAD_DSA_2'))
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1)
})

test('Especialista has an assignment inbox with no derivation action', () => {
  const html = render(EspecialistaPage, {
    title: 'Mis asignaciones', activePanel: 'mis-asignaciones', allowAlfresco: true,
    userId: response.recipients[0].id, recipientRoles: response.allowedRecipientRoles, recipients: response.recipients,
    inbox: { documents: [document], dispatchRecords: [{ id: 'dispatch', documentId: document.id, senderUserId: 'director', recipients: [{ id: 'assignment', userId: response.recipients[0].id, functionalRole: 'especialista', status: 'ASIGNADO' }] }] },
  })
  assert.ok(html.includes('Documento de prueba'))
  assert.ok(!html.includes('Derivar'))
  assert.ok(!html.includes('Confirmar derivación'))
})
