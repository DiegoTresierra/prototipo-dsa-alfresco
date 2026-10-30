const STORAGE_KEY = 'gestion-documental-dsa.simulated-documents.v1'

function createInitialStore() {
  return { version: 2, documents: [], counters: {} }
}

function getCounterKeyForDocument(document) {
  return `${document.issuingAcronym}|${document.documentType}|${document.documentYear}`
}

function deriveCounters(documents) {
  return documents.reduce((counters, document) => {
    const consecutive = Number.parseInt(document.originalConsecutive, 10)
    if (!document.issuingAcronym || !document.documentType || !document.documentYear || !Number.isFinite(consecutive)) {
      return counters
    }

    const key = getCounterKeyForDocument(document)
    counters[key] = Math.max(counters[key] || 0, consecutive)
    return counters
  }, {})
}

function readStore() {
  const storedValue = window.localStorage.getItem(STORAGE_KEY)
  if (storedValue === null) {
    const initialStore = createInitialStore()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initialStore))
    return initialStore
  }

  const parsed = JSON.parse(storedValue)
  if (!parsed || !Array.isArray(parsed.documents)) {
    throw new Error('El registro local de documentos no tiene un formato válido; no se modificó para proteger los correlativos existentes.')
  }

  const documentCounters = deriveCounters(parsed.documents)
  const isLegacyStore = Number(parsed.version || 1) < 2
  const counters = isLegacyStore
    ? documentCounters
    : { ...(parsed.counters || {}) }

  if (!isLegacyStore) {
    Object.entries(documentCounters).forEach(([key, consecutive]) => {
      counters[key] = Math.max(Number(counters[key]) || 0, consecutive)
    })
  }

  const normalizedStore = { ...parsed, version: 2, documents: parsed.documents, counters }
  if (isLegacyStore || JSON.stringify(counters) !== JSON.stringify(parsed.counters || {})) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedStore))
  }
  return normalizedStore
}

function counterKey(acronym, documentType, year) {
  return `${acronym}|${documentType}|${year}`
}

function formatConsecutive(number) {
  return String(number).padStart(4, '0')
}

export function getCorrelativeStatus(acronym, documentType, year) {
  if (!acronym || !documentType || !year) return { last: '', next: '' }
  const store = readStore()
  const lastNumber = Number(store.counters[counterKey(acronym, documentType, year)] || 0)
  return { last: formatConsecutive(lastNumber), next: formatConsecutive(lastNumber + 1) }
}

export function loadStoredDocuments() {
  return readStore().documents
}

export function saveSimulatedDocument(documentData) {
  const store = readStore()
  if (store.documents.some((document) => document.submissionToken === documentData.submissionToken)) {
    const existingDocument = store.documents.find((document) => document.submissionToken === documentData.submissionToken)
    return { document: existingDocument, documents: store.documents, duplicate: true }
  }

  const key = counterKey(documentData.issuingAcronym, documentData.documentType, documentData.documentYear)
  const lastNumber = Number(store.counters[key] || 0)
  const originalConsecutive = formatConsecutive(lastNumber + 1)
  const documentNumber = `${documentData.documentType.toLocaleUpperCase('es')} N.° ${originalConsecutive}-${documentData.documentYear}-${documentData.issuingAcronym}`
  const document = {
    ...documentData,
    id: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    originalConsecutive,
    documentNumber,
    status: 'Enviado (simulación)',
    createdAt: new Date().toISOString(),
  }
  const nextStore = {
    ...store,
    counters: { ...store.counters, [key]: lastNumber + 1 },
    documents: [document, ...store.documents],
  }

  // Un solo setItem actualiza documento y contador juntos en este navegador.
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore))
  return { document, documents: nextStore.documents, duplicate: false }
}
