// GET-only preflight, independently scoped by institutional folder/code/cycle.
import fs from 'node:fs'
import { config } from '../src/config.js'
import { validateReconciliation, sha256 } from '../src/emissionReconciliation.js'
import { assertEmissionModel, decodeEmissionMetadata } from '../src/officialEmissionContract.js'
import { createInstitutionalEmissionReader } from '../src/alfrescoNumbering.js'
import { numberingScope } from '../src/numberingStore.js'

const args = process.argv.slice(2)
const dependencyOption = args.find((arg) => arg.startsWith('--dependency='))?.split('=')[1]
const manifestPath = args.find((arg) => !arg.startsWith('--'))
if (args.some((arg) => arg.startsWith('--') && !/^--dependency=(DSA|DTI)$/.test(arg)) ||
    args.filter((arg) => !arg.startsWith('--')).length > 1 || args.filter((arg) => arg.startsWith('--dependency=')).length > 1) throw new Error('GET_ONLY_USAGE: [approved-manifest] [--dependency=DSA|DTI]')
const service = config.distributionService
if (!service.username || !service.password) throw new Error('READ_CREDENTIALS_REQUIRED')
const headers = { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(service.username + ':' + service.password).toString('base64') }
const core = '/alfresco/api/-default-/public/alfresco/versions/1'
const request = async (path, absolute = false) => {
  const r = await fetch(config.alfrescoTarget + (absolute ? '' : core) + path, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error('OFFICIAL_PREFLIGHT_GET_FAILED:' + r.status)
  return r
}
const get = async (path) => (await request(path)).json()
const readContent = async (id) => Buffer.from(await (await request('/nodes/' + encodeURIComponent(id) + '/content')).arrayBuffer())
const model = await (await request('/alfresco/service/api/classes/gd_identificacion', true)).json()
assertEmissionModel(model.properties)
let exclusion = async () => false
let manifestSha256
if (manifestPath) {
  const raw = fs.readFileSync(manifestPath)
  exclusion = validateReconciliation(JSON.parse(raw), config, readContent)
  manifestSha256 = sha256(raw)
}
const results = []
for (const dependency of dependencyOption ? [dependencyOption] : ['DTI', 'DSA']) {
  const scope = numberingScope(dependency)
  const folderId = config.officeInboxNodeIds?.[dependency]?.emitidos
  const excluded = []
  try {
    const reader = createInstitutionalEmissionReader({ folderId, get, modelProperties: model.properties,
      decode: async (node) => {
        if (await exclusion(node)) { excluded.push(node.id); return null }
        return decodeEmissionMetadata(node)
      },
    })
    const records = await reader.list(scope)
    const source = (await get('/nodes/' + encodeURIComponent(folderId) + '?include=allowableOperations')).entry
    if (source?.id !== folderId || source.isFolder !== true) throw new Error('NUMBERING_COVERAGE_NOT_VERIFIED')
    const nextNumber = records.reduce((max, record) => Math.max(max, record.number), 0) + 1
    if (!Number.isSafeInteger(nextNumber)) throw new Error('NUMBERING_SEQUENCE_EXHAUSTED')
    const other = dependency === 'DSA' ? 'DTI' : 'DSA'
    const targetId = config.officeInboxNodeIds?.[other]?.porAtender
    const target = (await get('/nodes/' + encodeURIComponent(targetId) + '?include=allowableOperations')).entry
    const associationCreateVerified = target?.isFolder === true && target.allowableOperations?.includes('create') === true
    results.push({ dependency, folderId, code: scope.documentCode, cycle: scope.cycle, officialRecords: records.length,
      nextNumber: String(nextNumber),
      approvedExcluded: excluded, numberingReady: true, associationCreateVerified,
      sourceFolderReadableByTechnicalAccount: source?.id === folderId,
      recipientNodeRead: 'must be verified on the emitted node before association; never inferred from folder or secondary association',
      recipientContentRead: 'real recipient session GET pending' })
  } catch (error) { results.push({ dependency, folderId, code: scope.documentCode, cycle: scope.cycle, numberingReady: false, error: error.message }) }
}
const ready = results.every((item) => item.numberingReady && item.associationCreateVerified)
console.log(JSON.stringify({ mode: 'GET-only', modelReady: true, manifestSha256, sequences: results,
  numberingAndAssociationPreflightReady: ready, actorCreationVerified: false, recipientAccessVerified: false, issuanceEnabled: false }, null, 2))
if (!ready) process.exitCode = 1
