import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHierarchyPersistenceClient } from '../src/hierarchyPersistenceClient.js'

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
  return { error: error.code || 'HIERARCHY_LAB_FAILED', status: error.status || 1 }
}

const confirmed = process.argv.includes('--confirm-lab-writes')
const runId = option('--run-id') || process.env.ALFRESCO_HIERARCHY_LAB_RUN_ID || ''
const settings = {
  alfrescoTarget: (process.env.ALFRESCO_TARGET || '').replace(/\/+$/, ''),
  hierarchyService: {
    username: process.env.ALFRESCO_HIERARCHY_SERVICE_USERNAME || '',
    password: process.env.ALFRESCO_HIERARCHY_SERVICE_PASSWORD || '',
    containerNodeId: process.env.ALFRESCO_HIERARCHY_CONTAINER_NODE_ID || '',
    storage: process.env.ALFRESCO_HIERARCHY_STORAGE || '',
  },
}
const labContainerNodeId = process.env.ALFRESCO_HIERARCHY_LAB_CONTAINER_NODE_ID || ''

try {
  const client = createHierarchyPersistenceClient(settings, {
    labContainerNodeId,
    runId,
    confirmLabWrites: confirmed,
  })
  const container = await client.getLabContainer()
  const unit = await client.createUnit()
  const unitAfterCreate = await client.getNode(unit.id)
  await client.listChildren(unit.id)
  const assignment = await client.createAssignment(unit.id)
  const assignmentAfterCreate = await client.getNode(assignment.id)
  if (assignmentAfterCreate.properties?.['gdo:idUnidad'] !== unit.id || assignmentAfterCreate.parentId !== unit.id) {
    throw Object.assign(new Error('HIERARCHY_LAB_ASSIGNMENT_UNIT_MISMATCH'), { code: 'HIERARCHY_LAB_ASSIGNMENT_UNIT_MISMATCH', status: 409 })
  }
  const inactiveAssignment = await client.updateAssignmentStatus(assignment.id, unit.id, 'INACTIVA')
  const assignmentAfterUpdate = await client.getNode(inactiveAssignment.id)
  if (assignmentAfterUpdate.properties?.['gdo:estadoAsignacion'] !== 'INACTIVA') {
    throw Object.assign(new Error('HIERARCHY_LAB_UPDATE_VERIFICATION_FAILED'), { code: 'HIERARCHY_LAB_UPDATE_VERIFICATION_FAILED', status: 409 })
  }
  console.log(JSON.stringify({
    ok: true,
    runId,
    container: { id: container.id, name: container.name },
    unit: { id: unitAfterCreate.id, name: unitAfterCreate.name, nodeType: unitAfterCreate.nodeType, reused: unit.reused },
    assignment: { id: assignmentAfterUpdate.id, name: assignmentAfterUpdate.name, nodeType: assignmentAfterUpdate.nodeType,
      parentId: assignmentAfterUpdate.parentId, unitId: assignmentAfterUpdate.properties['gdo:idUnidad'],
      status: assignmentAfterUpdate.properties['gdo:estadoAsignacion'], reused: assignment.reused },
    cleanup: 'Nodes are marked with ZZ_LAB and must be removed later by an authorized administrator.',
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, ...safeError(error) }, null, 2))
  process.exitCode = 1
}

