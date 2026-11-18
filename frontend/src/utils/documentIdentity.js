export function documentIdentity(node) {
  const properties = node.properties || {}
  return node.documentIdentity || { originalDependency: properties['gd:dependenciaOrigen'] || null,
    formalSender: properties['gd:remitente'] || null, createdByUserId: node.createdByUser?.id || null,
    source: properties['gd:dependenciaOrigen'] ? 'gd:dependenciaOrigen' : 'not-recorded', emittedFolderEvidence: [] }
}
