import { parseGroupMappings, distributionGroupIds } from './groupMappings.js'
import { createDispatchRepository } from './dispatchRepository.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRole } from './roleResolver.js'

const fixtureGroups = {
  dependencies: {
    DTI: 'GROUP_GD_DTI',
    DSA: 'GROUP_GD_DSA',
  },
  functions: {
    direccion: 'GROUP_GD_DIRECCION',
    'jefe-unidad': 'GROUP_GD_JEFE_UNIDAD',
    especialista: 'GROUP_GD_ESPECIALISTA',
  },
}

const resolve = (groups) => resolveRole(groups, fixtureGroups, 'fixture_director_b')

test('resolves each dependency and function combination', () => {
  assert.equal(resolve(['GROUP_GD_DTI', 'GROUP_GD_DIRECCION']).roleId, 'director-dti')
  assert.equal(resolve(['GROUP_GD_DSA', 'GROUP_GD_DIRECCION']).roleId, 'director-dsa')
  assert.equal(resolve(['GROUP_GD_DTI', 'GROUP_GD_JEFE_UNIDAD']).roleId, 'jefe-unidad-dti')
  assert.equal(resolve(['GROUP_GD_DSA', 'GROUP_GD_JEFE_UNIDAD']).roleId, 'jefe-unidad-dsa')
  assert.equal(resolve(['GROUP_GD_DTI', 'GROUP_GD_ESPECIALISTA']).roleId, 'especialista-dti')
  assert.equal(resolve(['GROUP_GD_DSA', 'GROUP_GD_ESPECIALISTA']).roleId, 'especialista-dsa')
})

test('requires exactly one dependency and one function', () => {
  assert.equal(resolve(['GROUP_GD_DTI']).authorizationStatus, 'incomplete')
  assert.equal(resolve(['GROUP_GD_ESPECIALISTA']).authorizationStatus, 'incomplete')
  assert.equal(resolve(['GROUP_GD_DTI', 'GROUP_GD_DSA', 'GROUP_GD_DIRECCION']).authorizationStatus, 'ambiguous')
  assert.equal(resolve(['GROUP_GD_DTI', 'GROUP_GD_DIRECCION', 'GROUP_GD_JEFE_UNIDAD']).authorizationStatus, 'ambiguous')
})

test('ignores unrelated Alfresco groups and does not infer from usernames', () => {
  const result = resolve(['GROUP_SITE_CONSUMERS', 'GROUP_GD_DSA', 'GROUP_GD_ESPECIALISTA'])
  assert.equal(result.userId, 'fixture_director_b')
  assert.equal(result.dependency, 'DSA')
  assert.equal(result.roleId, 'especialista-dsa')
})

test('Alfresco administrators never grant the institutional director role, even if misconfigured', () => {
  const mappings = { dependencies: { DSA: 'GROUP_GD_DSA' }, functions: { direccion: 'GROUP_ALFRESCO_ADMINISTRATORS' } }
  assert.equal(resolveRole(['GROUP_GD_DSA', 'GROUP_ALFRESCO_ADMINISTRATORS'], mappings).authorizationStatus, 'incomplete')
})

test('distinct authority IDs never become equivalent after stripping prefixes, punctuation, case or labels', () => {
  for (const groups of [
    ['GROUP_DSA', 'GROUP_DIRECCION'], ['GROUP_GD_DSA', 'GROUP_FUNCION_DIRECCION'],
    ['GROUP_GD_D-SA', 'GROUP_GD_DIRECCION'], ['group_gd_dsa', 'GROUP_GD_DIRECCION'],
    ['GROUP_GD_DSA ', 'GROUP_GD_DIRECCION'], ['Gestión Documental - DSA', 'GROUP_GD_DIRECCION'],
  ]) assert.notEqual(resolve(groups).authorizationStatus, 'active')
  assert.equal(resolveRole(['GROUP_CUSTOM_DSA', 'GROUP_CUSTOM_HEAD'], {
    dependencies: { DSA: ['GROUP_CUSTOM_DSA'] }, functions: { 'jefe-unidad': ['GROUP_CUSTOM_HEAD'] },
  }).roleId, 'jefe-unidad-dsa', 'explicit configured IDs remain supported')
})

test('memberships alone cannot supply a missing institutional mapping', () => {
  assert.equal(resolveRole(['GROUP_GD_DSA', 'GROUP_GD_DIRECCION']).authorizationStatus, 'incomplete')
})

test('exact external groups support renames and ambiguous ACL groups require explicit configuration', () => {
  const mappings = parseGroupMappings({ ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({
    dependencies: { DSA: ['GROUP_TEAM_X', 'GROUP_TEAM_Y'], DTI: 'GROUP_TEAM_Z' }, functions: { direccion: 'GROUP_JOB_A' },
  }) })
  assert.equal(resolveRole(['GROUP_TEAM_X', 'GROUP_JOB_A'], mappings).roleId, 'director-dsa')
  assert.deepEqual(distributionGroupIds(mappings), { DTI: 'GROUP_TEAM_Z' })
  assert.deepEqual(distributionGroupIds(mappings, {}), {})
  assert.throws(() => createDispatchRepository({ dispatchPersistence: 'local' }), /INVALID_DISPATCH_PERSISTENCE/)
})

test('conflicting aliases, non-authority labels and unknown functional roles cannot grant access', () => {
  for (const functions of [{ director: 'GROUP_A', direccion: 'GROUP_B' }, { especialista: 'Display label' }]) {
    assert.throws(() => parseGroupMappings({ ALFRESCO_ROLE_MAPPINGS_JSON: JSON.stringify(functions) }), /INVALID_GROUP_MAPPINGS/)
  }
  assert.throws(() => parseGroupMappings({ ALFRESCO_GROUP_MAPPINGS_JSON: JSON.stringify({
    dependencies: { DSA: 'GROUP_A' }, functions: { direccion: 'GROUP_A' },
  }) }), /INVALID_GROUP_MAPPINGS/)
  assert.equal(resolveRole(['GROUP_A', 'GROUP_B'], { dependencies: { DSA: 'GROUP_A' },
    functions: { unknown: 'GROUP_B' } }).authorizationStatus, 'incomplete')
})
