// Real compiled React app in Edge; API fixtures only. Never contacts Alfresco.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const artifacts = path.join(root, 'artifacts', 'dispatch-read')
const edge = process.env.DISPATCH_TEST_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
assert.ok(fs.existsSync(edge), 'Edge executable required (or set DISPATCH_TEST_EDGE_PATH)')
assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Run npm run build first')
fs.mkdirSync(artifacts, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-browser-'))
const id = '11111111-2222-4333-8444-2a29efcb482b'
const people = [
  { id: 'JEFE_UNIDAD_DSA_1', displayName: 'JEFE_UNIDAD_DSA_1', functionalRole: 'jefe-unidad', dependency: 'dsa', unit: null },
  { id: 'JEFE_UNIDAD_DSA_2', displayName: 'JEFE_UNIDAD_DSA_2', functionalRole: 'jefe-unidad', dependency: 'dsa', unit: null },
  { id: 'specialist.fixture.1@example.invalid', displayName: 'Especialista DSA', functionalRole: 'especialista', dependency: 'dsa', unit: null },
]
const node = { id, name: 'oficio-prueba.pdf', isFile: true, nodeType: 'cm:content', parentId: 'dsa-attention',
  content: { mimeType: 'application/pdf', sizeInBytes: 500 }, aspectNames: ['gd:tramite'],
  createdAt: '2026-11-17T12:00:00Z', createdByUser: { id: 'DTI_T', displayName: 'Dirección DTI' },
  properties: { 'cm:title': 'Documento de prueba: responsabilidades equivalentes', 'gd:dependenciaOrigen': 'DTI', 'cm:author': 'Home' } }
const record = (key, recipients) => ({ id: key, documentId: id, senderUserId: 'DSA_T', senderRole: 'direccion', senderDependency: 'dsa',
  requestKey: key, originAssignmentId: null, instruction: 'Instrucción de prueba local', priority: 'Normal', createdAt: node.createdAt,
  status: 'ASIGNADO', recipients: recipients.map((person) => ({ ...person, id: `${key}:${person.id}`, userId: person.id, documentId: id,
    dispatchId: key, status: 'ASIGNADO', createdAt: node.createdAt })) })
// Same response shape and active recipient observed by GET in DEV; content is synthetic.
const records = [record('initial-fixture', [people[0]])]
const counters = { assignments: 0, directory: 0, children: 0, closureInbox: 0, mockDispatches: 0, mockAttentions: 0, officialRequests: 0, officialCreated: 0, emitted: 0 }
let officialFixture
let closureEnabled = false, closureClosed = false, closurePosts = 0
const session = { authenticated: true, authorizationStatus: 'active', roleId: 'director-dsa', functionalRole: 'direccion', dependency: 'DSA',
  alfresco: { id: 'DSA_T', displayName: 'Dirección DSA' }, user: { id: 'DSA_T', name: 'Dirección DSA' },
  capabilities: ['documents:read', 'documents:write'], dispatchRecipientRoles: ['jefe-unidad', 'especialista'], csrfToken: 'local-fixture-only',
  canAttendAssignments: true, canIssueInstitutionalResponse: true, canLinkOfficialResponse: true }
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)) }
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/documents/closure') {
      if (request.method === 'GET' && !url.searchParams.has('documentId')) {
        counters.closureInbox++
        const row = (documentId, compliance, reasons, category) => ({ ...node, id: documentId, closure: {
          key: `${documentId}:dsa`, dependency: 'dsa', responsibleUserIds: ['head-fixture'], compliance, category,
          closed: documentId === id && closureClosed, writesEnabled: false, canClose: false,
          ...(documentId === id && closureClosed ? { closedAt: '2026-11-23T15:00:00Z', closedBy: 'direction-fixture', closureProcessId: 'closure-fixture',
            closureReceipt: { schemaVersion: 2, executionMode: 'ALFRESCO', documentId, dependency: 'dsa' } } : {}),
          evaluation: { documentId, scope: { dependency: 'dsa' }, blockingReasons: reasons, summary: { pending: compliance === 'BLOCKED' ? 1 : 0, attended: 2 } } } })
        return json({ source: 'alfresco', semantics: 'dependency-closure-interventions', dependency: 'dsa', complete: true,
          counts: { APTAS: closureClosed ? 0 : 1, PENDIENTES: 2, CERRADAS: closureClosed ? 1 : 0 }, documentErrors: [], documents: [
            row(id, 'MET', [], closureClosed ? 'CERRADAS' : 'APTAS'),
            row('00000000-0000-4000-8000-000000000071', 'BLOCKED', ['OBLIGATIONS_PENDING'], 'PENDIENTES'),
            row('00000000-0000-4000-8000-000000000072', 'INDETERMINATE', ['EVIDENCE_INCOMPLETE'], 'PENDIENTES'),
          ] })
      }
      if (request.method === 'POST') {
        let raw = ''; for await (const chunk of request) raw += chunk
        const input = JSON.parse(raw)
        assert.equal(request.headers['x-csrf-token'], session.csrfToken)
        assert.deepEqual(Object.keys(input).sort(), ['documentId', 'expectedEnvelopeRevision', 'reason', 'requestKey'])
        if (!closureEnabled) return json({ error: 'CLOSURE_WRITES_DISABLED' }, 503)
        closureClosed = true; closurePosts++; return json({ process: { documentId: id, executionMode: 'ALFRESCO', state: 'CERRADA' } })
      }
      return json({ evaluation: { documentId: id, envelopeRevision: 10, preliminaryCompliance: 'MET', blockingReasons: [], knowledgeSummary: { exclusivelyKnowledge: false } },
        writesEnabled: closureEnabled, closed: closureClosed, canClose: closureEnabled && !closureClosed, pendingOperation: null })
    }
    if (url.pathname === '/api/auth/me') return json({ ...session, institutionalDocumentCode: session.functionalRole === 'direccion' ? session.dependency : '', unitVerified: false })
    if (url.pathname === '/api/auth/status') return json({ basicAuthEnabled: true })
    if (url.pathname === '/api/documents/emitted') {
      counters.emitted++
      const dependency = session.dependency
      const documents = dependency === 'DTI' ? [{ ...node, parentId: 'dti-emitted',
        emittedOrigin: { dependency: 'DTI', evidence: 'gd:dependenciaOrigen', declared: true } }] : []
      return json({ source: 'alfresco', semantics: 'institutional-originals', dependency,
        folderId: dependency.toLowerCase() + '-emitted', documents, documentErrors: [] })
    }
    if (url.pathname === '/api/documents/official-emissions' && request.method === 'POST') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers['content-type'] } }).formData()
      assert.equal(form.has('gd:numero'), false)
      assert.equal(form.has('documentCode'), false)
      const signature = JSON.stringify([form.get('title'), form.get('description'), form.get('priority'), await form.get('filedata').text()])
      counters.officialRequests++
      if (!officialFixture) {
        officialFixture = { requestKey: form.get('requestKey'), signature }
        counters.officialCreated++
        return json({ error: 'NUMBERING_RESULT_UNCERTAIN', uncertain: true }, 502)
      }
      assert.equal(form.get('requestKey'), officialFixture.requestKey, 'uncertain browser retry preserves original key')
      assert.equal(signature, officialFixture.signature)
      const entry = { ...node, id: 'official-response', parentId: 'dsa-emitted', createdByUser: { id: 'DSA_T' },
        properties: { 'cm:title': form.get('title'), 'gd:numero': '1', 'gd:codigoDocumental': 'DSA', 'gd:cicloDocumental': 2026 } }
      return json({ officialEmission: true, emittedEntry: entry, receivedEntry: entry }, 201)
    }
    if (url.pathname === '/api/documents/assignments/response' && request.method === 'POST') return json({ persistence: 'alfresco', documentId: id, response: { documentId: 'official-response' } })
    if (url.pathname === '/api/directory/office-inboxes') return json({ folders: { porAtender: 'dsa-attention', porConocimiento: 'dsa-knowledge' } })
    if (url.pathname === '/api/directory/dispatch-recipients') { counters.directory++; return json({ recipients: people, allowedRecipientRoles: session.dispatchRecipientRoles }) }
    if (url.pathname === '/api/documents/dispatches') {
      counters.assignments++
      return json({ persistence: 'alfresco', dispatches: session.functionalRole === 'direccion' ? records : records.filter((record) => record.recipients.some((assignment) => assignment.userId === session.alfresco.id)),
        sentDispatches: records.filter((record) => record.senderUserId === session.alfresco.id), documents: [node], documentErrors: [] })
    }
    if (url.pathname.endsWith('/children')) {
      counters.children++
      return json({ list: { entries: url.pathname.includes('dsa-attention') ? [{ entry: node }] : [], pagination: { hasMoreItems: false } } })
    }
    if (url.pathname.endsWith('/content')) { response.writeHead(200, { 'Content-Type': 'application/pdf' }); return response.end('%PDF-1.7\n%local browser fixture') }
    if (url.pathname === '/api/documents/response-proposals') return json({ persistence: 'alfresco', writesEnabled: false, proposals: [
      { processId: 'mock-process', status: 'AVAILABLE', title: 'Propuesta verificada', state: 'BORRADOR', revision: 1, versions: ['1.0'] },
      { status: 'INACCESSIBLE' }, { status: 'INVALID_VERSION' },
    ] })
    if (url.pathname === '/api/documents/proposal-version-content') { response.writeHead(200, { 'Content-Type': 'application/pdf' }); return response.end('%PDF-1.7\n%verified proposal fixture') }
    if (url.pathname === '/api/documents/response-candidates') return json({ documents: [] })
    if (url.pathname === '/api/documents/assignment-responses') return json({ responses: [], summary: { attended: counters.mockAttentions, pending: 3 - counters.mockAttentions, readyForClosureReview: false, formalClosureAllowed: false } })
    if (url.pathname === '/api/documents/assignments/attend' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      const dispatch = records.find((record) => record.recipients.some((entry) => entry.id === input.assignmentId))
      const assignment = dispatch?.recipients.find((entry) => entry.id === input.assignmentId)
      if (!assignment || assignment.userId !== session.alfresco.id) return json({ error: 'ATTENTION_ASSIGNMENT_NOT_OWNED' }, 403)
      assignment.status = 'ATENDIDO'; assignment.attendedByUserId = assignment.userId; assignment.attendedAt = new Date().toISOString()
      counters.mockAttentions++
      return json({ dispatch, assignment, persistence: 'alfresco' })
    }
    if (url.pathname === '/api/documents/dispatch' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      const created = record(input.requestKey, people.filter((person) => input.recipientUserIds.includes(person.id)))
      records.push(created)
      counters.mockDispatches++
      return json({ persistence: 'alfresco', dispatch: created }, 201)
    }
    return json({ error: 'UNEXPECTED_LOCAL_TEST_ROUTE' }, 404)
  }
  let local = decodeURIComponent(url.pathname).replace(/^\/prototipo-dsa-alfresco\/?/, '') || 'index.html'
  local = path.resolve(dist, local)
  if (!local.startsWith(dist + path.sep) || !fs.existsSync(local)) { response.writeHead(404); return response.end() }
  response.writeHead(200, { 'Content-Type': local.endsWith('.js') ? 'text/javascript' : local.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' })
  fs.createReadStream(local).pipe(response)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let spawnError
browser.on('error', (error) => { spawnError = error })
let socket
const pending = new Map()
let sequence = 0
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(operation, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError
    const result = await operation()
    if (result) return result
    await pause(100)
  }
  throw new Error(`Timeout: ${description}`)
}
function command(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 8000)
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result?.value
}
const clickText = (text) => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!b)throw Error('button missing');b.click();return true})()`)
const labels = () => evaluate(`(()=>{const s=document.querySelector('select[aria-label^="Asignar responsable"]');return s?[...s.options].map(o=>({value:o.value,text:o.textContent})):null})()`)
async function waitAssigned(count) { return until(async () => { const values = await labels(); return values?.filter((option) => option.text.includes('Ya asignado')).length === count }, `${count} assigned options`) }
async function waitIdle() { return until(() => evaluate("Boolean(document.querySelector('.received-inbox__refresh button')) && !document.querySelector('.received-inbox__refresh button').disabled"), 'inbox refresh settled') }
try {
  const activePort = path.join(profile, 'DevToolsActivePort')
  await until(() => fs.existsSync(activePort), 'Edge debugger')
  const port = fs.readFileSync(activePort, 'utf8').split('\n')[0]
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (item) message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result) }
    // Prohibit every HTTP request outside the isolated local test server.
    if (message.method === 'Fetch.requestPaused') {
      const allowed = message.params.request.url.startsWith(origin + '/')
      command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {})
    }
  })
  await command('Fetch.enable', { patterns: [{ urlPattern: 'http*' }] })
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url: origin + '/prototipo-dsa-alfresco/' })
  await until(() => evaluate("Boolean(document.querySelector('.sidebar__nav'))"), 'React application')
  await clickText('Documentos recibidos')
  await waitAssigned(1)
  await waitIdle()
  const before = counters.assignments
  await clickText('Actualizar bandeja')
  await until(() => counters.assignments > before, 'refresh queries assignments')
  await until(() => evaluate("!document.querySelector('.received-inbox__refresh button')?.disabled"), 'refresh complete')
  assert.equal(counters.assignments - before, 1, 'one assignment query per manual refresh')
  const beforeSelection = counters.assignments
  await evaluate(`(()=>{const s=document.querySelector('select[aria-label^="Asignar responsable"]');s.value='dispatch:JEFE_UNIDAD_DSA_2';s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until(() => evaluate("Boolean(document.querySelector('.dispatch-panel textarea'))"), 'dispatch confirmation form')
  assert.equal(counters.assignments, beforeSelection, 'opening the PDF does not scan assignments again')
  await evaluate(`(()=>{[...document.querySelectorAll('.dispatch-panel__recipient')].find(x=>x.textContent.includes('Especialista DSA')).querySelector('input').click(); const t=document.querySelector('.dispatch-panel textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Prueba de integración local');t.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await clickText('Confirmar derivación')
  await waitAssigned(3)
  assert.equal(counters.mockDispatches, 1)
  await clickText('Cerrar vista previa')
  const visual = await evaluate(`(()=>{const marker=document.querySelector('.document-assignment-markers');const row=marker.closest('tr');return {width:getComputedStyle(marker).width,background:getComputedStyle(row).backgroundImage,segments:[...marker.children].map(x=>({user:x.dataset.userId,color:getComputedStyle(x).backgroundColor,height:x.getBoundingClientRect().height}))}})()`)
  assert.equal(visual.width, '11px')
  assert.equal(new Set(visual.segments.map((segment) => segment.color)).size, 3)
  assert.ok(visual.background.includes('gradient'))
  assert.ok(Math.max(...visual.segments.map((segment) => segment.height)) - Math.min(...visual.segments.map((segment) => segment.height)) < 1)
  await clickText('Inicio')
  await clickText('Documentos recibidos')
  await waitAssigned(3)
  await waitIdle()
  await command('Page.reload', { ignoreCache: true })
  await until(() => evaluate("Boolean(document.querySelector('.sidebar__nav'))"), 'React after reload')
  await clickText('Documentos recibidos')
  await waitAssigned(3)
  await waitIdle()
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.document-assignment-markers i')].map(x=>getComputedStyle(x).backgroundColor)"), visual.segments.map((segment) => segment.color), 'colors survive a complete application reload')
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
    if (width < 500) await until(() => evaluate("document.querySelector('.sidebar').getBoundingClientRect().right <= 1"), 'mobile drawer transition complete')
    await evaluate("window.scrollTo(0,0); document.querySelector('.table-scroll').scrollLeft=0")
    const layout = await command('Page.getLayoutMetrics')
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.max(height, Math.ceil(layout.cssContentSize.height)), scale: 1 } })
    fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(shot.data, 'base64'))
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await evaluate("document.querySelector('.received-inbox__subject').click()")
  await until(() => evaluate("Boolean([...document.querySelectorAll('button')].find(x=>x.textContent==='Responder con documento'))"), 'Dirección response action')
  await clickText('Consultar propuestas')
  await until(() => evaluate("document.body.textContent.includes('Propuesta verificada') && document.body.textContent.includes('Propuesta sin acceso autorizado.') && document.body.textContent.includes('Versión de propuesta inválida.')"), 'proposal statuses from repository')
  assert.equal(await evaluate("Array.from(document.querySelectorAll('section[aria-label=\"Propuestas de respuesta\"] button')).some(b => /crear|presentar|aprobar|emitir/i.test(b.textContent))"), false)
  await clickText('Ver versión 1.0')
  await until(() => evaluate("Boolean(document.querySelector('iframe[title=\"Versión de propuesta\"]'))"), 'authorized proposal version preview')
  await clickText('Cerrar propuesta')
  await clickText('Responder con documento')
  await until(() => evaluate("Boolean([...document.querySelectorAll('button')].find(x=>x.textContent==='Generar nueva emisión'))"), 'response selection')
  await clickText('Generar nueva emisión')
  await until(() => evaluate("document.body.textContent.includes('Respuesta al documento') && Boolean(document.querySelector('form'))"), 'existing emission form with original context')
  assert.equal(counters.mockAttentions, 0, 'opening a response draft cannot complete an obligation')
  await evaluate("const combo=document.querySelector('[role=combobox]'); combo.focus(); combo.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))")
  await until(() => evaluate("Boolean(document.querySelector('.searchable-select__option'))"), 'recipient dependency options')
  await evaluate("document.querySelector('.searchable-select__option').click()")
  const selectOption = async (selector) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,el.options[1].value); el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await selectOption('select[name=documentType]')
  await selectOption('select[name=documentPeriod]')
  await selectOption('select[name=priority]')
  await evaluate("document.querySelector('[name=subject]').value='Respuesta oficial simulada'; document.querySelector('[name=description]').value='Prueba de emision sin atencion automatica'; const dt=new DataTransfer(); dt.items.add(new File(['%PDF-1.7\\nBrowser fixture'],'response.pdf',{type:'application/pdf'})); const file=document.querySelector('input[type=file]'); file.files=dt.files; file.dispatchEvent(new Event('change',{bubbles:true}))")
  await until(() => evaluate("!document.querySelector('[type=submit]').disabled"), 'PDF validation complete')
  await evaluate("document.querySelector('[type=submit]').click()")
  await until(() => evaluate("document.body.textContent.includes('Emision pendiente de conciliacion')"), 'uncertain official emission visible')
  await evaluate("document.querySelector('[type=submit]').click()")
  await until(() => counters.officialRequests === 2 && evaluate("document.body.textContent.includes('Respuesta emitida y vinculada')"), 'same-key official replay and response link')
  assert.equal(counters.officialCreated, 1)
  assert.equal(counters.mockAttentions, 0, 'formal emission and link never attend assignments automatically')
  for (const [userId, role, roleId, menu, capture] of [
    ['JEFE_UNIDAD_DSA_1', 'jefe-unidad', 'jefe-unidad-dsa', 'Documentos recibidos', 'attention-head'],
    ['specialist.fixture.1@example.invalid', 'especialista', 'especialista-dsa', 'Mis asignaciones', 'attention-staff'],
  ]) {
    Object.assign(session, { functionalRole: role, roleId, alfresco: { id: userId }, user: { id: userId, name: userId }, canIssueInstitutionalResponse: false,
      dispatchRecipientRoles: role === 'jefe-unidad' ? ['especialista'] : [] })
    await command('Page.reload', { ignoreCache: true })
    await until(() => evaluate("Boolean(document.querySelector('.sidebar__nav'))"), 'assignment user application')
    await clickText(menu)
    await until(() => evaluate("Boolean(document.querySelector('.received-inbox__subject'))"), 'own assignment')
    await evaluate("document.querySelector('.received-inbox__subject').click()")
    await until(() => evaluate("Boolean([...document.querySelectorAll('button')].find(x=>x.textContent==='Marcar como atendido'))"), 'attention action')
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some(x=>x.textContent==='Responder con documento')"), true)
    await clickText('Responder con documento')
    await until(() => evaluate("Boolean(document.querySelector('select option[value=\"\"]'))"), 'official reuse selector')
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some(x=>x.textContent==='Generar nueva emisión')"), false)
    assert.ok(await evaluate("document.body.textContent.includes('Emisor documental original: DTI') && document.body.textContent.includes('Despachado por: DSA_T')"))
    await clickText('Marcar como atendido')
    await until(() => evaluate("document.body.textContent.includes('Mi asignación: ATENDIDO')"), 'completed own obligation')
    assert.ok(records.flatMap((record) => record.recipients).some((assignment) => assignment.userId !== userId && assignment.status === 'ASIGNADO'), 'other equivalent responsibilities remain pending')
    await command('Page.reload', { ignoreCache: true })
    await until(() => evaluate("Boolean(document.querySelector('.sidebar__nav'))"), 'history after application reload')
    await clickText(menu)
    await until(() => evaluate("Boolean(document.querySelector('.received-inbox__subject'))"), 'attended history retained')
    assert.ok(await evaluate("document.body.textContent.includes('ATENDIDO')"))
    const shot = await command('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(artifacts, `${capture}.png`), Buffer.from(shot.data, 'base64'))
  }
  Object.assign(session, { functionalRole: 'direccion', roleId: 'director-dti', dependency: 'DTI', alfresco: { id: 'DTI_T' }, user: { id: 'DTI_T', name: 'Direction DTI' },
    canIssueInstitutionalResponse: true, dispatchRecipientRoles: ['jefe-unidad', 'especialista'] })
  await evaluate("localStorage.removeItem('gestion-documental-dsa.alfresco-confirmed-documents.v1')")
  await command('Page.reload', { ignoreCache: true })
  await until(() => evaluate("Boolean(document.querySelector('.sidebar__nav'))"), 'DTI workspace')
  await clickText('Emitidos')
  await until(() => evaluate("Boolean(document.querySelector('.received-inbox__subject')) && !document.querySelector('.received-inbox__refresh button').disabled"), 'repository emitted document without browser cache')
  assert.ok(await evaluate("document.body.textContent.includes('Origen: DTI') && document.body.textContent.includes('Registro en Alfresco')"))
  const beforeEmittedRefresh = counters.emitted
  await clickText('Actualizar bandeja')
  await until(() => counters.emitted > beforeEmittedRefresh && evaluate("!document.querySelector('.received-inbox__refresh button').disabled"), 'emitted refresh')
  assert.equal(counters.emitted, beforeEmittedRefresh + 1)
  await evaluate("document.querySelector('.received-inbox__subject').click()")
  await until(() => evaluate("document.body.textContent.includes('UUID del original al que responder')"), 'reuse existing Emitidos UUID')
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Vincular este documento oficial como respuesta').disabled"), true)
  await clickText('Cerrar vista previa')
  Object.assign(session, { roleId: 'director-dsa', dependency: 'DSA', alfresco: { id: 'DSA_T' }, user: { id: 'DSA_T', name: 'Direction DSA' } })
  await command('Page.reload', { ignoreCache: true })
  await until(() => evaluate("Boolean(document.querySelector('.sidebar__nav'))"), 'DSA workspace')
  await clickText('Emitidos')
  await until(() => evaluate("document.body.textContent.includes('No hay documentos emitidos') && !document.querySelector('.received-inbox__refresh button').disabled"), 'DSA emitted stays empty for received DTI original')
  assert.equal(await evaluate("Boolean(document.querySelector('.received-inbox__subject'))"), false)
  await clickText('Documentos recibidos')
  await until(() => evaluate("Boolean(document.querySelector('.received-inbox__subject'))"), 'closure fixture inbox')
  await evaluate("document.querySelector('.received-inbox__subject').click()")
  await clickText('Evaluar cierre de mi intervención')
  await until(() => evaluate("document.body.textContent.includes('Cierre deshabilitado')"), 'closure disabled by backend')
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Cerrar intervención')"), false)
  assert.equal(closurePosts, 0)
  closureEnabled = true // API fixture only. Does not configure backend or Alfresco.
  await clickText('Evaluar cierre de mi intervención')
  await until(() => evaluate("Boolean(document.querySelector('section[aria-label=\"Cierre de intervención\"] textarea'))"), 'explicit reason')
  await evaluate(`(()=>{const field=document.querySelector('section[aria-label="Cierre de intervención"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Constancia de prueba');field.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await until(() => evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Cerrar intervención'&&!b.disabled)"), 'explicit close available')
  await clickText('Cerrar intervención')
  await until(() => evaluate("document.body.textContent.includes('Intervención cerrada definitivamente.')"), 'verified closed UI')
  assert.equal(closurePosts, 1)
  closureEnabled = false
  await clickText('Aprobar cierres')
  await until(() => evaluate("Boolean(document.querySelector('[role=tablist]'))"), 'closure discovery tabs')
  await until(() => evaluate("[...document.querySelectorAll('[role=tab]')].some(t=>t.textContent==='Pendientes (2)')"), 'verified category counts')
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.startsWith('Pendientes')).click()")
  await until(() => evaluate("document.querySelectorAll('section[aria-label=\"Aprobar cierres\"] tbody tr').length===2"), 'pending and indeterminate interventions')
  assert.ok(await evaluate("document.body.textContent.includes('Indeterminada') && document.body.textContent.includes('Pendiente de atención')"))
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.startsWith('Cerradas')).click()")
  await until(() => evaluate("Boolean(document.querySelector('section[aria-label=\"Aprobar cierres\"] tbody tr'))"), 'verified closed intervention')
  assert.equal(await evaluate("document.querySelectorAll('section[aria-label=\"Aprobar cierres\"] tbody tr').length"), 1)
  const closureReadsBeforeRefresh = counters.closureInbox
  await clickText('Actualizar bandeja')
  await until(() => counters.closureInbox > closureReadsBeforeRefresh, 'closure discovery refresh')
  await clickText('Abrir y evaluar')
  await until(() => evaluate("Boolean(document.querySelector('section[aria-label=\"Cierre de intervención\"]'))"), 'fresh per-document closure evaluation')
  assert.equal(closurePosts, 1, 'discovery and preview do not create closure writes')
  const report = { browser: 'Edge headless', application: 'real production bundle', api: 'isolated fixtures; no Alfresco requests',
    closureChecks: ['backend disabled hides close', 'explicit reason and CSRF', 'one mocked close', 'read-after-close refresh', 'closure discovery and refresh without known UUID', 'Aptas/Pendientes/Cerradas tabs', 'pending versus indeterminate', 'real receipt displayed for closed intervention'],
    checks: ['assigned labels by ID', 'refresh loads assignments once', 'selection does not rescan', 'post refresh', 'navigation', 'reload', '11px computed width', 'three distinct equal segments', 'desktop/mobile capture',
      'Dirección reuses existing emission form', 'draft does not attend', 'formal emission timeout reuses key and PDF', 'one formal UUID after retry', 'emission and link do not attend', 'Jefatura attends own assignment', 'Especialista attends own assignment', 'attended history survives reload', 'DTI original issuer separated from DSA dispatcher', 'official response issuance remains Direction-only', 'DTI Emitidos loads without browser cache', 'Emitidos refreshes repository', 'DSA never lists received DTI original as its own emission'],
    proposalChecks: ['available/inaccessible/invalid versions', 'verified version preview', 'no mutation buttons'], visual, counters }
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await command('Browser.close').catch(() => {}); socket.close() }
  browser.kill()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  // Delete only the dedicated temporary profile created by this script.
  if (!path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep + 'dispatch-browser-')) throw new Error('Invalid temporary profile path')
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }) } catch { /* Edge may retain temporary files briefly on Windows. */ }
}
