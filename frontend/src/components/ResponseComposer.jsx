import { useState } from 'react'
import { linkAssignmentResponse, listResponseCandidates } from '../api/alfresco'

/* eslint-disable react/prop-types */
export function ResponseComposer({ documentId, assignmentId = null, csrfToken, onLinked, onEmit, existingResponseDocumentId = '' }) {
  const [candidates, setCandidates] = useState(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [originalId, setOriginalId] = useState('')
  const target = documentId || originalId.trim()
  const responseId = existingResponseDocumentId || selected
  const [keys] = useState(() => new Map())
  const run = async (operation) => {
    setBusy(true); setMessage('')
    try { await operation() } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <div>
    {existingResponseDocumentId && <label className="form-field"><span>UUID del original al que responder</span><input value={originalId} onChange={e => setOriginalId(e.target.value)} autoComplete="off" /></label>}
    {!existingResponseDocumentId && <button type="button" className="button-secondary" disabled={busy} onClick={() => run(async () => setCandidates((await listResponseCandidates()).documents.filter((node) => node.id !== documentId)))}>Responder con documento</button>}
    {(candidates || existingResponseDocumentId) && <div>
      <p>Emitir o vincular una respuesta no atiende obligaciones individuales.</p>
      <p>Solo se admite una emisión oficial verificada. Un registro o borrador no constituye una respuesta oficial.</p>
      {candidates?.length === 0 && <p>No hay PDF oficiales verificables con los permisos actuales.</p>}
      {!existingResponseDocumentId && <label className="form-field"><span>Emisión propia existente</span><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Selecciona un PDF emitido</option>{candidates.map((node) => <option key={node.id} value={node.id}>{node.properties?.['cm:title'] || node.name}</option>)}</select></label>}
      <button type="button" className="button-secondary" disabled={!responseId || !/^[A-Za-z0-9-]{1,250}$/.test(target || '') || responseId === target || busy} onClick={() => run(async () => {
        const operation = `${target}:${responseId}`
        const storageKey = `uac.pending-response-link.${operation}`
        if (!keys.has(operation)) {
          let key
          try { key = window.sessionStorage.getItem(storageKey) } catch { /* optional recovery cache; never authority */ }
          if (!/^[a-f0-9-]{36}$/.test(key || '')) key = globalThis.crypto.randomUUID()
          keys.set(operation, key)
          try { window.sessionStorage.setItem(storageKey, key) } catch { /* backend history still prevents duplicate links */ }
        }
        const result = await linkAssignmentResponse({ documentId: target, assignmentId, requestKey: keys.get(operation), responseDocumentId: responseId }, csrfToken)
        try { window.sessionStorage.removeItem(storageKey) } catch { /* verified result is in Alfresco */ }
        setMessage('Respuesta vinculada. No se ha marcado ninguna asignación como atendida.'); onLinked?.(result)
      })}>{existingResponseDocumentId ? 'Vincular este documento oficial como respuesta' : 'Vincular emisión'}</button>
      {onEmit && <button type="button" className="button-secondary" disabled={busy} onClick={() => onEmit({ documentId, assignmentId })}>Generar nueva emisión</button>}
    </div>}
    {message && <p role="status">{message}</p>}
  </div>
}
