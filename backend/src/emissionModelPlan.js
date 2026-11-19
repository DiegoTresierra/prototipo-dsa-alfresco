// Read-only additive planner. Never merge/replace an existing aspect definition.
export function planEmissionModel(model, aspect, patch) {
  if (model?.name !== 'gd_uac' || model.namespacePrefix !== 'gd' ||
      model.namespaceUri !== 'https://uandina.edu.pe/model/gd/1.0' || model.status !== 'ACTIVE' ||
      aspect?.name !== 'identificacion' || !Array.isArray(aspect.properties) || patch?.name !== 'identificacion' ||
      !Array.isArray(patch.properties)) throw new Error('EMISSION_MODEL_IDENTITY_MISMATCH')
  const missing = []
  const conflicts = []
  const notes = []
  const duplicateNames = new Set()
  for (const desired of patch.properties) {
    if (duplicateNames.has(desired.name)) throw new Error('EMISSION_MODEL_DUPLICATE_PROPERTY')
    duplicateNames.add(desired.name)
    const matches = aspect.properties.filter((item) => item.name === desired.name)
    if (!matches.length) { missing.push(desired); continue }
    if (matches.length !== 1) throw new Error('EMISSION_MODEL_DUPLICATE_PROPERTY')
    const actual = matches[0]
    const fields = ['dataType', 'multiValued', 'mandatory', 'mandatoryEnforced', 'indexed']
    for (const field of fields) {
      if (actual[field] !== desired[field]) conflicts.push({ property: desired.name, field, expected: desired[field], actual: actual[field] ?? null })
    }
    if (actual.defaultValue !== undefined && actual.defaultValue !== null || actual.constraints?.length) {
      conflicts.push({ property: desired.name, field: 'defaults/constraints', expected: 'none' })
    }
    for (const field of ['title', 'description', 'facetable', 'indexTokenisationMode']) {
      if (actual[field] !== desired[field]) notes.push({ property: desired.name, field, expected: desired[field], actual: actual[field] ?? null })
    }
    // CMM can normalize facet/token flags for unindexed fields. They are inert
    // while indexed=false; report them without claiming a functional mismatch.
  }
  return { additivePatch: { name: 'identificacion', properties: missing }, missing: missing.map((p) => `gd:${p.name}`), conflicts, notes }
}
