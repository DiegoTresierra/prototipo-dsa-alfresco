import test from 'node:test'
import assert from 'node:assert/strict'
import { assertDescriptiveModel, descriptiveProperties, emissionDate, verifyDescriptiveMetadata } from './emissionDescriptiveMetadata.js'

test('descriptive metadata requires the real writable scalar text properties and uses Lima documentary date', () => {
  const identification = { properties: Object.fromEntries(descriptiveProperties.map((key) => [key, { dataType: 'd:text', multiValued: false }])) }
  const classification = { properties: { 'gd:tipoDocumental': { dataType: 'd:text', multiValued: false } } }
  assert.doesNotThrow(() => assertDescriptiveModel(identification, classification))
  assert.equal(emissionDate(new Date('2026-01-02T03:00:00Z')), '2026-01-01')
  classification.properties['gd:tipoDocumental'].protected = true
  assert.throws(() => assertDescriptiveModel(identification, classification), /OFFICIAL_DESCRIPTIVE_MODEL_REQUIRED/)
  assert.throws(() => verifyDescriptiveMetadata({ properties: {} }, { 'gd:dependenciaOrigen': 'DSA' }), /MISMATCH/)
})
