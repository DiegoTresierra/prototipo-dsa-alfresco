import crypto from 'node:crypto'

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
export function legacyFingerprint(node, contentSha256) {
  return sha256(stableJson({ id: node.id, nodeType: node.nodeType, createdAt: node.createdAt,
    createdByUserId: node.createdByUser?.id, primaryParentId: node.parentId,
    content: { mimeType: node.content?.mimeType, sizeInBytes: node.content?.sizeInBytes }, contentSha256,
    numbering: Object.fromEntries(['gd:numero', 'gd:codigoDocumental', 'gd:cicloDocumental', 'gd:identidadEmision']
      .map((key) => [key, node.properties?.[key]])) }))
}
export function validateReconciliation(manifest, settings, readContent) {
  const roots = ['DTI', 'DSA'].map((dep) => settings.officeInboxNodeIds?.[dep]?.emitidos)
  if (manifest?.version !== 2 || manifest.fingerprintVersion !== 2 || manifest.target !== settings.alfrescoTarget ||
      roots.some((id) => typeof id !== 'string' || !id.trim()) || new Set(roots).size !== 2 ||
      typeof manifest.approvedBy !== 'string' || !manifest.approvedBy.trim() ||
      typeof manifest.decisionReference !== 'string' || !manifest.decisionReference.trim() ||
      !Number.isFinite(Date.parse(manifest.approvedAt)) || !Array.isArray(manifest.exclusions) ||
      stableJson(manifest.emitidos) !== stableJson(Object.fromEntries(['DTI', 'DSA'].map((dep) => [dep, settings.officeInboxNodeIds?.[dep]?.emitidos])))) {
    throw Object.assign(new Error('OFFICIAL_RECONCILIATION_APPROVAL_REQUIRED'), { status: 503 })
  }
  const exclusions = new Map()
  for (const item of manifest.exclusions) {
    if (typeof item.documentId !== 'string' || !item.documentId || !/^[a-f0-9]{64}$/.test(item.fingerprint || '') || !/^[a-f0-9]{64}$/.test(item.contentSha256 || '') ||
        typeof item.reason !== 'string' || !item.reason.trim() || exclusions.has(item.documentId)) {
      throw Object.assign(new Error('OFFICIAL_RECONCILIATION_APPROVAL_REQUIRED'), { status: 503 })
    }
    exclusions.set(item.documentId, item)
  }
  return async (node) => {
    const item = exclusions.get(node.id)
    if (!item) return false
    // Never exclude a partially or fully registered official emission.
    if (['gd:codigoDocumental', 'gd:cicloDocumental', 'gd:identidadEmision'].some((key) => node.properties?.[key] !== undefined) ||
        legacyFingerprint(node, item.contentSha256) !== item.fingerprint) {
      throw Object.assign(new Error('OFFICIAL_RECONCILIATION_CHANGED'), { status: 409 })
    }
    if (typeof readContent !== 'function') throw Object.assign(new Error('OFFICIAL_RECONCILIATION_CONTENT_REQUIRED'), { status: 503 })
    const bytes = await readContent(node.id)
    if (sha256(bytes) !== item.contentSha256) throw Object.assign(new Error('OFFICIAL_RECONCILIATION_CHANGED'), { status: 409 })
    return true
  }
}
