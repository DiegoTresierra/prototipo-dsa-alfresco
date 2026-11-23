import { validateClosureEvidence, evidenceHash } from './closureEvidenceContract.js'
import { readInstitutionalGroups } from './institutionalIdentity.js'
import { resolveRole } from './roleResolver.js'

// Internal reader over an actor-authorized preflight snapshot. Never use as an HTTP handler.
export async function readClosureEvidence({ envelope, scope, session, settings, get, fetchImpl, institutionalProvider, checkedAt }) {
  const result = { cancellations: Object.create(null), knowledge: undefined, evidenceIssues: [] }
  const issue = (code, blocked = false) => result.evidenceIssues.push({ code, blocked })
  let extension
  try { extension = validateClosureEvidence(envelope) } catch { issue('CLOSURE_EVIDENCE_INVALID', true); return result }
  if (!extension) return result
  const people = new Map()
  async function person(id) {
    if (!people.has(id)) people.set(id, (async () => {
      const p = (await get(`/api/-default-/public/alfresco/versions/1/people/${encodeURIComponent(id)}`)).entry
      if (p?.id !== id || p.enabled !== true) throw new Error('identity')
      const groups = await readInstitutionalGroups(settings.alfrescoTarget, id, session.authorization, fetchImpl)
      const role = resolveRole(groups, settings.groupMappings, id)
      if (role.authorizationStatus !== 'active' || role.dependency.toLowerCase() !== scope.dependency) throw new Error('identity')
      return { ...role, groups }
    })())
    return people.get(id)
  }
  async function authority(r, action, directionRequired = true) {
    const p = await person(r.actorUserId)
    if (directionRequired && p.functionalRole !== 'direccion') throw new Error('competence')
    if (typeof institutionalProvider?.verifyClosureEvidence !== 'function') throw new Error('provider')
    const a = await institutionalProvider.verifyClosureEvidence({ documentId: envelope.documentId, dependency: scope.dependency,
      recordId: r.id, eventId: r.eventId, payloadHash: evidenceHash(r), action, actorUserId: r.actorUserId,
      documentRevision: r.documentRevision, authorization: session.authorization })
    if (a?.verified !== true || a.source !== 'alfresco' || typeof a.reference !== 'string' || !a.reference.trim() ||
        a.documentId !== envelope.documentId || a.dependency !== scope.dependency || a.actorUserId !== r.actorUserId ||
        a.recordId !== r.id || a.eventId !== r.eventId || a.payloadHash !== evidenceHash(r) || a.action !== action ||
        a.documentRevision !== r.documentRevision || a.authorizedAt !== r.at ||
        !Array.isArray(a.groupIds) || !a.groupIds.length || !a.groupIds.every(g => p.groups.includes(g))) throw new Error('provider')
    return { ...a, functionalRole: p.functionalRole, checkedAt }
  }
  const stamp = reference => ({ verified: true, source: 'alfresco', reference })
  const binding = { schemaVersion: 1, documentId: envelope.documentId, dependency: scope.dependency, envelopeRevision: envelope.revision }
  for (const r of extension.cancellations.filter(r => r.dependency === scope.dependency)) {
    try {
      if (Date.parse(r.at) > Date.parse(checkedAt)) throw new Error('future')
      const a = await authority(r, 'CANCEL_ASSIGNMENT')
      result.cancellations[r.assignmentId] = { ...binding, ...stamp(r.eventId), assignmentId: r.assignmentId, reason: r.reason, at: r.at,
        authorization: { ...stamp(a.reference), actorUserId: r.actorUserId, functionalRole: a.functionalRole, dependency: scope.dependency, checkedAt } }
    } catch { issue('CANCELLATION_AUTHORIZATION_UNVERIFIED') }
  }
  const c = extension.classifications.find(r => r.dependency === scope.dependency)
  if (c) {
    try {
      if (Date.parse(c.at) > Date.parse(checkedAt)) throw new Error('future')
      const a = await authority(c, 'CLASSIFY_KNOWLEDGE')
      // The provider must attest the COMPLETE institutional roster and exclusive classification,
      // not merely approve the subset stored in JSON.
      if (a.exclusive !== c.exclusive || !Array.isArray(a.recipientUserIds) || new Set(a.recipientUserIds).size !== a.recipientUserIds.length ||
          JSON.stringify([...a.recipientUserIds].sort()) !== JSON.stringify([...c.recipientUserIds].sort())) throw new Error('roster')
      for (const id of c.recipientUserIds) await person(id)
      const confirmations = []
      for (const r of extension.confirmations.filter(r => r.classificationId === c.id)) {
        if (Date.parse(r.at) > Date.parse(checkedAt)) throw new Error('future')
        await authority(r, 'ACKNOWLEDGE_KNOWLEDGE', false)
        confirmations.push({ ...stamp(r.eventId), documentId: envelope.documentId, dependency: scope.dependency, userId: r.actorUserId, at: r.at })
      }
      result.knowledge = { ...binding, classification: { ...stamp(a.reference), exclusive: c.exclusive },
        recipients: { ...stamp(a.reference), userIds: [...c.recipientUserIds] }, confirmations }
    } catch { issue('KNOWLEDGE_AUTHORIZATION_UNVERIFIED') }
  }
  return result
}
