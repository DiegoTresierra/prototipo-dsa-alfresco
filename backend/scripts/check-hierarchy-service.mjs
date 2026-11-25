import { parseGroupMappings } from '../src/groupMappings.js'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHierarchyServiceClient } from '../src/hierarchyServiceClient.js'

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

const config = {
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

try {
  const client = createHierarchyServiceClient(config)
  const report = await client.runReadOnlyDiagnostics(parseGroupMappings())
  console.log(JSON.stringify(report, null, 2))
  const typesReady = Object.values(report.model.types).every((type) => type.available && type.missingProperties.length === 0)
  if (!typesReady) process.exitCode = 2
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.code || 'HIERARCHY_DIAGNOSTIC_FAILED', status: error.status || 1 }, null, 2))
  process.exitCode = 1
}
