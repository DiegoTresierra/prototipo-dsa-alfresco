import { isValidDispatchUnit } from './dispatchPolicy.js'

// Only current assignments verified by the institutional provider establish supervision.
// No names, unit suffixes or dependency-wide supervision guesses here.
export async function resolveManagedRecipients(session, recipients, provider) {
  const dependency = String(session?.dependency || '').toLowerCase()
  const eligible = recipients.filter((recipient) => recipient.dependency === dependency)
  if (session?.functionalRole === 'direccion') return eligible
  if (session?.functionalRole !== 'jefe-unidad') return []
  const userId = session.alfresco?.id || session.user?.id
  if (!provider || !userId) throw pending()
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
