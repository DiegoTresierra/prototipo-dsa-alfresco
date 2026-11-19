import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GROUP_MAPPINGS, resolveRole } from './roleResolver.js'

const resolve = (groups) => resolveRole(groups, DEFAULT_GROUP_MAPPINGS, 'DTI_T')

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
  assert.equal(result.userId, 'DTI_T')
  assert.equal(result.dependency, 'DSA')
  assert.equal(result.roleId, 'especialista-dsa')
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
