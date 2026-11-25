import { isValidDispatchUnit } from './dispatchPolicy.js'

// Only current assignments verified by the institutional provider establish supervision.
// No names, unit suffixes or dependency-wide supervision guesses here.
export async function resolveManagedRecipients(session, recipients, provider) {
  const dependency = String(session?.dependency || '').toLowerCase()
  const eligible = recipients.filter((recipient) => recipient.dependency === dependency)
  if (session?.functionalRole === 'direccion') return eligible
  if (session?.functionalRole !== 'jefe-unidad') return []
  const userId = session.alfresco?.id || session.user?.id
  if (typeof provider?.resolveSpecialists !== 'function' || !userId) throw pending()
  // Provider performs live paginated GETs and verifies enabled users and supervision.
  const resolution = await provider.resolveSpecialists({ userId, dependency })
  if (resolution?.verified !== true || !Array.isArray(resolution.members) ||
      resolution.members.some((member) => !member.userId || !Array.isArray(member.groupIds) ||
        !member.groupIds.length || member.groupIds.some((id) => typeof id !== 'string' || !id.startsWith('GROUP_')))) throw pending()
  const ids = new Set(resolution.members.map((member) => member.userId))
  const unit = isValidDispatchUnit(resolution.unit, dependency) ? resolution.unit : null
  return eligible.filter(recipient => recipient.functionalRole === 'especialista' && ids.has(recipient.id))
    .map(recipient => ({ ...recipient, unit }))
}

function pending() {
  return Object.assign(new Error('ORGANIZATIONAL_HIERARCHY_PENDING'), { status: 503 })
}
import { isDispatchHierarchyRevision, selectDispatchRecipients } from './dispatchPolicy.js'
import { assertHierarchyReadConfiguration, hierarchyStorageMode, safeHierarchyReadError } from './hierarchyReadService.js'


const fail = (code, status) => Object.assign(new Error(code), { status })

export async function loadUnitDispatchDirectory(session, settings) {
  let snapshot
  try {
    if (hierarchyStorageMode(settings) !== 'alfresco') throw pending()
    assertHierarchyReadConfiguration(settings)
    snapshot = await settings.organizationalHierarchyProvider?.listDispatchUnits?.({ dependency: session.dependency })
  } catch (error) {
    const code = error.code || error.message
    if (code === 'HIERARCHY_REVISION_CONFLICT') throw fail('DISPATCH_HIERARCHY_REVISION_CONFLICT', 409)
    if (code === 'HIERARCHY_PENDING_RECONCILIATION') throw fail('DISPATCH_HIERARCHY_RECONCILIATION_REQUIRED', 409)
    if (safeHierarchyReadError(error).status === 409 || /MULTIPLE_ACTIVE/.test(code)) {
      throw fail('DISPATCH_HIERARCHY_DATA_INVALID', 409)
    }
    throw fail('DISPATCH_HIERARCHY_UNAVAILABLE', 503)
  }
  if (snapshot?.verified !== true || snapshot.source !== 'alfresco' ||
      !isDispatchHierarchyRevision(snapshot.revision) || !Array.isArray(snapshot.units)) {
    throw fail('DISPATCH_HIERARCHY_UNAVAILABLE', 503)
  }
  const dependency = String(session.dependency).toLowerCase()
  const units = snapshot.units.filter((unit) => unit.dependency === dependency && unit.status === 'ACTIVA')
  const recipients = units.flatMap(({ id, name, code, head, specialists }) =>
    [head, ...specialists].filter(Boolean).map((person) => ({ ...person, unit: { id, name, code, dependency } })))
  return { requiresUnit: true, hierarchyRevision: snapshot.revision, units, recipients }
}

export async function resolveUnitDispatchRecipients(input, session, settings) {
  const directory = await loadUnitDispatchDirectory(session, settings)
  if (directory.hierarchyRevision !== input.hierarchyRevision) throw fail('DISPATCH_HIERARCHY_REVISION_CONFLICT', 409)
  if (!directory.units.some((unit) => unit.id === input.unitId)) throw fail('DISPATCH_UNIT_NOT_ALLOWED', 403)
  return selectDispatchRecipients(input, directory.recipients.filter((recipient) => recipient.unit.id === input.unitId))
}
