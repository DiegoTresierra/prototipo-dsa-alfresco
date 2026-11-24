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

function parseJson(name, fallback) {
  const value = process.env[name]
  if (!value) return fallback
  try { return JSON.parse(value) } catch { throw Object.assign(new Error(name), { code: `INVALID_JSON_${name}` }) }
}

function canonicalize(mapping, aliases) {
  return Object.fromEntries(Object.entries(mapping).map(([key, value]) => {
    const normalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const groups = (Array.isArray(value) ? value : [value]).map((entry) =>
      entry && typeof entry === 'object' ? entry.id || entry.groupId || entry.name || '' : entry).filter(Boolean)
    return [aliases[normalized] || key, groups.length === 1 ? groups[0] : groups]
  }))
}

function loadGroupMappings() {
  if (process.env.ALFRESCO_GROUP_MAPPINGS_JSON) {
    const mappings = parseJson('ALFRESCO_GROUP_MAPPINGS_JSON', {})
    return {
      dependencies: canonicalize(mappings.dependencies || {}, { dti: 'DTI', gddti: 'DTI', dsa: 'DSA', gddsa: 'DSA' }),
      functions: canonicalize(mappings.functions || {}, { director: 'direccion', direccion: 'direccion', jefeunidad: 'jefe-unidad', especialista: 'especialista' }),
    }
  }
  return {
    dependencies: canonicalize(parseJson('ALFRESCO_DEPENDENCY_GROUP_MAPPINGS_JSON', {}), { dti: 'DTI', gddti: 'DTI', dsa: 'DSA', gddsa: 'DSA' }),
    functions: canonicalize(parseJson('ALFRESCO_ROLE_MAPPINGS_JSON', {}), { director: 'direccion', direccion: 'direccion', jefeunidad: 'jefe-unidad', especialista: 'especialista' }),
  }
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
  const report = await client.runReadOnlyDiagnostics(loadGroupMappings())
  console.log(JSON.stringify(report, null, 2))
  const typesReady = Object.values(report.model.types).every((type) => type.available && type.missingProperties.length === 0)
  if (!typesReady) process.exitCode = 2
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.code || 'HIERARCHY_DIAGNOSTIC_FAILED', status: error.status || 1 }, null, 2))
  process.exitCode = 1
}
