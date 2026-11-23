import test from 'node:test'
import assert from 'node:assert/strict'
import { createClosurePreflight } from './closurePreflight.js'
import { attentionFixture, actor, originalId } from './testFixtures/attention.js'
import { identityResponse } from './testFixtures/institutionalIdentity.js'
import { projections } from './alfrescoDispatchRepository.js'

async function fixture() {
  const f = attentionFixture(); await f.seed()
  const session = actor('director', 'direccion')
  const person = { id: 'director', functionalRole: 'direccion', dependency: 'DSA' }
  const actors = new Map([[session.authorization, person]])
  const calls = []
  const fetchImpl = (url, options) => {
    assert.equal(options.method, 'GET', 'preflight must never write')
    assert.equal(options.headers.Authorization, session.authorization, 'never use service credentials')
    calls.push(String(url))
    return identityResponse(url, options, actors, f.settings.groupMappings) || f.fetchImpl(url, options)
  }
  return { f, session, person, calls, run: createClosurePreflight(f.settings, { fetchImpl, clock: () => new Date('2026-11-20T15:00:00Z') }),
    input: { documentId: originalId, scope: { type: 'dependency', dependency: 'dsa' } } }
}
test('GET-only actor preflight verifies secondary institutional membership and preserves all data', async () => {
  const x = await fixture(), before = structuredClone(x.f.nodes.get(originalId))
  const r = await x.run(x.input, x.session)
  assert.equal(r.summary.pending, 2)
  assert.equal(r.preliminaryCompliance, 'BLOCKED')
  assert.equal(r.formalClosureAllowed, false)
  assert.deepEqual(x.f.nodes.get(originalId), before)
})
test('integral and cross-dependency scope rejected before document lookup', async () => {
  const x = await fixture()
  for (const scope of [{ type: 'document' }, { type: 'dependency', dependency: 'dti' }]) {
    await assert.rejects(x.run({ ...x.input, scope }, x.session), e => e.status === 403)
  }
  assert.ok(!x.calls.some(u => u.includes('/nodes/')))
})
test('revoked role, disabled identity and membership failures fail closed', async () => {
  const x = await fixture()
  x.person.functionalRole = 'especialista'
  await assert.rejects(x.run(x.input, x.session), /INSTITUTIONAL_IDENTITY_REJECTED/)
  x.person.functionalRole = 'direccion'; x.person.enabled = false
  await assert.rejects(x.run(x.input, x.session), /INSTITUTIONAL_IDENTITY_REJECTED/)
  const unavailable = createClosurePreflight(x.f.settings, { fetchImpl: async () => { throw new Error('network') } })
  await assert.rejects(unavailable(x.input, x.session), /INSTITUTIONAL_IDENTITY_UNAVAILABLE/)
})
test('ACL denial and a UUID outside the institutional scope are rejected', async () => {
  const x = await fixture(); x.f.state.denyActor = true
  await assert.rejects(x.run(x.input, x.session), e => e.status === 403)
  x.f.state.denyActor = false
  x.f.folders.get('dsa-attention').clear()
  await assert.rejects(x.run(x.input, x.session), /CLOSURE_SCOPE_NOT_ALLOWED/)
  // Unknown UUID is not made visible through the technical account.
  await assert.rejects(x.run({ ...x.input, documentId: 'unknown' }, x.session))
})
test('historical absence of assignments remains indeterminate; knowledge does not imply closure', async () => {
  const x = await fixture(), node = x.f.nodes.get(originalId)
  delete node.properties['gd:asignaciones']
  delete node.properties['gd:responsablesActuales']
  delete node.properties['gd:dependenciasResponsablesActuales']
  x.f.settings.officeInboxNodeIds.DSA.porConocimiento = 'dsa-knowledge'
  x.f.folders.set('dsa-knowledge', new Set([originalId]))
  const r = await x.run(x.input, x.session)
  assert.equal(r.preliminaryCompliance, 'INDETERMINATE')
  assert.ok(r.pendingPolicies.includes('KNOWLEDGE_ONLY_POLICY_PENDING'))
})
test('a concurrent change invalidates the final read snapshot', async () => {
  const x = await fixture()
  let reads = 0
  const run = createClosurePreflight(x.f.settings, { fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET')
    const identity = identityResponse(url, options, new Map([[x.session.authorization, x.person]]), x.f.settings.groupMappings)
    if (identity) return identity
    if (new URL(url).pathname.endsWith(`/nodes/${originalId}`) && ++reads === 2) x.f.nodes.get(originalId).properties['cm:title'] = 'externally changed'
    return x.f.fetchImpl(url, options)
  } })
  await assert.rejects(run(x.input, x.session), /CLOSURE_SNAPSHOT_CHANGED/)
})
test('invalid envelope is rejected and inconsistent projections block instead of becoming success', async () => {
  const x = await fixture(), node = x.f.nodes.get(originalId)
  node.properties['gd:responsablesActuales'] = ['unrelated']
  assert.ok((await x.run(x.input, x.session)).blockingReasons.includes('PROJECTION_MISMATCH'))
  node.properties['gd:asignaciones'] = '{bad'
  await assert.rejects(x.run(x.input, x.session), /DISPATCH_INVALID_ASSIGNMENTS/)
})

test('stored cancellation flags are not institutional authority and no missing evidence is fabricated', async () => {
  const x = await fixture(), node = x.f.nodes.get(originalId), envelope = x.f.envelope()
  for (const a of envelope.dispatches[0].recipients) a.status = 'ANULADO'
  // Unrecognized extra JSON fields are deliberately NOT authority for the preflight.
  envelope.cancellations = { approved: true, functionalRole: 'direccion', source: 'alfresco' }
  node.properties['gd:asignaciones'] = JSON.stringify(envelope)
  Object.assign(node.properties, projections(envelope))
  const before = structuredClone(node)
  const r = await x.run(x.input, x.session)
  assert.equal(r.preliminaryCompliance, 'INDETERMINATE')
  assert.equal(r.summary.validCancelled, 0)
  assert.equal(r.summary.unverifiedCancelled, 2)
  assert.ok(r.blockingReasons.includes('CANCELLATION_EVIDENCE_MISSING'))
  assert.deepEqual(node, before)
})
