import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHierarchyAuditLabClient } from '../src/hierarchyAuditLabClient.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(backendRoot, '..')
for (const environmentPath of [
  path.join(backendRoot, '.env.local'),
  path.join(projectRoot, '.env.local'),
  path.join(backendRoot, '.env'),
  path.join(projectRoot, '.env'),
]) {
  if (fs.existsSync(environmentPath)) dotenv.config({ path: environmentPath, override: false, quiet: true })
}

function option(name) {
  const exact = process.argv.find((argument) => argument.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function safeError(error) {
  return { error: error.code || 'HIERARCHY_AUDIT_LAB_FAILED', status: error.status || 1 }
}

const settings = {
  alfrescoTarget: (process.env.ALFRESCO_TARGET || '').replace(/\/+$/, ''),
  hierarchyService: {
    username: process.env.ALFRESCO_HIERARCHY_SERVICE_USERNAME || '',
    password: process.env.ALFRESCO_HIERARCHY_SERVICE_PASSWORD || '',
    containerNodeId: process.env.ALFRESCO_HIERARCHY_CONTAINER_NODE_ID || '',
    auditContainerNodeId: process.env.ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID || '',
    labContainerNodeId: process.env.ALFRESCO_HIERARCHY_LAB_CONTAINER_NODE_ID || '',
    storage: process.env.ALFRESCO_HIERARCHY_STORAGE || '',
  },
}
const labContainerNodeId = process.env.ALFRESCO_HIERARCHY_LAB_CONTAINER_NODE_ID || ''
const runId = option('--run-id') || process.env.ALFRESCO_HIERARCHY_LAB_RUN_ID || ''
const confirmLabWrites = process.argv.includes('--confirm-lab-writes')

try {
  const client = createHierarchyAuditLabClient(settings, { labContainerNodeId, runId, confirmLabWrites })
  const container = await client.getLabContainer()
  const event = await client.createEvent()
  const readBack = await client.getEvent(event.id)
  if (readBack.id !== event.id || readBack.properties?.['gdo:claveEvento'] !== event.properties?.['gdo:claveEvento']) {
    throw Object.assign(new Error('HIERARCHY_AUDIT_LAB_UUID_READ_MISMATCH'), {
      code: 'HIERARCHY_AUDIT_LAB_UUID_READ_MISMATCH', status: 409,
    })
  }
  const listedChildren = await client.listChildren()
  const listedEvent = listedChildren.find((child) => child.id === event.id)
  if (!listedEvent || listedEvent.nodeType !== 'gdo:eventoJerarquia') {
    throw Object.assign(new Error('HIERARCHY_AUDIT_LAB_CHILD_LIST_VERIFICATION_FAILED'), {
      code: 'HIERARCHY_AUDIT_LAB_CHILD_LIST_VERIFICATION_FAILED', status: 409,
    })
  }
  const repeated = await client.createEvent()
  if (repeated.id !== event.id || repeated.reused !== true) {
    throw Object.assign(new Error('HIERARCHY_AUDIT_LAB_REPEAT_RUN_MISMATCH'), {
      code: 'HIERARCHY_AUDIT_LAB_REPEAT_RUN_MISMATCH', status: 409,
    })
  }

  console.log(JSON.stringify({
    ok: true,
    runId,
    container: { id: container.id, name: container.name },
    event: { id: event.id, name: event.name, nodeType: event.nodeType, parentId: event.parentId, reused: event.reused },
    repeatRun: { sameEventId: repeated.id === event.id, reused: repeated.reused },
    childrenContainEvent: true,
    writeScope: 'GD_JERARQUIAS_LAB only; no update or delete operations are issued.',
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, ...safeError(error) }, null, 2))
  process.exitCode = 1
}
