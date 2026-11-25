import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HIERARCHY_PILOT_ACKNOWLEDGEMENT = 'single-host-exclusive-writer-hierarchy-dsa-dev'
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const held = new Map()

function fail(code) {
  throw Object.assign(new Error(code), { code, status: 503 })
}

export function hierarchyPilotConfigurationReady(settings) {
  const pilot = settings.hierarchyPilot || {}
  const service = settings.hierarchyService || {}
  const containers = [service.containerNodeId, service.auditContainerNodeId, service.labContainerNodeId]
  if (pilot.enabled !== true || pilot.externalWritersDisabled !== true ||
      pilot.acknowledgement !== HIERARCHY_PILOT_ACKNOWLEDGEMENT ||
      pilot.expectedTarget !== settings.alfrescoTarget ||
      String(pilot.dependency).toUpperCase() !== 'DSA' ||
      settings.hierarchyReadStorage !== 'alfresco' || service.storage !== 'alfresco' ||
      !service.username || !service.password ||
      containers.some(id => !uuid.test(id || '')) ||
      new Set(containers.map(id => id.toLowerCase())).size !== 3 ||
      containers.some((id, index) => id.toLowerCase() !== pilot.expectedContainers?.[index]?.toLowerCase())) return false
  try {
    const target = new URL(settings.alfrescoTarget)
    if (target.protocol !== 'https:' || target.username || target.password ||
        target.search || target.hash || target.pathname !== '/') return false
    if (!path.isAbsolute(pilot.leasePath) || pilot.leasePath.startsWith('\\\\')) return false
    const others = [settings.dispatchPilot?.leasePath, settings.responseTimes?.pilotLeasePath,
      settings.officialEmission?.leasePath].filter(Boolean)
    if (others.some(other => path.resolve(other) === path.resolve(pilot.leasePath))) return false
  } catch { return false }
  if (Number(process.env.WEB_CONCURRENCY || 1) !== 1 || process.env.NODE_UNIQUE_ID ||
      process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') return false
  return true
}

export function hierarchyPilotLeaseIsHeld(settings) {
  const leasePath = settings.hierarchyPilot?.leasePath
  if (!leasePath) return false
  const lease = held.get(path.resolve(leasePath))
  if (!lease) return false
  try {
    const owner = JSON.parse(fs.readFileSync(leasePath, 'utf8'))
    return owner.token === lease.token && owner.pid === process.pid && owner.hostname === os.hostname()
  } catch { return false }
}

export function hierarchyOperationReady(settings, operation, dependency) {
  return hierarchyPilotConfigurationReady(settings) && hierarchyPilotLeaseIsHeld(settings) &&
    String(dependency).toUpperCase() === 'DSA' &&
    ['createUnits', 'editUnits', 'assignHeads', 'assignSpecialists'].includes(operation)
}

export function hierarchyPilotPendingOperation(settings) {
  if (!hierarchyPilotLeaseIsHeld(settings)) return null
  try { return JSON.parse(fs.readFileSync(settings.hierarchyPilot.leasePath, 'utf8')).pendingOperation || null }
  catch { return null }
}

export function setHierarchyPilotPendingOperation(settings, operation) {
  const leasePath = settings.hierarchyPilot?.leasePath
  const lease = leasePath && held.get(path.resolve(leasePath))
  if (!lease || !hierarchyPilotLeaseIsHeld(settings)) fail('HIERARCHY_PILOT_LEASE_UNAVAILABLE')
  const next = { ...lease.owner, pendingOperation: operation ? {
    operationId: operation.operationId,
    startedAt: lease.owner.pendingOperation?.startedAt || new Date().toISOString(),
  } : null }
  try {
    fs.ftruncateSync(lease.descriptor, 0)
    fs.writeSync(lease.descriptor, JSON.stringify(next), 0, 'utf8')
    fs.fsyncSync(lease.descriptor)
    if (fs.readFileSync(leasePath, 'utf8') !== JSON.stringify(next)) fail('HIERARCHY_PILOT_LEASE_UNAVAILABLE')
    lease.owner = next
  } catch { fail('HIERARCHY_PILOT_LEASE_UNAVAILABLE') }
}

export function acquireHierarchyPilotLease(settings) {
  if (!hierarchyPilotConfigurationReady(settings) ||
      !Object.values(settings.hierarchyService).some(value => value === true)) return () => {}
  const leasePath = settings.hierarchyPilot.leasePath
  fs.mkdirSync(path.dirname(leasePath), { recursive: true })
  let descriptor
  try { descriptor = fs.openSync(leasePath, 'wx') } catch { fail('HIERARCHY_PILOT_LEASE_UNAVAILABLE') }
  const token = randomUUID()
  const owner = { token, pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), dependency: 'DSA', pendingOperation: null }
  try {
    fs.writeFileSync(descriptor, JSON.stringify(owner))
    fs.fsyncSync(descriptor)
    if (fs.readFileSync(leasePath, 'utf8') !== JSON.stringify(owner)) fail('HIERARCHY_PILOT_LEASE_UNAVAILABLE')
  } catch {
    fs.closeSync(descriptor)
    fs.unlinkSync(leasePath)
    fail('HIERARCHY_PILOT_LEASE_UNAVAILABLE')
  }
  held.set(path.resolve(leasePath), { token, descriptor, owner })
  let released = false
  return () => {
    if (released) return
    released = true
    held.delete(path.resolve(leasePath))
    let owns = false
    let hasPending = false
    try {
      const current = JSON.parse(fs.readFileSync(leasePath, 'utf8'))
      owns = current.token === token && current.pid === process.pid && current.hostname === os.hostname()
      hasPending = Boolean(current.pendingOperation)
    } catch { /* do not remove a lease that cannot be verified */ }
    fs.closeSync(descriptor)
    if (owns && !hasPending) {
      try { fs.unlinkSync(leasePath) } catch { /* stale lease fails closed on next launch */ }
    }
  }
}
