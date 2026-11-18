import { useState } from 'react'
import { getLinkedResponses } from '../api/alfresco'
import { PdfPreview } from './PdfPreview'
import { ResponseComposer } from './ResponseComposer'

/* eslint-disable react/prop-types */
export function RelatedResponses({ documentId, canIssue = false, csrfToken, onChanged, onEmit }) {
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const load = async () => {
    setBusy(true); setMessage('')
    try { setResult(await getLinkedResponses(documentId)) } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <section className="dispatch-summary">
    {canIssue && <ResponseComposer documentId={documentId} csrfToken={csrfToken} onEmit={onEmit} onLinked={(result) => { onChanged?.(result); load() }} />}
    <button type="button" className="button-secondary" disabled={busy} onClick={load}>Consultar respuestas relacionadas</button>
    {message && <p role="alert">{message}</p>}
    {result && <div><p>{result.summary.attended} obligaciones atendidas · {result.summary.pending} pendientes. El cierre formal es independiente.</p>
      {!result.responses.length && <p>No hay respuestas vinculadas.</p>}
      {result.responses.map((response) => <div key={response.documentId}><p>Respuesta {response.documentId} · Emisor institucional {response.emitterDependency?.toUpperCase()} · Usuario {response.emittedByUserId}</p>{response.available ? <button type="button" className="button-secondary" onClick={() => setPreview(response.node)}>Ver respuesta</button> : <p role="alert">Respuesta no disponible con los permisos actuales o relación no verificable.</p>}</div>)}
    </div>}
    {preview && <div><button type="button" className="button-secondary" onClick={() => setPreview(null)}>Cerrar respuesta</button><PdfPreview nodeId={preview.id} originalDocumentId={documentId} fileName={preview.name} declaredMimeType={preview.content?.mimeType} /></div>}
  </section>
}
