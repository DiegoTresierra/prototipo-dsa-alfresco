import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireResponseTimesPilotLease, responseTimesPilotLeaseIsHeld, setResponseTimesPilotPendingOperation, RESPONSE_TIMES_PILOT_ACKNOWLEDGEMENT } from './responseTimesPilot.js'

function fixture(root, overrides = {}) {
  return {
    alfrescoTarget: 'https://alfresco.example.test',
    dispatchPilot: { leasePath: path.join(root, 'dispatch.lock') },
    responseTimes: {
      storage: 'alfresco', username: 'gd_tiempos_respuesta_servicio', password: 'fixture',
      containerNodeId: '11111111-1111-4111-8111-111111111111', writesEnabled: true,
      singleInstancePilotEnabled: true, pilotExpectedTarget: 'https://alfresco.example.test',
      pilotAcknowledgement: RESPONSE_TIMES_PILOT_ACKNOWLEDGEMENT, externalWritersDisabled: true,
      pilotLeasePath: path.join(root, 'response-times.lock'),
      ...overrides,
    },
    hierarchyService: {
      containerNodeId: '22222222-2222-4222-8222-222222222222',
      auditContainerNodeId: '33333333-3333-4333-8333-333333333333',
      labContainerNodeId: '44444444-4444-4444-8444-444444444444',
    },
  }
}

test('disabled pilot mode does not acquire a lease', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'response-times-pilot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const settings = fixture(root, { singleInstancePilotEnabled: false })
  const release = acquireResponseTimesPilotLease(settings)
  assert.equal(responseTimesPilotLeaseIsHeld(settings), false)
  assert.equal(fs.existsSync(settings.responseTimes.pilotLeasePath), false)
  release()
})

test('acquires one same-host process lease and rejects a second writer until release', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'response-times-pilot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const settings = fixture(root)
  const release = acquireResponseTimesPilotLease(settings)
  assert.equal(responseTimesPilotLeaseIsHeld(settings), true)
  assert.equal(JSON.parse(fs.readFileSync(settings.responseTimes.pilotLeasePath, 'utf8')).scope, 'response-times-dsa')
  assert.throws(() => acquireResponseTimesPilotLease(settings), { code: 'RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE' })
  const childScript = `import { acquireResponseTimesPilotLease } from ${JSON.stringify(new URL('./responseTimesPilot.js', import.meta.url).href)}; const settings=${JSON.stringify(settings)}; try { acquireResponseTimesPilotLease(settings); process.exit(3) } catch (error) { process.exit(error.code === 'RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE' ? 0 : 2) }`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.status, 0, child.stderr)
  release()
  assert.equal(responseTimesPilotLeaseIsHeld(settings), false)
  assert.equal(fs.existsSync(settings.responseTimes.pilotLeasePath), false)
  const secondRelease = acquireResponseTimesPilotLease(settings)
  secondRelease()
})

test('requires explicit target acknowledgement and external-writer confirmation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'response-times-pilot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const overrides of [
    { pilotExpectedTarget: 'https://other.example.test' },
    { pilotAcknowledgement: '' },
    { externalWritersDisabled: false },
    { pilotLeasePath: path.join(root, 'dispatch.lock') },
  ]) {
    assert.throws(() => acquireResponseTimesPilotLease(fixture(root, overrides)), { code: /RESPONSE_TIMES_PILOT_/ })
  }
  assert.equal(fs.existsSync(path.join(root, 'response-times.lock')), false)
})

test('fails closed on an existing or stale lease instead of reclaiming it automatically', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'response-times-pilot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const settings = fixture(root)
  fs.writeFileSync(settings.responseTimes.pilotLeasePath, JSON.stringify({ pid: -999, hostname: os.hostname() }))
  assert.throws(() => acquireResponseTimesPilotLease(settings), { code: 'RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE' })
  assert.equal(fs.existsSync(settings.responseTimes.pilotLeasePath), true)
})

test('retains the lease after an unresolved operation until manual reconciliation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'response-times-pilot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const settings = fixture(root)
  const release = acquireResponseTimesPilotLease(settings)
  setResponseTimesPilotPendingOperation(settings, { dependency: 'dsa', operationId: 'pending-op-0001' })
  release()
  assert.equal(fs.existsSync(settings.responseTimes.pilotLeasePath), true)
  assert.throws(() => acquireResponseTimesPilotLease(settings), { code: 'RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE' })
  fs.unlinkSync(settings.responseTimes.pilotLeasePath)
  const afterReview = acquireResponseTimesPilotLease(settings)
  afterReview()
})

test('requires a single worker process', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'response-times-pilot-'))
  const previous = process.env.WEB_CONCURRENCY
  process.env.WEB_CONCURRENCY = '2'
  t.after(() => {
    if (previous === undefined) delete process.env.WEB_CONCURRENCY
    else process.env.WEB_CONCURRENCY = previous
    fs.rmSync(root, { recursive: true, force: true })
  })
  const settings = fixture(root)
  assert.throws(() => acquireResponseTimesPilotLease(settings), { code: 'RESPONSE_TIMES_PILOT_SINGLE_PROCESS_REQUIRED' })
  assert.equal(fs.existsSync(settings.responseTimes.pilotLeasePath), false)
})
