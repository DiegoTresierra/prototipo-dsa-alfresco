// Default: GET-only preflight. --apply is a future, explicit operator action.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../src/config.js'
import { planDispatchModel } from '../src/dispatchModelPlan.js'

const apply = process.argv.includes('--apply')
const modelAuthorization = process.env.ALFRESCO_MODEL_AUTHORIZATION
if (apply && !modelAuthorization) throw new Error('MODEL_AUTHORIZATION_REQUIRED: use an already authorized model administrator, never elevate gd_distribucion')
const service = config.distributionService
const authorization = modelAuthorization || `Basic ${Buffer.from(`${service.username}:${service.password}`).toString('base64')}`
const base = `${config.alfrescoTarget}/alfresco/api/-default-/private/alfresco/versions/1/cmm/gd_uac`
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: authorization, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error(`MODEL_REQUEST_FAILED:${method}:${response.status}`)
  return response.json()
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const patch = JSON.parse(fs.readFileSync(path.join(root, 'alfresco-model/gd-tramite-dispatch.cmm.json'), 'utf8'))
const model = (await request(`${base}?select=all`)).entry
const aspect = (await request(`${base}/aspects/tramite`)).entry
const planned = planDispatchModel(model, aspect, patch)
console.log(JSON.stringify({ mode: apply ? 'apply' : 'GET-only', model: model.name, target: config.alfrescoTarget,
  missingProperties: planned.properties.map((property) => `gd:${property.name}`) }, null, 2))
if (!apply) {
  console.log('No changes made. Review backend/ALFRESCO_DISPATCH_PILOT.md before deployment.')
} else if (planned.properties.length) {
  // Back up the complete CMM definition before any update. Never overwrite a backup.
  const backupDirectory = process.env.DISPATCH_MODEL_BACKUP_DIR
  if (!backupDirectory) throw new Error('DISPATCH_MODEL_BACKUP_DIR_REQUIRED')
  fs.mkdirSync(backupDirectory, { recursive: true })
  fs.writeFileSync(path.join(backupDirectory, `gd_uac-${Date.now()}.json`), JSON.stringify({ model, aspect }, null, 2), { flag: 'wx' })
  await request(`${base}/aspects/tramite?select=props`, 'PUT', planned)
  const after = (await request(`${base}/aspects/tramite`)).entry
  if (planDispatchModel(model, after, patch).properties.length) throw new Error('MODEL_VERIFICATION_FAILED')
  // Ensure original properties and their contracts were preserved.
  for (const original of aspect.properties) {
    const actual = after.properties.find((property) => property.name === original.name)
    if (JSON.stringify(actual) !== JSON.stringify(original)) throw new Error('MODEL_ORIGINAL_PROPERTY_CHANGED')
  }
  console.log('CMM additions verified. Backend writes remain controlled by separate pilot settings.')
}
