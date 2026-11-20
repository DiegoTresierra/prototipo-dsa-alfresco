import test from 'node:test'
import assert from 'node:assert/strict'
import { getDocumentSubmissionError } from './documentValidation.js'

function complete(roleId = 'director-dti') {
  return {
    fields: { documentType: 'Oficio', documentPeriod: '2026 - II', priority: 'Alta', subject: 'Prueba', description: 'Documento de prueba' },
    issuer: { roleId, dependencyId: 'DTI', issuerCode: 'DTI' },
    dependency: { id: 'dsa', available: true }, unit: { id: 'dsa-direccion' },
    position: { id: 'dsa-puesto-direccion', available: true },
    counter: { next: '0001' }, counterError: '', mainDocument: { name: 'oficio.pdf' },
  }
}

test('complete director submissions pass for both dependency roles and the generic director role', () => {
  for (const roleId of ['director-dti', 'director-dsa', 'director']) assert.equal(getDocumentSubmissionError(complete(roleId)), '')
})

test('an internal issuer configuration error is not reported as empty fields', () => {
  const input = complete()
  input.issuer.issuerCode = ''
  assert.match(getDocumentSubmissionError(input), /código de emisor/)
})

test('same-dependency delivery is identified explicitly regardless of letter case', () => {
  const input = complete()
  input.dependency.id = 'dti'
  assert.match(getDocumentSubmissionError(input), /distinta de la emisora/)
})

test('an individually addressed submission requires the configured recipient inbox', () => {
  const input = complete('jefe-unidad-dti')
  assert.match(getDocumentSubmissionError(input), /bandeja configurada/)
  input.recipient = { inboxNodeId: 'recipient-folder' }
  assert.equal(getDocumentSubmissionError(input), '')
})

test('generic creation requires type but never forces unsupported period or documentary priority', () => {
  const input = complete('jefe-unidad-dsa')
  input.recipient = { inboxNodeId: 'recipient-folder' }
  input.fields.documentPeriod = ''; input.fields.priority = ''; input.issuer.issuerCode = ''
  assert.equal(getDocumentSubmissionError(input), '')
  input.fields.documentType = ''
  assert.match(getDocumentSubmissionError(input), /tipo documental/)
})

test('missing content identifies the exact field or the pending PDF', () => {
  const input = complete()
  input.fields.description = '  '
  assert.equal(getDocumentSubmissionError(input), 'Completa: descripción.')
  input.fields.description = 'Contenido'
  input.mainDocument = null
  assert.match(getDocumentSubmissionError(input), /PDF principal/)
})
