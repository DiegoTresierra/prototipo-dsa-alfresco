import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInstitutionalMetadata, parseInstitutionalMetadataHeader } from './documentMetadata.js'

const input = {
  number: 'OF-001',
  documentDate: '2026-11-13',
  originDependency: 'DTI',
  destinationDependency: 'DSA',
  sender: 'DTI_T',
  recipient: 'Responsable DSA',
  documentType: 'Oficio',
  state: 'POR_ATENDER',
  currentResponsible: 'Responsable DSA',
  currentResponsibleDependency: 'DSA',
}

test('builds the institutional aspects and gd properties', () => {
  const result = buildInstitutionalMetadata(input)
  assert.deepEqual(result.aspectNames, ['gd:identificacion', 'gd:clasificacion', 'gd:tramite'])
  assert.equal(result.properties['gd:numero'], 'OF-001')
  assert.equal(result.properties['gd:estado'], 'POR_ATENDER')
  assert.equal(result.properties['gd:dependenciaResponsableActual'], 'DSA')
})

test('rejects invalid states and incomplete required metadata', () => {
  assert.throws(() => buildInstitutionalMetadata({ ...input, state: 'ATENDIDO' }), /DOCUMENT_METADATA_ESTADO_INVALID/)
  assert.throws(() => buildInstitutionalMetadata({ ...input, recipient: '' }), /DOCUMENT_METADATA_DESTINATARIO_REQUIRED/)
})

test('parses the metadata header without accepting arbitrary properties', () => {
  const result = parseInstitutionalMetadataHeader(JSON.stringify(input))
  assert.deepEqual(Object.keys(result.properties).sort(), [
    'gd:dependenciaDestino',
    'gd:dependenciaOrigen',
    'gd:dependenciaResponsableActual',
    'gd:destinatario',
    'gd:estado',
    'gd:fechaDocumento',
    'gd:numero',
    'gd:remitente',
    'gd:responsableActual',
    'gd:tipoDocumental',
  ])
})
