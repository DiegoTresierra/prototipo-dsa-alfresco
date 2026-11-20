import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'

/* eslint-disable react/prop-types */
export function ResponseProposals({ documentId }) {
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const run = async (operation) => {
    setBusy(true); setMessage(''); setPreview(''); setResult(null)
    try { await operation() } catch { setMessage('No se pudo verificar la consulta de propuestas. Intenta actualizar; no se ha confirmado una lista vacía.') } finally { setBusy(false) }
  }
  const query = (extra = {}) => new URLSearchParams({ documentId, ...extra })
  const load = () => run(async () => {
    const r = await apiFetch(`/api/documents/response-proposals?${query()}`, { credentials: 'include' })
    if (!r.ok) throw new Error('read')
    const data = await r.json()
    if (data.persistence !== 'alfresco' || !Array.isArray(data.proposals)) throw new Error('contract')
    setResult(data)
  })
  const open = (p, versionId) => {
    setBusy(true); setMessage(''); setPreview('')
    apiFetch(`/api/documents/proposal-version-content?${query({ processId: p.processId, versionId })}`, { credentials: 'include' })
      .then(async (r) => { if (!r.ok) throw new Error('read'); setPreview(URL.createObjectURL(await r.blob())) })
      .catch(() => setMessage('La versión no está disponible o no supera la verificación de integridad.'))
      .finally(() => setBusy(false))
  }
  const labels = { INACCESSIBLE: 'Propuesta sin acceso autorizado.', INVALID_VERSION: 'Versión de propuesta inválida.', INCONSISTENT: 'Propuesta inconsistente: requiere conciliación.', UNAVAILABLE: 'No se pudo verificar la propuesta.' }
  return <section aria-label="Propuestas de respuesta">
    <p>Propuestas y revisiones. No son documentos oficialmente emitidos. Escrituras y decisiones deshabilitadas.</p>
    <button type="button" className="button-secondary" disabled={busy} onClick={load}>Consultar propuestas</button>
    {message && <p role="alert">{message}</p>}
    {result && !result.proposals.length && <p>No hay propuestas registradas.</p>}
    {result?.proposals.map((p, i) => p.status === 'AVAILABLE' ? <div key={p.processId}>
      <p>{p.title} · {p.state} · Revisión {p.revision}</p>
      {p.versions.map((v) => <button type="button" className="button-secondary" disabled={busy} key={v} onClick={() => open(p, v)}>Ver versión {v}</button>)}
    </div> : <p role="alert" key={i}>{labels[p.status] || labels.UNAVAILABLE}</p>)}
    {preview && <div><button type="button" onClick={() => setPreview('')}>Cerrar propuesta</button><iframe title="Versión de propuesta" src={preview} style={{ width: '100%', height: '60vh' }} /></div>}
  </section>
}
