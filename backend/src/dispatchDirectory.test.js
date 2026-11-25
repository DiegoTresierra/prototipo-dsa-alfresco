import test from 'node:test'
import assert from 'node:assert/strict'
import { loadDispatchDirectory, loadInstitutionalDirectory } from './dispatchDirectory.js'
import { validateDispatchRequest } from './dispatchPolicy.js'

const head1 = 'fixture_head_a'
const head2 = 'fixture_head_b'
const unit = { code: 'fixture-unit', name: 'Unidad de prueba', dependency: 'DSA' }
function fixture() {
  const settings = {
    alfrescoTarget: 'https://alfresco.invalid', distributionService: { username: 'fixture-service', password: 'fixture-password' },
    groupMappings: { dependencies: { DSA: 'GROUP_DSA', DTI: 'GROUP_DTI' }, functions: { 'jefe-unidad': 'GROUP_HEADS', direccion: 'GROUP_DIRECTORS', especialista: 'GROUP_SPECIALISTS' } },
    userUnitAssignments: { [head1]: unit, [head2]: unit },
  }
  const groups = { DSA: [head1, head2], DTI: [], HEADS: [head1, head2], DIRECTORS: [], SPECIALISTS: [] }
  const calls = []
  const disabled = new Set()
  const fetch = async (url, options) => {
    calls.push(String(url))
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('fixture-service:fixture-password').toString('base64')}`)
    const parsed = new URL(url)
    let payload
    if (parsed.pathname.endsWith('/people/-me-')) payload = { entry: { id: 'fixture-service', enabled: true, capabilities: { isAdmin: false } } }
    else if (parsed.pathname.includes('/people/')) {
      const id = decodeURIComponent(parsed.pathname.split('/').at(-1))
      payload = { entry: { id, enabled: !disabled.has(id) } }
    } else {
      assert.ok(parsed.pathname.startsWith('/alfresco/service/api/groups/'))
      const group = parsed.pathname.split('/').at(-2)
      assert.ok(Object.hasOwn(groups, group), 'only configured groups may be queried')
      const skipCount = Number(parsed.searchParams.get('skipCount'))
      const users = groups[group]
      assert.ok(skipCount === 0 || skipCount < users.length, 'never request beyond total')
      payload = { data: users.slice(skipCount, skipCount + 1).map((id) => ({ shortName: id, authorityType: 'USER', fullName: 'NOT_AN_ID ', displayName: id })), paging: { skipCount, totalItems: users.length } }
    }
    return new Response(JSON.stringify(payload), { status: 200 })
  }
  return { settings, groups, calls, disabled, fetch }
}

test('classic pagination recovers both DSA heads and verifies effective service identity and people', async () => {
  const f = fixture()
  const result = await loadDispatchDirectory(f.settings, f.fetch)
  assert.deepEqual(result.recipients.map((r) => r.id), [head1, head2])
  assert.deepEqual(result.configurationErrors, [])
  assert.equal(f.calls.filter((url) => url.includes('/DSA/children')).length, 2)
  assert.ok(f.calls[0].endsWith('/people/-me-'))
})

test('generic institutional directory reuses exact paginated membership and verifies enabled Direction accounts too', async () => {
  const f = fixture()
  f.groups.DIRECTORS.push('real-director', 'disabled-director')
  f.groups.DSA.push('real-director', 'disabled-director')
  f.disabled.add('disabled-director')
  const generic = await loadInstitutionalDirectory(f.settings, f.fetch)
  assert.deepEqual(generic.recipients.filter((r) => r.functionalRole === 'direccion').map((r) => r.id), ['real-director'])
  assert.ok(!generic.recipients.some((r) => r.id === 'disabled-director'))
  assert.ok(f.calls.some((url) => url.includes('/DIRECTORS/children?') && url.includes('skipCount=1')))
  assert.ok(!(await loadDispatchDirectory(f.settings, f.fetch)).recipients.some((r) => r.functionalRole === 'direccion'))
})

test('eligible users remain visible and assignable without units or with an invalid optional unit', async () => {
  const f = fixture()
  delete f.settings.userUnitAssignments[head1]
  f.settings.userUnitAssignments[head2] = { ...unit, dependency: 'DTI' }
  const result = await loadDispatchDirectory(f.settings, f.fetch)
  assert.deepEqual(result.recipients.map((entry) => entry.id), [head1, head2])
  assert.ok(result.recipients.every((entry) => entry.unit === null))
  assert.equal(validateDispatchRequest({ documentId: 'pdf', recipientUserIds: [head1, head2], instruction: 'Revisar', priority: 'Normal', requestKey: 'retry' },
    { authorizationStatus: 'active', functionalRole: 'direccion', capabilities: ['documents:write'], dependency: 'DSA' }, result.recipients).recipients.length, 2)
})

test('new specialists appear from groups automatically, without manual user lists', async () => {
  const f = fixture()
  f.groups.DSA.push('new-specialist')
  f.groups.SPECIALISTS.push('new-specialist')
  const result = await loadDispatchDirectory(f.settings, f.fetch)
  const specialist = result.recipients.find((entry) => entry.id === 'new-specialist')
  assert.equal(specialist.functionalRole, 'especialista')
  assert.equal(specialist.unit, null)
})

test('disabled and ambiguous candidates never enter the dispatch selector', async () => {
  const f = fixture()
  f.disabled.add(head1)
  f.groups.DTI.push(head2)
  assert.deepEqual((await loadDispatchDirectory(f.settings, f.fetch)).recipients, [])
})

test('directory errors, wrong identities and malformed pages are explicit failures', async () => {
  const f = fixture()
  await assert.rejects(loadDispatchDirectory(f.settings, async () => new Response('{}', { status: 403 })), /DISPATCH_DIRECTORY_UNAVAILABLE/)
  await assert.rejects(loadDispatchDirectory(f.settings, async () => Response.json({ entry: { id: 'other-user', enabled: true } })), /DISPATCH_DIRECTORY_IDENTITY_INVALID/)
  await assert.rejects(loadDispatchDirectory(f.settings, async (url, options) => url.includes('/children') ? Response.json({ data: [] }) : f.fetch(url, options)), /DISPATCH_DIRECTORY_INVALID_RESPONSE/)
})

test('subgroups cannot silently disappear from the directory and multiple functions remain ambiguous', async () => {
  const f = fixture()
  f.groups.DIRECTORS.push(head1)
  assert.deepEqual((await loadDispatchDirectory(f.settings, f.fetch)).recipients.map((r) => r.id), [head2])
  await assert.rejects(loadDispatchDirectory(f.settings, async (url, options) => url.includes('/DSA/children')
    ? Response.json({ data: [{ shortName: 'nested', authorityType: 'GROUP' }], paging: { skipCount: 0, totalItems: 1 } })
    : f.fetch(url, options)), /DISPATCH_DIRECTORY_NESTED_GROUPS_UNSUPPORTED/)
})

test('excludes configured service identities and accepts a human independently of account spelling', async () => {
  const f = fixture()
  f.settings.hierarchyService = { username: 'reader' }
  f.settings.technicalUserIds = ['automation']
  for (const id of ['reader', 'automation', 'fixture-service', 'svc-human']) {
    f.groups.DSA.push(id)
    f.groups.SPECIALISTS.push(id)
  }
  const { recipients } = await loadDispatchDirectory(f.settings, f.fetch)
  assert.deepEqual(recipients.filter(p => p.functionalRole === 'especialista').map(p => p.id), ['svc-human'])
})

test('a privileged or unverifiable service cannot supply documentary recipients', async () => {
  const f = fixture()
  for (const capabilities of [{ isAdmin: true }, {}]) {
    await assert.rejects(loadDispatchDirectory(f.settings, async () => Response.json({
      entry: { id: f.settings.distributionService.username, enabled: true, capabilities },
    })), /DISPATCH_DIRECTORY_IDENTITY_INVALID/)
  }
})
