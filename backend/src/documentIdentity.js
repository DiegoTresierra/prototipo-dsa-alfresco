export function documentIdentity(node, settings) {
  const properties = node?.properties || {}
  const originalDependency = typeof properties['gd:dependenciaOrigen'] === 'string' ? properties['gd:dependenciaOrigen'].trim() : ''
  const codeDependency = /^(DTI|DSA)(?:-|$)/.exec(String(properties['gd:codigoDocumental'] || ''))?.[1] || null
  const formalSender = typeof properties['gd:remitente'] === 'string' ? properties['gd:remitente'].trim() : ''
  const locationEvidence = Object.entries(settings.officeInboxNodeIds || {}).filter(([, folders]) => folders.emitidos === node?.parentId).map(([dependency]) => dependency)
  return { originalDependency: originalDependency || codeDependency, formalSender: formalSender || null,
    source: originalDependency ? 'gd:dependenciaOrigen' : codeDependency ? 'gd:codigoDocumental' : 'not-recorded',
    createdByUserId: node?.createdByUser?.id || null, emittedFolderEvidence: locationEvidence }
}
