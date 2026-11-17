import fs from 'node:fs'
import path from 'node:path'

const fail = (code) => { throw Object.assign(new Error(code), { status: 503 }) }

export function acquirePilotLease(settings) {
  if (settings.dispatchPersistence !== 'alfresco' || !settings.dispatchPilot?.writesEnabled) return () => {}
  const pilot = settings.dispatchPilot
  if (!pilot.controlledEnvironment || pilot.expectedTarget !== settings.alfrescoTarget || !Array.isArray(pilot.documentIds) || !pilot.documentIds.length ||
      pilot.documentIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) ||
      Number(process.env.WEB_CONCURRENCY || 1) !== 1 || process.env.NODE_UNIQUE_ID || process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
    fail('DISPATCH_PILOT_ENVIRONMENT_REQUIRED')
  }
  fs.mkdirSync(path.dirname(pilot.leasePath), { recursive: true })
  let descriptor
  try { descriptor = fs.openSync(pilot.leasePath, 'wx') } catch { fail('DISPATCH_PILOT_LEASE_UNAVAILABLE') }
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  let released = false
  return () => {
    if (released) return
    released = true
    fs.closeSync(descriptor)
    fs.unlinkSync(pilot.leasePath)
  }
}
