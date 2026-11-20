import { createHash } from 'node:crypto'
import { validateReviewEmission } from './responseReview.js'

const fail = () => { throw Object.assign(new Error('PROPOSAL_INVALID_JOURNAL'), { status: 422 }) }
export function validateProposalJournal(operations, documentId) {
  if (operations === undefined) return
  if (!Array.isArray(operations)) fail()
  const ids = new Set()
  const keys = ['schemaVersion', 'id', 'requestKey', 'actorUserId', 'dependency', 'action', 'payloadHash', 'expectedRevision', 'processId', 'proposalDocumentId', 'previousVersionIds', 'phase', 'at', 'snapshot']
  const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 250
  for (const o of operations) {
    const allowedKeys = o?.action === 'EMIT' ? [...keys, 'emission', 'emissionOptions'] : keys
    if (!o || Object.keys(o).length !== allowedKeys.length || Object.keys(o).some((k) => !allowedKeys.includes(k)) || o.schemaVersion !== 1 ||
        ![o.id, o.requestKey, o.actorUserId, o.processId].every(text) || !['dti', 'dsa'].includes(o.dependency) ||
        !['CREATE', 'REVISE', 'SUBMIT', 'OBSERVE', 'ELEVATE', 'RETURN', 'APPROVE', 'EMIT'].includes(o.action) || !/^[a-f0-9]{64}$/.test(o.payloadHash) || !Number.isSafeInteger(o.expectedRevision) || o.expectedRevision < 0 ||
        !['PREPARED', 'PDF_VERIFIED', 'RELATED', 'EMISSION_FOUND', 'COMMITTED', 'UNCERTAIN'].includes(o.phase) || typeof o.at !== 'string' || !Number.isFinite(Date.parse(o.at)) ||
        o.proposalDocumentId !== null && (!text(o.proposalDocumentId) || o.proposalDocumentId === documentId) ||
        !Array.isArray(o.previousVersionIds) || o.previousVersionIds.some((v) => typeof v !== 'string' || v.length > 250 || !/^[0-9]+\.[0-9]+$/.test(v)) ||
        new Set(o.previousVersionIds).size !== o.previousVersionIds.length || ids.has(o.id)) fail()
    if (o.snapshot !== null && (!o.snapshot || Object.keys(o.snapshot).sort().join(',') !== 'contentSha256,metadataSha256,versionId' ||
        !/^[0-9]+\.[0-9]+$/.test(o.snapshot.versionId) || ![o.snapshot.contentSha256, o.snapshot.metadataSha256].every((h) => /^[a-f0-9]{64}$/.test(h)))) fail()
    if (o.id !== createHash('sha256').update(JSON.stringify([documentId, o.actorUserId, o.requestKey])).digest('hex') ||
        ['PDF_VERIFIED', 'RELATED', 'COMMITTED'].includes(o.phase) && (!o.snapshot || !o.proposalDocumentId) ||
        o.action === 'REVISE' && (!o.proposalDocumentId || !o.previousVersionIds.length) ||
        o.action === 'CREATE' && (o.expectedRevision !== 0 || o.previousVersionIds.length)) fail()
    if (!['CREATE', 'REVISE'].includes(o.action) && (!o.snapshot || !o.proposalDocumentId || o.expectedRevision < 1 ||
        !(o.action === 'EMIT' ? ['PREPARED', 'EMISSION_FOUND', 'COMMITTED', 'UNCERTAIN'] : ['PREPARED', 'COMMITTED', 'UNCERTAIN']).includes(o.phase) || o.previousVersionIds.length !== 1 || o.previousVersionIds[0] !== o.snapshot.versionId)) fail()
    if (o.action === 'EMIT') {
      const options = o.emissionOptions
      if (!options || Object.keys(options).sort().join(',') !== 'documentPeriod,priority,receiptCategory,recipientDependency' ||
          typeof options.documentPeriod !== 'string' || !options.documentPeriod.trim() || options.documentPeriod.length > 40 ||
          !['Normal', 'Alta', 'Urgente'].includes(options.priority) || !['DTI', 'DSA'].includes(options.recipientDependency) || options.recipientDependency === o.dependency.toUpperCase() ||
          !['por-atender', 'por-conocimiento'].includes(options.receiptCategory)) fail()
      if (o.emission !== null) {
        validateReviewEmission(o.emission)
        if (o.emission.originalDocumentId !== documentId || o.emission.processId !== o.processId || o.emission.proposalDocumentId !== o.proposalDocumentId ||
            o.emission.record.actorId !== o.actorUserId || ['versionId', 'contentSha256', 'metadataSha256'].some((k) => o.emission[k] !== o.snapshot[k])) fail()
      } else if (['COMMITTED', 'EMISSION_FOUND'].includes(o.phase)) fail()
    }
    ids.add(o.id)
  }
}
