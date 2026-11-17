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
const id = '18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097'
const people = [
  { id: 'JEFE_UNIDAD_DSA_1', displayName: 'JEFE_UNIDAD_DSA_1', functionalRole: 'jefe-unidad', dependency: 'dsa', unit: null },
  { id: 'JEFE_UNIDAD_DSA_2', displayName: 'JEFE_UNIDAD_DSA_2', functionalRole: 'jefe-unidad', dependency: 'dsa', unit: null },
  { id: '021200931d@uandina.edu.pe', displayName: 'Especialista DSA', functionalRole: 'especialista', dependency: 'dsa', unit: null },
]
const node = { id, name: 'oficio-prueba.pdf', isFile: true, nodeType: 'cm:content', parentId: 'dsa-attention',
  content: { mimeType: 'application/pdf', sizeInBytes: 500 }, aspectNames: ['gd:tramite'],
  createdAt: '2026-11-17T12:00:00Z', createdByUser: { id: 'DTI_T', displayName: 'Dirección DTI' },
  properties: { 'cm:title': 'Documento de prueba: responsabilidades equivalentes' } }
const record = (key, recipients) => ({ id: key, documentId: id, senderUserId: 'DSA_T', senderRole: 'direccion', senderDependency: 'dsa',
  requestKey: key, originAssignmentId: null, instruction: 'Instrucción de prueba local', priority: 'Normal', createdAt: node.createdAt,
  status: 'ASIGNADO', recipients: recipients.map((person) => ({ ...person, id: `${key}:${person.id}`, userId: person.id, documentId: id,
    dispatchId: key, status: 'ASIGNADO', createdAt: node.createdAt })) })
// Same response shape and active recipient observed by GET in DEV; content is synthetic.
const records = [record('initial-fixture', [people[0]])]
const counters = { assignments: 0, directory: 0, children: 0, mockDispatches: 0 }
const session = { authenticated: true, authorizationStatus: 'active', roleId: 'director-dsa', functionalRole: 'direccion', dependency: 'DSA',
  alfresco: { id: 'DSA_T', displayName: 'Dirección DSA' }, user: { id: 'DSA_T', name: 'Dirección DSA' },
  capabilities: ['documents:read', 'documents:write'], dispatchRecipientRoles: ['jefe-unidad', 'especialista'], csrfToken: 'local-fixture-only' }
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)) }
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/auth/me') return json(session)
    if (url.pathname === '/api/auth/status') return json({ basicAuthEnabled: true })
    if (url.pathname === '/api/directory/office-inboxes') return json({ folders: { porAtender: 'dsa-attention', porConocimiento: 'dsa-knowledge' } })
    if (url.pathname === '/api/directory/dispatch-recipients') { counters.directory++; return json({ recipients: people, allowedRecipientRoles: session.dispatchRecipientRoles }) }
    if (url.pathname === '/api/documents/dispatches') {
      counters.assignments++
      return json({ persistence: 'alfresco', dispatches: records, sentDispatches: records, documents: [node], documentErrors: [] })
    }
    if (url.pathname.endsWith('/children')) {
      counters.children++
      return json({ list: { entries: url.pathname.includes('dsa-attention') ? [{ entry: node }] : [], pagination: { hasMoreItems: false } } })
    }
    if (url.pathname.endsWith('/content')) { response.writeHead(200, { 'Content-Type': 'application/pdf' }); return response.end('%PDF-1.7\n%local browser fixture') }
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
  const report = { browser: 'Edge headless', application: 'real production bundle', api: 'isolated fixtures; no Alfresco requests',
    checks: ['assigned labels by ID', 'refresh loads assignments once', 'selection does not rescan', 'post refresh', 'navigation', 'reload', '11px computed width', 'three distinct equal segments', 'desktop/mobile capture'],
    visual, counters }
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
