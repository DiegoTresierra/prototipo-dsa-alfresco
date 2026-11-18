import { useState } from 'react'
import { attendAssignment, getLinkedResponses } from '../api/alfresco'
import { PdfPreview } from './PdfPreview'
import { ResponseComposer } from './ResponseComposer'

/* eslint-disable react/prop-types */
export function AttentionActions({ documentId, assignment, csrfToken, canAttend, canIssue, onChanged, onEmit }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [linked, setLinked] = useState(null)
  const [preview, setPreview] = useState(null)
  const [keys] = useState(() => new Map())
  const [completed, setCompleted] = useState(false)
  const keyFor = (operation) => {
    if (!keys.has(operation)) keys.set(operation, globalThis.crypto.randomUUID())
    return keys.get(operation)
  }
  const active = !completed && ['ASIGNADO', 'DESPACHADO'].includes(assignment.status)
  const run = async (operation) => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await operation() } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  const attend = (responseDocumentId = null) => run(async () => {
    const result = await attendAssignment({ documentId, assignmentId: assignment.id, requestKey: keyFor(`attend:${responseDocumentId || 'direct'}`), responseDocumentId }, csrfToken)
    setCompleted(true)
    setMessage('Asignación atendida. Las demás obligaciones conservan su estado; el trámite no se cierra automáticamente.')
    onChanged?.(result)
  })
  const loadLinks = async () => { const result = await getLinkedResponses(documentId); setLinked(result); return result }
  return <section className="dispatch-summary" aria-label="Atención individual">
    <strong>Mi asignación: {completed ? 'ATENDIDO' : assignment.status}</strong>
    {assignment.attendedAt && <p>Atendida por {assignment.attendedByUserId} · {new Date(assignment.attendedAt).toLocaleString('es-PE')}</p>}
    {active && canAttend && <button type="button" className="button-primary" disabled={busy} onClick={() => attend()}>Marcar como atendido</button>}
    {canIssue && <ResponseComposer key={active ? assignment.id : documentId} documentId={documentId} assignmentId={active ? assignment.id : null} csrfToken={csrfToken} onEmit={onEmit} onLinked={(result) => { onChanged?.(result); run(loadLinks) }} />}
    <button type="button" className="button-secondary" disabled={busy} onClick={() => run(loadLinks)}>Consultar respuestas relacionadas</button>
    {linked && <div>
      <p>Obligaciones: {linked.summary.attended} atendidas · {linked.summary.pending} pendientes. {linked.summary.readyForClosureReview ? 'Listo para revisión de cierre; falta autoridad formal.' : 'Sin cierre global.'}</p>
      {!linked.responses.length && <p>No hay respuestas vinculadas.</p>}
      {linked.responses.map((response) => <div key={response.documentId}>
        <p>Respuesta {response.documentId} · Emitida por {response.emitterDependency?.toUpperCase()} · Usuario {response.emittedByUserId}</p>
        {response.available ? <button type="button" className="button-secondary" onClick={() => setPreview(response.node)}>Ver respuesta</button> : <p role="alert">Respuesta no disponible con los permisos actuales o vínculo no verificable.</p>}
        {active && canAttend && response.available && response.linkedByUserId === assignment.userId && <button type="button" className="button-secondary" disabled={busy} onClick={() => attend(response.documentId)}>Atender usando esta respuesta</button>}
      </div>)}
    </div>}
    {preview && <div><button type="button" className="button-secondary" onClick={() => setPreview(null)}>Cerrar respuesta</button><PdfPreview nodeId={preview.id} originalDocumentId={documentId} fileName={preview.name} declaredMimeType={preview.content?.mimeType} /></div>}
    {message && <p role="status">{message}</p>}
  </section>
}
