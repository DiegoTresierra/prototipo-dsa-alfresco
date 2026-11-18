// No official allocation until Alfresco coverage and recovery are verified.
// The legacy JSON remains untouched for reconciliation.
export function numberingScope(documentCode, at = new Date()) {
  if (typeof documentCode !== 'string' || !documentCode.trim() || !Number.isFinite(at.getTime())) {
    throw Object.assign(new Error('NUMBERING_SCOPE_REQUIRED'), { status: 400 })
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(at).map(({ type, value }) => [type, value]))
  const cycle = Number(parts.year) - (Number(parts.month) === 1 && Number(parts.day) === 1 ? 1 : 0)
  return { documentCode: documentCode.trim(), cycle, startsOn: cycle + '-01-02', endsOn: (cycle + 1) + '-01-01' }
}

export function reserveDocumentNumber() {
  throw Object.assign(new Error('NUMBERING_ATOMIC_RESERVATION_REQUIRED'), { status: 503 })
}
