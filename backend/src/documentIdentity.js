export function documentIdentity(node, settings) {
  const properties = node?.properties || {}
  const originalDependency = typeof properties['gd:dependenciaOrigen'] === 'string' ? properties['gd:dependenciaOrigen'].trim() : ''
  const formalSender = typeof properties['gd:remitente'] === 'string' ? properties['gd:remitente'].trim() : ''
  const locationEvidence = Object.entries(settings.officeInboxNodeIds || {}).filter(([, folders]) => folders.emitidos === node?.parentId).map(([dependency]) => dependency)
  return { originalDependency: originalDependency || null, formalSender: formalSender || null,
    source: originalDependency ? 'gd:dependenciaOrigen' : 'not-recorded',
    createdByUserId: node?.createdByUser?.id || null, emittedFolderEvidence: locationEvidence }
}
