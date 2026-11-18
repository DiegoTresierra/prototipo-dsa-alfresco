import { useState } from 'react'
import { linkAssignmentResponse, listResponseCandidates } from '../api/alfresco'

/* eslint-disable react/prop-types */
export function ResponseComposer({ documentId, assignmentId = null, csrfToken, onLinked, onEmit }) {
  const [candidates, setCandidates] = useState(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [keys] = useState(() => new Map())
  const run = async (operation) => {
    setBusy(true); setMessage('')
    try { await operation() } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <div>
    <button type="button" className="button-secondary" disabled={busy} onClick={() => run(async () => setCandidates((await listResponseCandidates()).documents.filter((node) => node.id !== documentId)))}>Responder con documento</button>
    {candidates && <div>
      <p>Emitir o vincular una respuesta no atiende obligaciones individuales.</p>
      <label className="form-field"><span>Emisión propia existente</span><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Selecciona un PDF emitido</option>{candidates.map((node) => <option key={node.id} value={node.id}>{node.properties?.['cm:title'] || node.name}</option>)}</select></label>
      <button type="button" className="button-secondary" disabled={!selected || busy} onClick={() => run(async () => {
        if (!keys.has(selected)) keys.set(selected, globalThis.crypto.randomUUID())
        const result = await linkAssignmentResponse({ documentId, assignmentId, requestKey: keys.get(selected), responseDocumentId: selected }, csrfToken)
        setMessage('Respuesta vinculada. No se ha marcado ninguna asignación como atendida.'); onLinked?.(result)
      })}>Vincular emisión</button>
      {onEmit && <button type="button" className="button-secondary" disabled={busy} onClick={() => onEmit({ documentId, assignmentId })}>Generar nueva emisión</button>}
    </div>}
    {message && <p role="status">{message}</p>}
  </div>
}
