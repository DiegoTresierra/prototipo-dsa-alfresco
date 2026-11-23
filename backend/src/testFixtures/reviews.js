import { fixture } from './proposals.js'
import { createResponseReviewDecisions } from '../responseReviewDecisions.js'

export async function setup(role = 'especialista') {
  const f = fixture()
  f.actor.functionalRole = role; f.session.functionalRole = role
  f.settings.groupMappings.dependencies.DTI = 'GROUP_DTI'
  f.settings.officeInboxNodeIds.DTI = { porAtender: 'dti-inbox' }
  const sessions = { author: f.session }
  for (const [id, functionalRole] of [['head', 'jefe-unidad'], ['wrong-head', 'jefe-unidad'], ['direction', 'direccion'], ['foreign', 'direccion']]) {
    const dependency = id === 'foreign' ? 'DTI' : 'DSA'
    const authorization = `Basic ${id}`
    f.actors.set(authorization, { id, functionalRole, dependency })
    sessions[id] = { ...f.session, alfresco: { id }, functionalRole, dependency, authorization }
  }
  const at = '2026-11-18T15:00:00Z'
  const common = { documentId: 'original', senderUserId: 'direction', senderRole: 'direccion', senderDependency: 'dsa', originAssignmentId: null, instruction: 'Atender', createdAt: at }
  const recipients = [{ ...common, id: 'author-assignment', dispatchId: 'dispatch', userId: 'author', functionalRole: role, dependency: 'dsa', status: 'ASIGNADO' },
    { ...common, id: 'other-assignment', dispatchId: 'dispatch', userId: 'other', functionalRole: 'especialista', dependency: 'dsa', status: 'ATENDIDO', attendedAt: at, attendedByUserId: 'other' }]
  const dispatches = [{ ...common, id: 'dispatch', requestKey: 'dispatch-key', priority: 'Normal', status: 'ASIGNADO', recipients }]
  const history = [{ id: 'dispatch-created', action: 'DISPATCH_CREATED', actorUserId: 'direction', at, dispatchId: 'dispatch', assignmentIds: recipients.map((r) => r.id) },
    { id: 'attended', action: 'ASSIGNMENT_ATTENDED', actorUserId: 'other', at, dispatchId: 'dispatch', assignmentIds: ['other-assignment'], requestKey: 'attended-key' }]
  f.state.original.properties['gd:asignaciones'] = JSON.stringify({ ...f.envelope(), dispatches, history })
  f.input.assignmentId = 'author-assignment'
  const proposal = await f.adapter().execute(f.input, f.session)
  f.state.now = '2026-11-19T16:00:00Z'
  const provider = { async resolveReviewers({ stage }) { return { verified: true, reviewers: [{ userId: stage === 'jefatura' ? 'head' : 'direction', groupIds: [stage === 'jefatura' ? 'GROUP_HEAD' : 'GROUP_DIRECTION'] }] } } }
  const service = (p = provider) => createResponseReviewDecisions({ alfrescoAdapter: f.adapter(), institutionalProvider: p, clock: () => new Date(f.state.now) })
  let key = 0
  const input = (action, overrides = {}) => {
    const p = f.envelope().reviewProcesses[0]
    return { documentId: 'original', processId: proposal.id, action, requestKey: `decision-${++key}`, expectedRevision: p.revision, expectedVersionId: p.snapshot.versionId,
      reason: ['OBSERVE', 'RETURN'].includes(action) ? 'Corregir la respuesta' : '', ...overrides }
  }
  return { ...f, sessions, proposal, provider, service, input, dispatches, history }
}
