// Final pilot contract: existing gd:numero is canonical positive decimal text.
// Verify the deployed properties in each target repository. Never activate here.
export const proposedEmissionProperties = Object.freeze({
  documentCode: 'gd:codigoDocumental', cycle: 'gd:cicloDocumental',
  number: 'gd:numero', identity: 'gd:identidadEmision',
})
const fail = () => Object.assign(new Error('OFFICIAL_EMISSION_METADATA_REQUIRED'), { status: 503 })

export function parseOfficialNumber(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw Object.assign(new Error('OFFICIAL_NUMBER_RECONCILIATION_REQUIRED'), { status: 409 })
  }
  return Number(value)
}

export function assertEmissionModel(properties) {
  const expected = { documentCode: 'd:text', cycle: 'd:int', number: 'd:text', identity: 'd:text' }
  for (const [key, type] of Object.entries(expected)) {
    const property = properties?.[proposedEmissionProperties[key]]
    if (!property || property.dataType !== type || property.multiValued !== false) throw fail()
  }
}

export function encodeEmissionMetadata(record) {
  if (typeof record?.documentCode !== 'string' || !record.documentCode.trim() || record.documentCode !== record.documentCode.trim() ||
      !Number.isSafeInteger(record.cycle) || record.cycle < 1 || !Number.isSafeInteger(record.number) || record.number < 1 ||
      typeof record.actorId !== 'string' || !record.actorId || typeof record.requestKey !== 'string' || !record.requestKey ||
      !/^[a-f0-9]{64}$/.test(record.payloadHash || '')) throw fail()
  return {
    [proposedEmissionProperties.documentCode]: record.documentCode,
    [proposedEmissionProperties.cycle]: record.cycle,
    [proposedEmissionProperties.number]: String(record.number),
    [proposedEmissionProperties.identity]: JSON.stringify({ version: 1, actorId: record.actorId, requestKey: record.requestKey, payloadHash: record.payloadHash }),
  }
}

export function decodeEmissionMetadata(node) {
  const properties = node?.properties || {}
  // In an official Emitidos folder, absence must trigger reconciliation, not a
  // silent skip. Cancellation never removes metadata or consumes a new number.
  const number = parseOfficialNumber(properties[proposedEmissionProperties.number])
  let identity
  try { identity = JSON.parse(properties[proposedEmissionProperties.identity]) } catch { throw fail() }
  if (identity?.version !== 1) throw fail()
  const record = {
    documentId: node.id, documentCode: properties[proposedEmissionProperties.documentCode],
    cycle: properties[proposedEmissionProperties.cycle], number,
    actorId: identity.actorId, requestKey: identity.requestKey, payloadHash: identity.payloadHash,
  }
  if (!record.documentId || node.nodeType !== 'cm:content' || node.isFile !== true || node.content?.mimeType !== 'application/pdf') throw fail()
  encodeEmissionMetadata(record)
  return record
}
