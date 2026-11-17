import fs from 'node:fs'
import path from 'node:path'

const fail = (code) => { throw Object.assign(new Error(code), { status: 503 }) }

export const pilotAcknowledgements = {
  dev: 'single-instance-exclusive-writer-dev-institutional-documents',
  preprod: 'single-instance-exclusive-writer-preprod-institutional-documents',
}

export function validatePilotEnvironment(settings) {
  const pilot = settings.dispatchPilot || {}
  if (!pilot.writesEnabled) fail('DISPATCH_ALFRESCO_WRITES_DISABLED')
  const profile = pilot.environments?.[pilot.environment]
  if (!Object.hasOwn(pilotAcknowledgements, pilot.environment) || profile?.enabled !== true ||
      profile.acknowledgement !== pilotAcknowledgements[pilot.environment] || profile.expectedTarget !== settings.alfrescoTarget) {
    fail('DISPATCH_PILOT_ENVIRONMENT_REQUIRED')
  }
  let target
  try { target = new URL(settings.alfrescoTarget) } catch { fail('DISPATCH_PILOT_ENVIRONMENT_REQUIRED') }
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || target.pathname !== '/') {
    fail('DISPATCH_PILOT_ENVIRONMENT_REQUIRED')
  }
  if (pilot.environment === 'preprod' && pilot.environments?.dev?.expectedTarget) {
    let devTarget
    try { devTarget = new URL(pilot.environments.dev.expectedTarget) } catch { fail('DISPATCH_PILOT_ENVIRONMENT_REQUIRED') }
    if (devTarget.origin === target.origin) fail('DISPATCH_PILOT_ENVIRONMENT_REQUIRED')
  }
  const institutionalFolders = Object.fromEntries(['DTI', 'DSA'].map((dependency) => [dependency,
    Object.values(settings.officeInboxNodeIds?.[dependency] || {}).filter((id) => typeof id === 'string' && id.trim()),
  ]).filter(([, folders]) => folders.length))
  if (!Object.keys(institutionalFolders).length) fail('DISPATCH_INSTITUTIONAL_SCOPE_REQUIRED')
  return { environment: pilot.environment, alfrescoTarget: settings.alfrescoTarget, institutionalFolders }
}

export function acquirePilotLease(settings) {
  if (settings.dispatchPersistence !== 'alfresco' || !settings.dispatchPilot?.writesEnabled) return () => {}
  const pilot = settings.dispatchPilot
  const scope = validatePilotEnvironment(settings)
  if (Number(process.env.WEB_CONCURRENCY || 1) !== 1 || process.env.NODE_UNIQUE_ID || process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
    fail('DISPATCH_PILOT_ENVIRONMENT_REQUIRED')
  }
  fs.mkdirSync(path.dirname(pilot.leasePath), { recursive: true })
  let descriptor
  try { descriptor = fs.openSync(pilot.leasePath, 'wx') } catch { fail('DISPATCH_PILOT_LEASE_UNAVAILABLE') }
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(),
    ...scope }))
  console.info('[dispatch-pilot]', JSON.stringify({ ...scope,
    scope: 'institutional-inboxes', concurrency: 'single-process-only' }))
  let released = false
  return () => {
    if (released) return
    released = true
    fs.closeSync(descriptor)
    fs.unlinkSync(pilot.leasePath)
  }
}
