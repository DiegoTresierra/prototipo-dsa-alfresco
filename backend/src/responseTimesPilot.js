import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { responseTimesAlfrescoConfigurationReady } from './responseTimesAlfrescoRepository.js'

export const RESPONSE_TIMES_PILOT_ACKNOWLEDGEMENT = 'single-instance-exclusive-writer-response-times-dsa'
const activeLeases = new Map()

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status })
}

export function responseTimesPilotLeaseIsHeld(settings) {
  const lease = activeLeases.get(path.resolve(settings.responseTimes.pilotLeasePath))
  if (!lease) return false
  try {
    const current = JSON.parse(fs.readFileSync(lease.leasePath, 'utf8'))
    return current.token === lease.token && current.pid === process.pid && current.hostname === os.hostname() &&
      current.scope === 'response-times-dsa'
  } catch { return false }
}

export function setResponseTimesPilotPendingOperation(settings, operation) {
  const lease = activeLeases.get(path.resolve(settings.responseTimes.pilotLeasePath))
  if (!lease) fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
  const nextOwner = {
    ...lease.owner,
    pendingOperation: operation ? {
      dependency: operation.dependency,
      operationId: operation.operationId,
      startedAt: lease.owner.pendingOperation?.startedAt || new Date().toISOString(),
    } : null,
  }
  try {
    const current = JSON.parse(fs.readFileSync(lease.leasePath, 'utf8'))
    if (current.token !== lease.token || current.pid !== process.pid || current.hostname !== os.hostname()) {
      fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
    }
    fs.ftruncateSync(lease.descriptor, 0)
    fs.writeSync(lease.descriptor, JSON.stringify(nextOwner), 0, 'utf8')
    fs.fsyncSync(lease.descriptor)
    if (fs.readFileSync(lease.leasePath, 'utf8') !== JSON.stringify(nextOwner)) fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
    lease.owner = nextOwner
  } catch {
    fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
  }
}

function openExclusiveLease(leasePath) {
  try {
    return fs.openSync(leasePath, 'wx')
  } catch (error) {
    if (error?.code === 'EEXIST') fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
    fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
  }
}

export function acquireResponseTimesPilotLease(settings) {
  const pilot = settings.responseTimes
  if (!pilot.singleInstancePilotEnabled || !pilot.writesEnabled) return () => {}
  if (!responseTimesAlfrescoConfigurationReady(settings) || !pilot.username ||
      pilot.pilotExpectedTarget !== settings.alfrescoTarget ||
      pilot.pilotAcknowledgement !== RESPONSE_TIMES_PILOT_ACKNOWLEDGEMENT || pilot.externalWritersDisabled !== true) {
    fail('RESPONSE_TIMES_PILOT_CONFIGURATION_REQUIRED')
  }
  let target
  try { target = new URL(settings.alfrescoTarget) } catch { fail('RESPONSE_TIMES_PILOT_TARGET_INVALID') }
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) {
    fail('RESPONSE_TIMES_PILOT_TARGET_INVALID')
  }
  if (Number(process.env.WEB_CONCURRENCY || 1) !== 1 || process.env.NODE_UNIQUE_ID ||
      (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0')) {
    fail('RESPONSE_TIMES_PILOT_SINGLE_PROCESS_REQUIRED')
  }
  const leasePath = pilot.pilotLeasePath
  const otherLeasePaths = [settings.dispatchPilot?.leasePath, settings.officialEmission?.leasePath].filter(Boolean)
  if (typeof leasePath !== 'string' || !path.isAbsolute(leasePath) || leasePath.startsWith('\\\\') ||
      otherLeasePaths.some((otherPath) => path.resolve(leasePath) === path.resolve(otherPath))) {
    fail('RESPONSE_TIMES_PILOT_LEASE_PATH_INVALID')
  }

  fs.mkdirSync(path.dirname(leasePath), { recursive: true })
  const token = crypto.randomUUID()
  const descriptor = openExclusiveLease(leasePath)
  const owner = { pid: process.pid, hostname: os.hostname(), token, startedAt: new Date().toISOString(), scope: 'response-times-dsa', pendingOperation: null }
  try {
    fs.writeFileSync(descriptor, JSON.stringify(owner))
    if (fs.readFileSync(leasePath, 'utf8') !== JSON.stringify(owner)) fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
  } catch {
    try { fs.closeSync(descriptor) } catch { /* best-effort cleanup */ }
    try { fs.unlinkSync(leasePath) } catch { /* best-effort cleanup */ }
    fail('RESPONSE_TIMES_PILOT_LEASE_UNAVAILABLE')
  }

  const state = { leasePath, token, descriptor, owner }
  activeLeases.set(path.resolve(leasePath), state)
  console.info('[response-times-pilot]', JSON.stringify({ enabled: true, dependency: 'DSA', concurrency: 'single-process-single-host', target: target.origin }))
  let released = false
  return () => {
    if (released) return
    released = true
    let ownsLease = false
    let hasPendingOperation = false
    try {
      const current = JSON.parse(fs.readFileSync(leasePath, 'utf8'))
      ownsLease = current.token === token && current.pid === process.pid && current.hostname === os.hostname()
      hasPendingOperation = Boolean(current.pendingOperation)
    } catch { /* do not remove a lease owned by another process */ }
    try { fs.closeSync(descriptor) } catch { /* process may already be exiting */ }
    activeLeases.delete(path.resolve(leasePath))
    if (ownsLease && !hasPendingOperation) {
      try { fs.unlinkSync(leasePath) } catch { /* a leftover lease fails closed on the next start */ }
    }
  }
}
