// CMM names are local names; public node properties use gd: qualified names.
export function planDispatchModel(model, aspect, patch) {
  if (model?.name !== 'gd_uac' || model.namespacePrefix !== 'gd' ||
      model.namespaceUri !== 'https://uandina.edu.pe/model/gd/1.0' || model.status !== 'ACTIVE' ||
      aspect?.name !== 'tramite' || !Array.isArray(aspect.properties)) throw new Error('DISPATCH_MODEL_IDENTITY_MISMATCH')
  const missing = []
  for (const property of patch.properties) {
    const existing = aspect.properties.find((item) => item.name === property.name)
    if (!existing) { missing.push(property); continue }
    if (existing.dataType !== property.dataType || existing.multiValued !== property.multiValued ||
        existing.mandatory !== false || existing.mandatoryEnforced !== false || existing.indexed !== property.indexed) {
      throw new Error(`DISPATCH_MODEL_PROPERTY_CONFLICT:${property.name}`)
    }
  }
  return { name: 'tramite', properties: missing }
}
