import { useState } from 'react'
import { getLinkedResponses, getResponseOriginals } from '../api/alfresco'
import { PdfPreview } from './PdfPreview'
import { ResponseComposer } from './ResponseComposer'
import { ResponseProposals } from './ResponseProposals'

/* eslint-disable react/prop-types */
export function RelatedResponses({ documentId, canIssue = false, csrfToken, onChanged, onEmit, showOriginals = false }) {
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [originals, setOriginals] = useState(null)
  const load = async () => {
    setBusy(true); setMessage('')
    try { setResult(await getLinkedResponses(documentId)) } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <section className="dispatch-summary">
    <ResponseProposals key={documentId} documentId={documentId} />
    {canIssue && <ResponseComposer documentId={documentId} csrfToken={csrfToken} onEmit={onEmit} onLinked={(result) => { onChanged?.(result); load() }} />}
    <button type="button" className="button-secondary" disabled={busy} onClick={load}>Consultar respuestas relacionadas</button>
    {showOriginals && <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setMessage('')
      try { setOriginals(await getResponseOriginals(documentId)) } catch (e) { setMessage(e.message) } finally { setBusy(false) }
    }}>Consultar originales respondidos</button>}
    {originals && <div>{!originals.complete && <p role="alert">Hay relaciones que no pudieron verificarse. La consulta es parcial.</p>}
      {originals.originals.map(r => <div key={r.originalDocumentId}><p>Respuesta → original: {r.originalDocumentId} · {r.node.properties?.['cm:title'] || r.node.name}</p>
        <button type="button" onClick={() => setPreview(r.node)}>Ver original respondido</button></div>)}
    </div>}
    {message && <p role="alert">{message}</p>}
    {result && <div><p>{result.summary.attended} obligaciones atendidas · {result.summary.pending} pendientes. El cierre formal es independiente.</p>
      {!result.responses.length && <p>No hay respuestas vinculadas.</p>}
      {result.responses.map((response) => <div key={response.documentId}><p>Respuesta {response.documentId} · Emisor institucional {response.emitterDependency?.toUpperCase()} · Usuario {response.emittedByUserId}</p>{response.available ? <button type="button" className="button-secondary" onClick={() => setPreview(response.node)}>Ver respuesta</button> : <p role="alert">Respuesta no disponible con los permisos actuales o relación no verificable.</p>}</div>)}
    </div>}
    {preview && <div><button type="button" className="button-secondary" onClick={() => setPreview(null)}>Cerrar respuesta</button><PdfPreview nodeId={preview.id} originalDocumentId={originals?.originals.some(r => r.originalDocumentId === preview.id) ? undefined : documentId} fileName={preview.name} declaredMimeType={preview.content?.mimeType} /></div>}
  </section>
}
