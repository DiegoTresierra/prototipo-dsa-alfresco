import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { RESPONSE_TIMES_CONFIG_PROPERTIES } from './responseTimesAlfrescoRepository.js'

const proposal = JSON.parse(fs.readFileSync(new URL('../alfresco-model/gd-configuracion-institucional-proposal.json', import.meta.url), 'utf8'))

test('proposal contains only the response-time config type and its single container', () => {
  assert.equal(proposal.status, 'PROPOSAL_ONLY_NOT_DEPLOYABLE')
  assert.equal(proposal.model.name, 'gd_configuracion_institucional')
  assert.equal(proposal.model.prefix, 'gdc')
  assert.deepEqual(proposal.types.map((type) => type.name), ['gdc:tiemposRespuesta'])
  const config = proposal.types[0]
  assert.equal(config.parent, 'cm:content')
  assert.deepEqual(config.properties.map((property) => property.name.replace('gdc:', '')), RESPONSE_TIMES_CONFIG_PROPERTIES)
  assert.deepEqual(proposal.containers, [{ name: 'GD_CONFIGURACION_TIEMPOS_RESPUESTA', contents: 'gdc:tiemposRespuesta' }])
})
