// GET-only candidate generation. No approval, document mutation or automatic exclusion.
import { config } from '../src/config.js'
import { enumerateIssuedRecords } from '../src/alfrescoNumbering.js'
import { decodeEmissionMetadata } from '../src/officialEmissionContract.js'
import { legacyFingerprint, sha256 } from '../src/emissionReconciliation.js'

if (process.argv.length > 2) throw new Error('GET_ONLY_NO_ARGUMENTS')
const { username, password } = config.distributionService
if (!username || !password) throw new Error('READ_CREDENTIALS_REQUIRED')
const headers = { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
const get = async (path) => {
  const response = await fetch(config.alfrescoTarget + '/alfresco/api/-default-/public/alfresco/versions/1' + path, {
    method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`RECONCILIATION_GET_FAILED:${response.status}`)
  return response.json()
}
const emitidos = Object.fromEntries(['DTI', 'DSA'].map((dep) => [dep, config.officeInboxNodeIds?.[dep]?.emitidos]))
const exclusions = [], blocked = [], official = []
await enumerateIssuedRecords({ rootIds: Object.values(emitidos), get, decode: async (node) => {
  try { official.push(decodeEmissionMetadata(node)); return null } catch { /* require explicit classification */ }
  if (['gd:codigoDocumental', 'gd:cicloDocumental', 'gd:identidadEmision'].some((key) => node.properties?.[key] !== undefined)) {
    blocked.push({ documentId: node.id, reason: 'PARTIAL_OFFICIAL_METADATA_REQUIRES_REVIEW' })
  } else {
    const response = await fetch(config.alfrescoTarget + '/alfresco/api/-default-/public/alfresco/versions/1/nodes/' + encodeURIComponent(node.id) + '/content', {
      method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error(`RECONCILIATION_CONTENT_GET_FAILED:${response.status}`)
    const contentSha256 = sha256(Buffer.from(await response.arrayBuffer()))
    exclusions.push({ documentId: node.id, contentSha256, fingerprint: legacyFingerprint(node, contentSha256), reason: '' })
  }
  return null
} })
console.log(JSON.stringify({ mode: 'GET-only', issuanceEnabled: false, officialRecords: official.length, blocked,
  manifestCandidate: { version: 2, fingerprintVersion: 2, target: config.alfrescoTarget, emitidos,
    approvedBy: '', approvedAt: '', decisionReference: '', exclusions },
  instruction: 'Operator must classify each UUID, approve with institutional evidence, save manifestCandidate separately and pin its SHA-256. This output is NOT an approval.',
}, null, 2))
