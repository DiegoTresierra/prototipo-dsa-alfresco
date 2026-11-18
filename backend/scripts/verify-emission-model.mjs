// GET ONLY. Intentionally no write method, --apply option or administrator fallback.
import fs from 'node:fs'
import { config } from '../src/config.js'
import { planEmissionModel } from '../src/emissionModelPlan.js'
import { assertEmissionModel } from '../src/officialEmissionContract.js'
import { auditDocumentNumbers } from '../src/documentNumberAudit.js'

const args = process.argv.slice(2)
if (args.some((arg) => !['--require-present', '--audit-existing'].includes(arg))) throw new Error('UNSUPPORTED_ARGUMENT: GET-only; optional --require-present, --audit-existing')
const service = config.distributionService
if (!service.username || !service.password) throw new Error('MODEL_READ_CREDENTIALS_REQUIRED')
const authorization = `Basic ${Buffer.from(`${service.username}:${service.password}`).toString('base64')}`
async function get(path) {
  let response
  try {
    response = await fetch(`${config.alfrescoTarget}${path}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: authorization, Accept: 'application/json' },
    })
  } catch { throw new Error('MODEL_GET_UNAVAILABLE') }
  if (!response.ok) throw new Error(`MODEL_GET_FAILED:${response.status}`)
  try { return await response.json() } catch { throw new Error('MODEL_GET_INVALID_JSON') }
}
const base = '/alfresco/api/-default-/private/alfresco/versions/1/cmm/gd_uac'
const model = (await get(`${base}?select=all`)).entry
const aspect = (await get(`${base}/aspects/identificacion`)).entry
const runtime = await get('/alfresco/service/api/classes/gd_identificacion')
const numeroDefinition = await get('/alfresco/service/api/classes/gd_identificacion/property/gd_numero')
const patch = JSON.parse(fs.readFileSync(new URL('../alfresco-model/gd-identificacion-emission.cmm.json', import.meta.url), 'utf8'))
const plan = planEmissionModel(model, aspect, patch)
let runtimeReady = false
try { assertEmissionModel(runtime.properties); runtimeReady = true } catch { /* reported below */ }
const existingNumero = aspect.properties.find((p) => p.name === 'numero')
const existingNumeroReady = existingNumero?.dataType === 'd:text' && existingNumero?.multiValued === false &&
  runtime.properties?.['gd:numero']?.dataType === 'd:text' && runtime.properties?.['gd:numero']?.multiValued === false
const ready = !plan.missing.length && !plan.conflicts.length && runtimeReady && existingNumeroReady
let existingNumberAudit
if (args.includes('--audit-existing')) {
  const rootIds = [...new Set(Object.values(config.officeInboxNodeIds || {}).flatMap((folders) => Object.values(folders)).filter((id) => typeof id === 'string' && id))]
  const core = '/alfresco/api/-default-/public/alfresco/versions/1'
  existingNumberAudit = await auditDocumentNumbers({ rootIds, get: (path) => get(core + path) })
}
console.log(JSON.stringify({ mode: 'GET-only', model: model.name, status: model.status, aspect: aspect.name,
  existingNumero: { cmm: existingNumero, runtime: numeroDefinition, compatibleModel: existingNumeroReady },
  existingNumberAudit,
  missingProperties: plan.missing, conflicts: plan.conflicts, notes: plan.notes,
  runtimeReady, modelReady: ready, issuanceEnabled: false, additivePatch: plan.additivePatch,
}, null, 2))
console.log('No changes made. Model readiness does not authorize or enable official issuance.')
if (plan.conflicts.length || !existingNumeroReady || args.includes('--require-present') && (!ready || existingNumberAudit?.reconciliationRequired)) process.exitCode = 1
