import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGenericPdfForm } from './pdfCreation.js'

const input = () => {
  const form = new FormData()
  form.set('filedata', new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'fixture.pdf')
  form.set('name', 'fixture.pdf'); form.set('nodeType', 'cm:content')
  form.set('cm:title', 'Title'); form.set('cm:description', 'Description')
  return form
}
async function parse(form) {
  const request = new Request('https://creation.invalid', { method: 'POST', body: form })
  return buildGenericPdfForm(Buffer.from(await request.arrayBuffer()), request.headers.get('content-type'))
}
test('legitimate generic PDF is reconstructed from a strict field allowlist', async () => {
  const result = await parse(input())
  assert.deepEqual([...result.keys()], ['filedata', 'name', 'nodeType', 'cm:title', 'cm:description'])
  assert.equal(result.get('cm:title'), 'Title')
  assert.equal(await result.get('filedata').text(), '%PDF-1.7\nfixture')
})
test('reserved metadata, arbitrary aspects, ACLs and duplicate fields cannot enter a generic create', async () => {
  for (const field of ['gd:asignaciones', 'gd:responsablesActuales', 'gd:dependenciasResponsablesActuales', 'gd:numero', 'gd:identidadEmision',
    'gd:dependenciaOrigen', 'gd:remitente', 'aspectNames', 'aspectnames', 'permissions', 'properties', 'autoRename', 'overwrite', 'cm:author']) {
    const form = input(); form.set(field, '{}')
    await assert.rejects(parse(form), { message: 'RESERVED_DOCUMENT_METADATA', status: 403 })
  }
  const duplicate = input(); duplicate.append('cm:title', 'second')
  await assert.rejects(parse(duplicate), { status: 403 })
})
test('non-content node types, path names, non-text metadata and invalid PDFs are rejected', async () => {
  const wrongType = input(); wrongType.set('nodeType', 'cm:folder')
  await assert.rejects(parse(wrongType), { status: 400 })
  const path = input(); path.set('name', '../escape.pdf')
  await assert.rejects(parse(path), { status: 400 })
  const blob = input(); blob.set('cm:title', new Blob(['bad']))
  await assert.rejects(parse(blob), { status: 400 })
  const bad = input(); bad.set('filedata', new Blob(['not PDF']), 'bad.pdf')
  await assert.rejects(parse(bad), { status: 415 })
})
