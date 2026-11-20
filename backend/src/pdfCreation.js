const allowed = new Set(['filedata', 'name', 'nodeType', 'cm:title', 'cm:description', 'documentType'])
const documentTypes = new Map(['Oficio', 'Memorando', 'Informe', 'Solicitud', 'Carta'].map((type) => [type.toLowerCase(), type]))
const fail = (code, status = 400) => Object.assign(new Error(code), { status })

// Generic clients cannot set aspects, ACLs or institutional properties. Only the
// backend constructs classification metadata after validating its real model.
export async function buildGenericPdfForm(body, contentType, { readClassification } = {}) {
  let input
  try { input = await new Response(body, { headers: { 'Content-Type': contentType || '' } }).formData() }
  catch { throw fail('INVALID_PDF_MULTIPART') }
  for (const key of input.keys()) {
    if (!allowed.has(key) || input.getAll(key).length !== 1) throw fail('RESERVED_DOCUMENT_METADATA', 403)
  }
  const file = input.get('filedata')
  if (!file || typeof file.arrayBuffer !== 'function' || !/\.pdf$/i.test(file.name || '') ||
      file.size > 20 * 1024 * 1024 || Buffer.from(await file.slice(0, 5).arrayBuffer()).toString() !== '%PDF-') throw fail('PDF_UPLOAD_REQUIRED', 415)
  const name = input.get('name') || file.name
  if (typeof name !== 'string' || !/\.pdf$/i.test(name) || /[/\\\x00-\x1f]/.test(name) ||
      input.has('nodeType') && input.get('nodeType') !== 'cm:content') throw fail('INVALID_PDF_MULTIPART')
  const form = new FormData()
  form.set('filedata', file, name)
  form.set('name', name)
  form.set('nodeType', 'cm:content')
  for (const key of ['cm:title', 'cm:description']) {
    if (!input.has(key)) continue
    const value = input.get(key)
    if (typeof value !== 'string' || value.length > (key === 'cm:title' ? 500 : 10000)) throw fail('INVALID_PDF_MULTIPART')
    form.set(key, value)
  }
  if (input.has('documentType')) {
    const supplied = input.get('documentType')
    const type = typeof supplied === 'string' ? documentTypes.get(supplied.trim().toLowerCase()) : null
    if (!type) throw fail('GENERIC_DOCUMENT_TYPE_INVALID')
    const model = await readClassification?.()
    const property = model?.properties?.['gd:tipoDocumental']
    if (!property || property.dataType !== 'd:text' || property.multiValued !== false || property.protected === true) {
      throw fail('GENERIC_DOCUMENT_TYPE_MODEL_REQUIRED', 503)
    }
    form.set('aspectnames', JSON.stringify(['gd:clasificacion']))
    form.set('gd:tipoDocumental', type)
  }
  return form
}
