import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyDirectory } from './hierarchyDirectory.js'

const serviceUsername = 'fixture_hierarchy'
const settings = {
  alfrescoTarget: 'https://alfresco.test',
  hierarchyService: { username: serviceUsername, password: 'not-a-real-secret', containerNodeId: '11111111-1111-4111-8111-111111111111', storage: 'alfresco' },
  groupMappings: {
    dependencies: { DSA: 'GROUP_GD_DSA', DTI: 'GROUP_GD_DTI' },
    functions: { direccion: 'GROUP_GD_DIRECCION', 'jefe-unidad': 'GROUP_GD_JEFE_UNIDAD', especialista: 'GROUP_GD_ESPECIALISTA' },
  },
}

test('classic institutional membership recovers both heads without relying on the incomplete v1 listing or unit mapping', async () => {
  const fake = fakeDirectory({ memberships: {
    GROUP_GD_DSA: ['head-one', 'head-two'], GROUP_GD_JEFE_UNIDAD: ['head-one', 'head-two'],
  }, people: { 'head-one': {}, 'head-two': {} } })
  const candidates = await createHierarchyDirectory(settings, { fetchImpl: fake.fetchImpl }).listCandidates({ dependency: 'DSA', role: 'jefe-unidad' })
  assert.deepEqual(candidates.map(person => person.id), ['head-one', 'head-two'])
  assert.equal(fake.calls.some(call => call.pathname.endsWith('/members')), false)
  assert.ok(candidates.every(person => person.groups.includes('GROUP_GD_DSA') && person.groups.includes('GROUP_GD_JEFE_UNIDAD')))
})

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeDirectory({ groupFailures = {}, people = {}, memberships = {} } = {}) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    const method = options.method || 'GET'
    calls.push({ method, pathname: parsed.pathname })
    if (parsed.pathname.endsWith('/authentication/versions/1/tickets')) return response(201, { entry: { id: 'fake-ticket' } })
    if (parsed.pathname.endsWith('/people/-me-')) return response(200, { entry: { id: serviceUsername, enabled: true, capabilities: { isAdmin: false } } })
    const groupMatch = parsed.pathname.match(/\/service\/api\/groups\/([^/]+)\/children$/)
    if (groupMatch) {
      const groupId = `GROUP_${decodeURIComponent(groupMatch[1])}`
      if (groupFailures[groupId]) return response(groupFailures[groupId], { error: 'group access denied' })
      const page = (memberships[groupId] || []).map((id) => ({ shortName: id, authorityType: 'USER' }))
      return response(200, { data: page, paging: { skipCount: 0, totalItems: page.length } })
    }
    const personMatch = parsed.pathname.match(/\/people\/([^/]+)$/)
    if (personMatch) {
      const id = decodeURIComponent(personMatch[1])
      const person = people[id]
      return person ? response(200, { entry: { id, enabled: true, displayName: id, capabilities: { isAdmin: false }, ...person } })
        : response(404, { error: 'person not found' })
    }
    return response(404, { error: 'unexpected request' })
  }
  return { fetchImpl, calls }
}

test('lists only enabled, unambiguous, nontechnical candidates belonging to the requested dependency and function groups', async () => {
  const fake = fakeDirectory({
    memberships: {
      GROUP_GD_DSA: ['dsa-specialist', 'disabled', 'admin', serviceUsername, 'dsa-jefe', 'ambiguous'],
      GROUP_GD_DTI: ['dti-specialist', 'ambiguous'],
      GROUP_GD_ESPECIALISTA: ['dsa-specialist', 'disabled', 'admin', 'dti-specialist'],
      GROUP_GD_JEFE_UNIDAD: ['dsa-jefe'],
      GROUP_GD_DIRECCION: [],
    },
    people: {
      'dsa-specialist': { displayName: 'Especialista DSA' },
      disabled: { enabled: false },
      admin: { capabilities: { isAdmin: true } },
      [serviceUsername]: {},
      'dsa-jefe': {},
      'dti-specialist': {},
      ambiguous: {},
    },
  })
  const directory = createHierarchyDirectory(settings, { fetchImpl: fake.fetchImpl })
  const candidates = await directory.listCandidates({ dependency: 'DSA', role: 'especialista' })
  assert.deepEqual(candidates.map((person) => person.id), ['dsa-specialist'])
  assert.equal(candidates[0].dependency, 'DSA')
  assert.equal(candidates[0].role, 'especialista')
  assert.ok(fake.calls.some((call) => call.pathname.endsWith('/groups/GD_DTI/children')))
})

test('validates enabled status, dependency, exact function group and rejects ambiguous memberships', async () => {
  const fake = fakeDirectory({
    memberships: {
      GROUP_GD_DSA: ['dsa-specialist', 'disabled', 'wrong-role', 'ambiguous'],
      GROUP_GD_DTI: ['dti-specialist', 'ambiguous'],
      GROUP_GD_ESPECIALISTA: ['dsa-specialist', 'dti-specialist', 'disabled', 'ambiguous'],
      GROUP_GD_JEFE_UNIDAD: ['wrong-role'],
      GROUP_GD_DIRECCION: [],
    },
    people: {
      'dsa-specialist': {}, 'dti-specialist': {}, disabled: { enabled: false }, 'wrong-role': {}, ambiguous: {},
    },
  })
  const directory = createHierarchyDirectory(settings, { fetchImpl: fake.fetchImpl })
  await assert.rejects(directory.validateAssignmentCandidate('disabled', { dependency: 'DSA', role: 'especialista' }), /HIERARCHY_USER_DISABLED/)
  await assert.rejects(directory.validateAssignmentCandidate('dti-specialist', { dependency: 'DSA', role: 'especialista' }), /HIERARCHY_USER_DEPENDENCY_MISMATCH/)
  await assert.rejects(directory.validateAssignmentCandidate('wrong-role', { dependency: 'DSA', role: 'especialista' }), /HIERARCHY_USER_FUNCTION_MISMATCH/)
  await assert.rejects(directory.validateAssignmentCandidate('ambiguous', { dependency: 'DSA', role: 'especialista' }), /HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS/)
  assert.equal((await directory.validateAssignmentCandidate('dsa-specialist', { dependency: 'DSA', role: 'especialista' })).enabled, true)
})

test('rejects missing membership and excludes administrative and technical accounts', async () => {
  const fake = fakeDirectory({
    memberships: { GROUP_GD_DSA: ['admin', serviceUsername], GROUP_GD_ESPECIALISTA: ['admin', serviceUsername] },
    people: { admin: { capabilities: { isAdmin: true } }, [serviceUsername]: {} },
  })
  const directory = createHierarchyDirectory(settings, { fetchImpl: fake.fetchImpl })
  await assert.rejects(directory.validateAssignmentCandidate('outsider', { dependency: 'DSA', role: 'especialista' }), /HIERARCHY_USER_NOT_IN_CONFIGURED_GROUPS/)
  await assert.rejects(directory.validateAssignmentCandidate('admin', { dependency: 'DSA', role: 'especialista' }), /HIERARCHY_TECHNICAL_ACCOUNT_NOT_ASSIGNABLE/)
  await assert.rejects(directory.validateAssignmentCandidate(serviceUsername, { dependency: 'DSA', role: 'especialista' }), /HIERARCHY_TECHNICAL_ACCOUNT_NOT_ASSIGNABLE/)
  await assert.rejects(directory.listCandidates({ dependency: 'DSA', role: 'director' }), /HIERARCHY_ASSIGNMENT_ROLE_INVALID/)
})

test('does not mask Alfresco authentication or group permission failures', async () => {
  const fake = fakeDirectory({ groupFailures: { GROUP_GD_DSA: 403 } })
  const directory = createHierarchyDirectory(settings, { fetchImpl: fake.fetchImpl })
  await assert.rejects(directory.listCandidates({ dependency: 'DSA', role: 'especialista' }), (error) => error.status === 403 && error.code === 'HIERARCHY_ALFRESCO_HTTP_403')
})

test('distinguishes a missing Alfresco person (404) from a REST permission failure (403)', async () => {
  const fake = fakeDirectory({
    memberships: { GROUP_GD_DSA: ['missing-person', 'active-person'], GROUP_GD_ESPECIALISTA: ['missing-person', 'active-person'] },
    people: { 'active-person': {} },
  })
  const directory = createHierarchyDirectory(settings, { fetchImpl: fake.fetchImpl })
  await assert.rejects(directory.validateAssignmentCandidate('missing-person', { dependency: 'DSA', role: 'especialista' }),
    (error) => error.status === 404 && error.code === 'HIERARCHY_USER_NOT_FOUND')
  assert.deepEqual((await directory.listCandidates({ dependency: 'DSA', role: 'especialista' })).map((person) => person.id), ['active-person'])
})
