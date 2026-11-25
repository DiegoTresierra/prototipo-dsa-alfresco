import test from 'node:test'
import assert from 'node:assert/strict'
import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'

const settings = { alfrescoTarget: 'https://identity.invalid', groupMappings: {
  dependencies: { DSA: 'GROUP_GD_DSA', DTI: 'GROUP_GD_DTI' }, functions: { direccion: 'GROUP_GD_DIRECCION', especialista: 'GROUP_GD_ESPECIALISTA' },
} }
const session = { alfresco: { id: 'actor' }, authorization: 'Basic fixture', authorizationStatus: 'active', dependency: 'DSA', functionalRole: 'direccion' }

function fixture() {
  const state = { enabled: true, groups: ['GROUP_GD_DSA', 'GROUP_GD_DIRECCION'], calls: [], status: 200, malformed: false }
  const fetch = async (url, options) => {
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.Authorization, session.authorization)
    state.calls.push(url)
    if (state.status !== 200) return Response.json({}, { status: state.status })
    if (url.endsWith('/people/-me-')) return Response.json({ entry: { id: 'actor', enabled: state.enabled } })
    const skip = Number(new URL(url).searchParams.get('skipCount'))
    const page = state.groups.slice(skip, skip + 1)
    return Response.json(state.malformed ? {} : { list: { entries: page.map((id) => ({ entry: { id } })), pagination: { skipCount: skip, hasMoreItems: skip + page.length < state.groups.length } } })
  }
  return { state, fetch }
}

test('paged exact memberships are verified once per operation and never cached across requests', async () => {
  const f = fixture()
  assert.equal((await revalidateInstitutionalIdentity(settings, session, f.fetch)).functionalRole, 'direccion')
  assert.equal(f.state.calls.length, 3)
  f.state.groups = ['GROUP_GD_DSA', 'GROUP_GD_ESPECIALISTA']
  await assert.rejects(revalidateInstitutionalIdentity(settings, session, f.fetch), { message: 'INSTITUTIONAL_IDENTITY_REJECTED', status: 403 })
})

test('disabled identity, changed dependency, ambiguous roles and lookalike authorities fail closed', async () => {
  const f = fixture()
  f.state.enabled = false
  await assert.rejects(revalidateInstitutionalIdentity(settings, session, f.fetch), { status: 403 })
  assert.equal(f.state.calls.length, 1, 'disabled people do not cause redundant group queries')
  f.state.enabled = true
  for (const groups of [ ['GROUP_GD_DTI', 'GROUP_GD_DIRECCION'], ['GROUP_GD_DSA', 'GROUP_GD_DIRECCION', 'GROUP_GD_ESPECIALISTA'], ['GROUP_DSA', 'GROUP_DIRECCION'] ]) {
    f.state.groups = groups
    await assert.rejects(revalidateInstitutionalIdentity(settings, session, f.fetch), { status: 403 })
  }
})

test('unavailable, denied, malformed and stalled Alfresco responses never authorize writes', async () => {
  const f = fixture()
  for (const status of [401, 403, 500, 503]) {
    f.state.status = status
    await assert.rejects(revalidateInstitutionalIdentity(settings, session, f.fetch), { status: status < 500 ? 403 : 503 })
  }
  f.state.status = 200; f.state.malformed = true
  await assert.rejects(revalidateInstitutionalIdentity(settings, session, f.fetch), { message: 'INSTITUTIONAL_IDENTITY_UNAVAILABLE' })
  await assert.rejects(revalidateInstitutionalIdentity(settings, session, async () => { throw Error('network') }), { status: 503 })
  await assert.rejects(revalidateInstitutionalIdentity(settings, session, async (url) => url.endsWith('/people/-me-')
    ? Response.json({ entry: { id: 'actor', enabled: true } }) : Response.json({ list: { entries: [], pagination: { skipCount: 0, hasMoreItems: true } } })), { status: 503 })
})

test('configured technical accounts cannot act even with an active institutional session', async () => {
  for (const config of [{ hierarchyService: { username: 'Actor' } }, { distributionService: { username: 'actor' } }, { technicalUserIds: ['actor'] }]) {
    const f = fixture()
    await assert.rejects(revalidateInstitutionalIdentity({ ...settings, ...config }, session, f.fetch), /IDENTITY_REJECTED/)
    assert.equal(f.state.calls.length, 0)
  }
})
