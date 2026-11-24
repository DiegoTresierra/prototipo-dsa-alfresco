const fail = code => { throw Object.assign(new Error(code), { status: 503 }) }
const code = v => typeof v === 'string' && /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(v)
// Code configuration is NOT membership or approval authority. Unit affiliation
// must independently exist as an active gdo assignment readable by the real actor.
export async function resolveDocumentIssuer(settings, identity, get) {
  const dependency = identity.dependency
  if (identity.functionalRole === 'direccion') return { code: dependency, dependency, unitId: null }
  if (!['jefe-unidad', 'especialista'].includes(identity.functionalRole)) fail('DOCUMENT_ISSUER_ROLE_NOT_ALLOWED')
  const configured = settings.documentIssuerAssignments?.[identity.person.id]
  if (!configured?.unitId || !/^[a-f0-9-]{36}$/i.test(configured.unitId) || !code(configured.documentCode)) fail('DOCUMENT_ISSUER_CONFIGURATION_REQUIRED')
  const unit = (await get(`/nodes/${encodeURIComponent(configured.unitId)}?include=properties`)).entry
  const p = unit?.properties
  if (unit?.id !== configured.unitId || unit.nodeType !== 'gdo:unidad' || p?.['gdo:estadoUnidad'] !== 'ACTIVA' ||
      String(p['gdo:codigoDependencia']).toUpperCase() !== dependency || !code(p['gdo:codigoUnidad'])) fail('DOCUMENT_ISSUER_UNIT_NOT_VERIFIED')
  const unitCode = p['gdo:codigoUnidad']
  if (/^(DTI|DSA)-/.test(unitCode) && !unitCode.startsWith(dependency + '-')) fail('DOCUMENT_ISSUER_CODE_CONFLICT')
  const base = unitCode.startsWith(dependency + '-') ? unitCode : `${dependency}-${unitCode}`
  const expected = identity.functionalRole === 'especialista' && code(configured.signatoryCode) ? `${base}-${configured.signatoryCode}` : base
  if (configured.documentCode !== expected || identity.functionalRole === 'especialista' && !code(configured.signatoryCode)) fail('DOCUMENT_ISSUER_CODE_CONFLICT')
  // Two personal identities cannot silently share a configured personal sequence.
  if (identity.functionalRole === 'especialista' && Object.entries(settings.documentIssuerAssignments).some(([id, c]) =>
    id !== identity.person.id && c?.documentCode === configured.documentCode)) fail('DOCUMENT_ISSUER_CODE_CONFLICT')
  let skip = 0, total, matches = 0, actorRecords = 0, activeHeads = 0
  for (;;) {
    const list = (await get(`/nodes/${encodeURIComponent(unit.id)}/children?include=properties&maxItems=100&skipCount=${skip}`)).list
    const page = list?.pagination
    if (!Array.isArray(list?.entries) || page?.skipCount !== skip || page.count !== list.entries.length || !Number.isSafeInteger(page.totalItems) ||
        page.totalItems < 0 || typeof page.hasMoreItems !== 'boolean' || total !== undefined && total !== page.totalItems) fail('DOCUMENT_ISSUER_UNIT_NOT_VERIFIED')
    total = page.totalItems
    for (const { entry } of list.entries) {
      const a = entry?.properties
      if (entry?.nodeType === 'gdo:asignacion' && a?.['gdo:estadoAsignacion'] === 'ACTIVA') {
        if (a['gdo:idUsuario'] === identity.person.id) actorRecords++
        if (a['gdo:rolAsignacion'] === 'jefe-unidad') activeHeads++
      }
      if (entry?.nodeType === 'gdo:asignacion' && a?.['gdo:estadoAsignacion'] === 'ACTIVA' && a['gdo:idUsuario'] === identity.person.id &&
          a['gdo:idUnidad'] === unit.id && a['gdo:rolAsignacion'] === identity.functionalRole &&
          String(a['gdo:dependenciaAsignacion']).toUpperCase() === dependency) matches++
    }
    skip += list.entries.length
    if (skip > total || page.hasMoreItems !== (skip < total) || !list.entries.length && page.hasMoreItems) fail('DOCUMENT_ISSUER_UNIT_NOT_VERIFIED')
    if (!page.hasMoreItems) break
  }
  if (matches !== 1 || actorRecords !== 1 || identity.functionalRole === 'jefe-unidad' && activeHeads !== 1) fail('DOCUMENT_ISSUER_MEMBERSHIP_NOT_VERIFIED')
  return { code: expected, dependency, unitId: unit.id }
}
