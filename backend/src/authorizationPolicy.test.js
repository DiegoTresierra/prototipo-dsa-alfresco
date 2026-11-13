import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilitiesFor, hasCapability } from './authorizationPolicy.js'

test('grants explicit capabilities by functional role', () => {
  assert.deepEqual(capabilitiesFor('direccion'), ['documents:read', 'documents:write', 'documents:emit'])
  assert.deepEqual(capabilitiesFor('jefe-unidad'), ['documents:read', 'documents:attend'])
  assert.equal(capabilitiesFor('especialista').includes('documents:emit'), false)
  assert.deepEqual(capabilitiesFor('unknown'), [])
})

test('requires an active session for capabilities', () => {
  assert.equal(hasCapability({ authorizationStatus: 'incomplete', capabilities: ['documents:emit'] }, 'documents:emit'), false)
  assert.equal(hasCapability({ authorizationStatus: 'active', capabilities: ['documents:emit'] }, 'documents:emit'), true)
})
