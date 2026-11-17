import { dispatchPersistenceError } from './dispatchPersistence.js'

export async function loadAssignmentInbox(apiFetch, mapDocument) {
  const response = await apiFetch('/api/documents/dispatches?include=documents', { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(dispatchPersistenceError(body.error, 'No se pudieron consultar tus asignaciones y documentos. Reintenta la actualización.'))
  }
  const result = await response.json()
  if (![result.dispatches, result.sentDispatches, result.documents, result.documentErrors].every(Array.isArray)) {
    throw new Error('La respuesta de la bandeja de asignaciones no es válida.')
  }
  return { documents: result.documents.map(mapDocument), dispatchRecords: result.dispatches, sentDispatches: result.sentDispatches, documentErrors: result.documentErrors }
}
