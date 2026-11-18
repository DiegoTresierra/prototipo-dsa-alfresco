import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

const emptyOrganization = () => ({ hierarchies: {}, audit: [] })

function readOrganization() {
  try {
    if (!fs.existsSync(config.organizationStorePath)) return emptyOrganization()
    const value = JSON.parse(fs.readFileSync(config.organizationStorePath, 'utf8'))
    return {
      hierarchies: value?.hierarchies && typeof value.hierarchies === 'object' ? value.hierarchies : {},
      audit: Array.isArray(value?.audit) ? value.audit : [],
    }
  } catch {
    throw new Error('ORGANIZATION_STORE_UNAVAILABLE')
  }
}

function writeOrganization(value) {
  try {
    fs.mkdirSync(path.dirname(config.organizationStorePath), { recursive: true })
    const temporaryPath = `${config.organizationStorePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(temporaryPath, config.organizationStorePath)
  } catch {
    throw new Error('ORGANIZATION_STORE_UNAVAILABLE')
  }
}

export function getHierarchyAssignments(dependency) {
  const hierarchy = readOrganization().hierarchies[String(dependency || '').toLowerCase()]
  return hierarchy && Array.isArray(hierarchy.assignments) ? hierarchy.assignments : []
}

export function replaceHierarchyAssignments(dependency, assignments, actorId) {
  const key = String(dependency || '').toLowerCase()
  const organization = readOrganization()
  const now = new Date().toISOString()
  const nextAssignments = assignments.map(({ laneId, userId, unitHeadUserId }) => ({
    laneId,
    userId,
    ...(laneId === 'especialistas' && unitHeadUserId ? { unitHeadUserId } : {}),
    dependency: key,
    updatedAt: now,
    updatedBy: actorId,
  }))
  organization.hierarchies[key] = { assignments: nextAssignments, updatedAt: now, updatedBy: actorId }
  organization.audit = [...organization.audit, {
    action: 'HIERARCHY_REPLACED',
    actorId,
    dependency: key,
    assignmentCount: nextAssignments.length,
    createdAt: now,
  }].slice(-1000)
  writeOrganization(organization)
  return nextAssignments
}
