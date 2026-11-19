// GET-only measurement using the configured technical identity, not a user session.
import { config } from '../src/config.js'
import { createAlfrescoDispatchRepository } from '../src/alfrescoDispatchRepository.js'

const dependency = process.argv[2] || 'DSA'
if (!['DSA', 'DTI'].includes(dependency)) throw new Error('Use DSA or DTI')
const service = config.distributionService
const authorization = `Basic ${Buffer.from(`${service.username}:${service.password}`).toString('base64')}`
const requests = { total: 0, children: 0, node: 0, other: 0 }
let active = 0
let maxActive = 0
const read = async (url, options) => {
  if (options.method !== 'GET') throw new Error('Measurement only permits GET')
  requests.total++
  const pathname = new URL(url).pathname
  requests[pathname.endsWith('/children') ? 'children' : pathname.includes('/nodes/') ? 'node' : 'other']++
  active++
  maxActive = Math.max(maxActive, active)
  try { return await fetch(url, options) } finally { active-- }
}
const repository = createAlfrescoDispatchRepository(config, read)
const started = performance.now()
const snapshot = await repository.loadInbox({ authorization, alfresco: { id: service.username }, functionalRole: 'direccion', dependency })
console.log(JSON.stringify({ identity: 'configured technical account; not the browser user session', dependency,
  elapsedMs: Math.round(performance.now() - started), requests, maxActive, records: snapshot.dispatches.length,
  sent: snapshot.sentDispatches.length, actorReadableNodes: snapshot.actorNodes.size, persistence: repository.kind }, null, 2))
