import { useEffect, useState } from 'react'
import { getClosureEvaluation, confirmDocumentClosure } from '../api/alfresco'
import { closureReasonMessage } from '../utils/closureMessages'
/* eslint-disable react/prop-types */
export function ClosurePanel({ documentId, csrfToken, onChanged, autoEvaluate = false, readOnly = false }) {
  const [result, setResult] = useState(null)
  const [reason, setReason] = useState('')
  const [key] = useState(() => globalThis.crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!autoEvaluate) return undefined
    let cancelled = false
    setBusy(true); setResult(null); setError('')
    getClosureEvaluation(documentId).then(r => { if (!cancelled) setResult(r) })
      .catch(() => { if (!cancelled) setError('No se pudo actualizar la evaluación. No se autoriza ninguna acción.') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [documentId, autoEvaluate])
  const run = async task => {
    setBusy(true); setError('')
    try { await task() } catch { setError('No se pudo confirmar la operación. No generes otro cierre si el resultado es incierto.') } finally { setBusy(false) }
  }
  const refresh = async () => setResult(await getClosureEvaluation(documentId))
  const close = async () => {
    const pending = result.pendingOperation
    await confirmDocumentClosure({ documentId, reason: pending?.reason || reason, requestKey: pending?.requestKey || key,
      expectedEnvelopeRevision: pending?.expectedEnvelopeRevision ?? result.evaluation.envelopeRevision }, csrfToken, Boolean(pending))
    await refresh()
    window.dispatchEvent(new Event('uac:alfresco-document-created'))
    onChanged?.()
  }
  return <section className="dispatch-summary" aria-label="Cierre de intervención">
    <button type="button" disabled={busy} onClick={() => run(refresh)}>Evaluar cierre de mi intervención</button>
    {result && <div>
      <p>{result.closed ? 'Intervención cerrada definitivamente.' : `Cumplimiento preliminar: ${result.evaluation.preliminaryCompliance}. La evaluación no cierra el documento.`}</p>
      {!result.writesEnabled && <p>Cierre deshabilitado hasta completar las verificaciones del piloto.</p>}
      {result.uncertain && !result.pendingOperation && <p role="alert">Resultado incierto sin diario confirmado. Se requiere conciliación técnica antes de otra decisión.</p>}
      {result.evaluation.blockingReasons.map(code => <p key={code}>{closureReasonMessage(code)}</p>)}
      {result.canClose && !readOnly && <label>Constancia de cierre <textarea value={reason} maxLength={2000} disabled={busy} onChange={e => setReason(e.target.value)} /></label>}
      {result.canClose && !readOnly && <button type="button" disabled={busy || !reason.trim()} onClick={() => run(close)}>Cerrar intervención</button>}
      {result.writesEnabled && result.pendingOperation && !readOnly && <button type="button" disabled={busy} onClick={() => run(close)}>Conciliar cierre pendiente</button>}
    </div>}
    {error && <p role="alert">{error} Consulta nuevamente la evaluación antes de continuar.</p>}
  </section>
}
