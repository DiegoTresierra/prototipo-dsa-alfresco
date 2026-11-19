import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { planEmissionModel } from './emissionModelPlan.js'
import { proposedEmissionProperties } from './officialEmissionContract.js'

const patch = JSON.parse(fs.readFileSync(new URL('../alfresco-model/gd-identificacion-emission.cmm.json', import.meta.url), 'utf8'))
const model = { name: 'gd_uac', namespacePrefix: 'gd', namespaceUri: 'https://uandina.edu.pe/model/gd/1.0', status: 'ACTIVE' }
const original = [{ name: 'numero', dataType: 'd:text', multiValued: false, indexed: true }]
const aspect = { name: 'identificacion', properties: original }

test('emission CMM fragment adds exactly three local names, preserves originals and has no defaults/constraints', () => {
  const before = JSON.stringify(aspect)
  const plan = planEmissionModel(model, aspect, patch)
  assert.deepEqual(plan.missing, Object.values(proposedEmissionProperties).filter((name) => name !== 'gd:numero'))
  assert.equal(JSON.stringify(aspect), before)
  assert.equal(plan.additivePatch.name, 'identificacion')
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(patch.properties.map((p) => p.dataType), ['d:text', 'd:int', 'd:text'])
  for (const property of patch.properties) {
    assert.equal(property.multiValued, false)
    assert.equal(property.mandatory, false)
    assert.equal(property.mandatoryEnforced, false)
    assert.equal(property.indexed, false)
    assert.equal(property.facetable, 'FALSE')
    assert.equal(property.indexTokenisationMode, 'FALSE')
    assert.equal(property.defaultValue, undefined)
    assert.equal(property.constraints, undefined)
  }
})

test('read-only plan is idempotent and reports conflicts without replacing properties', () => {
  const populated = { ...aspect, properties: [...original, ...structuredClone(patch.properties)] }
  assert.deepEqual(planEmissionModel(model, populated, patch).missing, [])
  populated.properties[1].multiValued = true
  populated.properties[2].defaultValue = 2026
  populated.properties[3].constraints = [{ type: 'MINMAX' }]
  assert.equal(planEmissionModel(model, populated, patch).conflicts.length, 3)
  assert.throws(() => planEmissionModel({ ...model, status: 'DRAFT' }, aspect, patch), /IDENTITY_MISMATCH/)
  assert.throws(() => planEmissionModel(model, { ...aspect, name: 'tramite' }, patch), /IDENTITY_MISMATCH/)
})

test('inert CMM token/facet normalization is visible without claiming an indexed field', () => {
  const properties = patch.properties.map((p) => ({ ...p, facetable: 'UNSET', indexTokenisationMode: 'TRUE' }))
  const result = planEmissionModel(model, { ...aspect, properties }, patch)
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.notes.length, 6)
})

test('verification script refuses apply before issuing a request', async () => {
  const previousArgs = process.argv
  const previousFetch = globalThis.fetch
  process.argv = ['node', 'verify-emission-model.mjs', '--apply']
  globalThis.fetch = () => { throw new Error('unexpected network') }
  try {
    await assert.rejects(import('../scripts/verify-emission-model.mjs?reject-apply'), /UNSUPPORTED_ARGUMENT/)
  } finally {
    process.argv = previousArgs
    globalThis.fetch = previousFetch
  }
})
