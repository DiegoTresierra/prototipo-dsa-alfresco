export function documentIdentity(node) {
  const properties = node.properties || {}
  const codeDependency = /^(DTI|DSA)(?:-|$)/.exec(String(properties['gd:codigoDocumental'] || ''))?.[1] || null
  return node.documentIdentity || { originalDependency: properties['gd:dependenciaOrigen'] || codeDependency,
    formalSender: properties['gd:remitente'] || null, createdByUserId: node.createdByUser?.id || null,
    source: properties['gd:dependenciaOrigen'] ? 'gd:dependenciaOrigen' : codeDependency ? 'gd:codigoDocumental' : 'not-recorded', emittedFolderEvidence: [] }
}
