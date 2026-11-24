import { useState } from 'react'
import { getClosureEvaluation, confirmDocumentClosure } from '../api/alfresco'
/* eslint-disable react/prop-types */
export function ClosurePanel({ documentId, csrfToken }) {
  const messages = { OBLIGATIONS_PENDING: 'Hay obligaciones pendientes de atención.', CANCELLATION_EVIDENCE_MISSING: 'Falta acreditar la autorización de una anulación.',
    NO_CLASSIFIED_OBLIGATIONS: 'No hay obligaciones ni clasificación suficiente para decidir el cierre.', RECONCILIATION_REQUIRED: 'Existe una operación pendiente de conciliación.',
    KNOWLEDGE_CLASSIFICATION_UNVERIFIED: 'Falta verificar la clasificación de conocimiento.', PROPOSAL_EVIDENCE_INCOMPLETE: 'No se pudo verificar una propuesta relacionada.',
    PROJECTION_MISMATCH: 'Las responsabilidades registradas presentan una inconsistencia.', KNOWLEDGE_CONFIRMATIONS_PENDING: 'Faltan confirmaciones de conocimiento.' }
  const [result, setResult] = useState(null)
  const [reason, setReason] = useState('')
  const [key] = useState(() => globalThis.crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
  }
  return <section className="dispatch-summary" aria-label="Cierre de intervención">
    <button type="button" disabled={busy} onClick={() => run(refresh)}>Evaluar cierre de mi intervención</button>
    {result && <div>
      <p>{result.closed ? 'Intervención cerrada definitivamente.' : `Cumplimiento preliminar: ${result.evaluation.preliminaryCompliance}. La evaluación no cierra el documento.`}</p>
      {!result.writesEnabled && <p>Cierre deshabilitado hasta completar las verificaciones del piloto.</p>}
      {result.uncertain && !result.pendingOperation && <p role="alert">Resultado incierto sin diario confirmado. Se requiere conciliación técnica antes de otra decisión.</p>}
      {result.evaluation.blockingReasons.map(code => <p key={code}>{messages[code] || 'Existe un requisito que aún no se ha podido verificar.'}</p>)}
      {result.canClose && <label>Constancia de cierre <textarea value={reason} maxLength={2000} disabled={busy} onChange={e => setReason(e.target.value)} /></label>}
      {result.canClose && <button type="button" disabled={busy || !reason.trim()} onClick={() => run(close)}>Cerrar intervención</button>}
      {result.writesEnabled && result.pendingOperation && <button type="button" disabled={busy} onClick={() => run(close)}>Conciliar cierre pendiente</button>}
    </div>}
    {error && <p role="alert">{error} Consulta nuevamente la evaluación antes de continuar.</p>}
  </section>
}
