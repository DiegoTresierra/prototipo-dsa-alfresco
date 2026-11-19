import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { planDispatchModel } from './dispatchModelPlan.js'

const patch = JSON.parse(fs.readFileSync(new URL('../alfresco-model/gd-tramite-dispatch.cmm.json', import.meta.url)))
const model = { name: 'gd_uac', namespacePrefix: 'gd', namespaceUri: 'https://uandina.edu.pe/model/gd/1.0', status: 'ACTIVE' }
test('CMM plan adds only new properties; never alters existing singular responsibility or gd:estado', () => {
  const original = ['estado', 'responsableActual', 'dependenciaResponsableActual'].map((name) => ({ name, dataType: 'd:text', multiValued: false }))
  const aspect = { name: 'tramite', properties: original }
  const plan = planDispatchModel(model, aspect, patch)
  assert.deepEqual(plan.properties.map((property) => property.name), ['asignaciones', 'responsablesActuales', 'dependenciasResponsablesActuales'])
  assert.deepEqual(aspect.properties, original)
  assert.equal(plan.properties[0].indexed, false)
  assert.ok(plan.properties.slice(1).every((property) => property.multiValued))
  assert.equal(planDispatchModel(model, { ...aspect, properties: [...original, ...patch.properties] }, patch).properties.length, 0)
})
test('CMM deployment plan rejects incompatible existing definitions or another namespace/model', () => {
  assert.throws(() => planDispatchModel({ ...model, namespacePrefix: 'other' }, { name: 'tramite', properties: [] }, patch), /IDENTITY_MISMATCH/)
  assert.throws(() => planDispatchModel(model, { name: 'tramite', properties: [{ ...patch.properties[1], multiValued: false }] }, patch), /PROPERTY_CONFLICT/)
})
