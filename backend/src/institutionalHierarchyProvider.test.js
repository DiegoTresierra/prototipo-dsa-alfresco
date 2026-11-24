import test from 'node:test'
import assert from 'node:assert/strict'
import { createInstitutionalHierarchyProvider, readPendingHierarchyOperations } from './institutionalHierarchyProvider.js'
import { resolveManagedRecipients } from './organizationalHierarchy.js'

function fixture() {
  const state = { revision: 'a'.repeat(64), changed: false, pending: [], assignments: [
    { unitId: 'unit-a', userId: 'head', role: 'jefe-unidad', dependency: 'DSA', status: 'ACTIVA' },
    { unitId: 'unit-a', userId: 'staff', role: 'especialista', dependency: 'DSA', status: 'ACTIVA' },
    { unitId: 'unit-b', userId: 'other', role: 'especialista', dependency: 'DSA', status: 'ACTIVA' },
  ], people: new Map([['head', 'jefe-unidad'], ['staff', 'especialista'], ['other', 'especialista'], ['director', 'direccion']]) }
  const directory = {
    async validateAssignmentCandidate(id, { dependency, role }) {
      if (state.people.get(id) !== role || dependency !== 'DSA') throw new Error('LIVE_MEMBERSHIP_REVOKED')
      return { id, role, dependency, enabled: true, groups: ['GROUP_DSA', `GROUP_${role}`] }
    },
    async listCandidates({ dependency, role }) {
      return Promise.all([...state.people].filter(([, r]) => r === role).map(([id]) => directory.validateAssignmentCandidate(id, { dependency, role })))
    },
  }
  const repository = {
    async getRevision() { return state.changed ? 'b'.repeat(64) : state.revision },
    async listUnits() { return { units: ['unit-a', 'unit-b'].map(id => ({ id, dependency: 'DSA', status: 'ACTIVA' })) } },
    async listAssignments() { return { assignments: state.assignments } },
  }
  let reads = 0
  const provider = createInstitutionalHierarchyProvider({ repository, directory,
    groupMappings: { dependencies: { DSA: 'GROUP_DSA' } },
    pendingOperations: async () => { if (++reads === 2 && state.changeDuringRead) state.changed = true; return state.pending },
  })
  return { state, provider }
}

test('live Alfresco hierarchy restricts head dispatch to specialists in its own unit', async () => {
  const { provider } = fixture()
  const recipients = ['staff', 'other'].map(id => ({ id, dependency: 'dsa', functionalRole: 'especialista' }))
  const allowed = await resolveManagedRecipients({ functionalRole: 'jefe-unidad', dependency: 'DSA', alfresco: { id: 'head' } }, recipients, provider)
  assert.deepEqual(allowed.map(r => r.id), ['staff'])
})

test('reviewers resolve from current unit assignment and exact live institutional groups', async () => {
  const { provider } = fixture()
  const input = { authorUserId: 'staff', authorRole: 'especialista', dependency: 'dsa', stage: 'jefatura' }
  assert.deepEqual((await provider.resolveReviewers(input)).reviewers.map(p => p.userId), ['head'])
  assert.deepEqual((await provider.resolveReviewers({ ...input, stage: 'direccion' })).reviewers.map(p => p.userId), ['director'])
})

test('historical reassignment records do not duplicate active duties or retain authority for the previous head', async () => {
  const { state, provider } = fixture()
  state.assignments.push({ ...state.assignments[1], unitId: 'unit-b', status: 'INACTIVA' })
  assert.deepEqual((await provider.resolveSpecialists({ userId: 'head', dependency: 'dsa' })).members.map(p => p.userId), ['staff'])
  state.assignments[0].status = 'INACTIVA'
  state.assignments.push({ ...state.assignments[0], userId: 'replacement-head', status: 'ACTIVA' })
  state.people.set('replacement-head', 'jefe-unidad')
  const input = { authorUserId: 'staff', authorRole: 'especialista', dependency: 'dsa', stage: 'jefatura' }
  assert.deepEqual((await provider.resolveReviewers(input)).reviewers.map(p => p.userId), ['replacement-head'])
  await assert.rejects(provider.resolveSpecialists({ userId: 'head', dependency: 'dsa' }), /ACTIVE_RELATION_AMBIGUOUS/)
})

test('missing, duplicated, disabled or revoked supervisors never yield authority', async () => {
  for (const kind of ['missing', 'duplicate', 'revoked', 'changed', 'pending']) {
    const { state, provider } = fixture()
    if (kind === 'missing') state.assignments.shift()
    if (kind === 'duplicate') state.assignments.push({ ...state.assignments[0], userId: 'head-other' })
    if (kind === 'revoked') state.people.delete('head')
    if (kind === 'changed') state.changeDuringRead = true
    if (kind === 'pending') state.pending.push({ operationId: 'uncertain' })
    await assert.rejects(provider.resolveReviewers({ authorUserId: 'staff', authorRole: 'especialista', dependency: 'dsa', stage: 'jefatura' }), undefined, kind)
  }
})

test('ambiguous specialist units, foreign dependency and multiple competent directions block routing', async () => {
  const { state, provider } = fixture()
  state.assignments.push({ ...state.assignments[1], unitId: 'unit-b' })
  await assert.rejects(provider.resolveSpecialists({ userId: 'head', dependency: 'dsa' }), /AMBIGUOUS/)
  await assert.rejects(provider.resolveSpecialists({ userId: 'head', dependency: 'dti' }), /PENDING/)
  state.assignments.pop()
  state.people.set('director-other', 'direccion')
  await assert.rejects(provider.resolveReviewers({ authorUserId: 'head', authorRole: 'jefe-unidad', dependency: 'dsa', stage: 'direccion' }), /DIRECTION_AMBIGUOUS/)
})

test('direction-origin review skips artificial unit steps and self-approval remains a decision policy', async () => {
  const { provider } = fixture()
  assert.equal((await provider.resolveReviewers({ authorUserId: 'director', authorRole: 'direccion', dependency: 'dsa', stage: 'direccion' })).reviewers[0].userId, 'director')
  await assert.rejects(provider.resolveReviewers({ authorUserId: 'director', authorRole: 'direccion', dependency: 'dsa', stage: 'jefatura' }), /ROUTE_INVALID/)
})

test('all administration journals, including orphan partial operations, block resolution until reconciled', async () => {
  const events = [
    { id: 'start', idOperacionEvento: 'head-change', faseEvento: 'INICIADA', fechaEvento: '2026-11-24T12:00:00Z', dependenciaEvento: 'DSA' },
    { id: 'complete', idOperacionEvento: 'head-change', faseEvento: 'COMPLETADA', fechaEvento: '2026-11-24T12:01:00Z', dependenciaEvento: 'DSA' },
    { id: 'orphan', idOperacionEvento: 'specialist-assignment', faseEvento: 'PARCIAL', fechaEvento: '2026-11-24T12:02:00Z', dependenciaEvento: 'DSA' },
  ]
  const repository = { async listEvents({ page, pageSize }) { return { events, pagination: { page, pageSize, totalItems: events.length, totalPages: 1, hasMoreItems: false } } } }
  assert.deepEqual((await readPendingHierarchyOperations(repository, 'DSA')).map(p => p.operationId), ['specialist-assignment'])
  events.push({ ...events[1], id: 'late-failure', faseEvento: 'PARCIAL', fechaEvento: '2026-11-24T12:03:00Z' })
  assert.deepEqual((await readPendingHierarchyOperations(repository, 'DSA')).map(p => p.operationId).sort(), ['head-change', 'specialist-assignment'])
})

test('incomplete audit pages cannot be mistaken for an absence of pending administrative operations', async () => {
  const repository = { async listEvents({ page, pageSize }) { return { events: [], pagination: { page, pageSize, totalItems: 1, totalPages: 1, hasMoreItems: false } } } }
  await assert.rejects(readPendingHierarchyOperations(repository, 'DSA'), /COVERAGE_INCOMPLETE/)
})
