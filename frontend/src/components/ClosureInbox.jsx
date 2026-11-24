import { useState } from 'react'
import { getClosureInbox } from '../api/alfresco'
import { useAssignmentInbox } from '../hooks/useAssignmentInbox'
import { ClosurePanel } from './ClosurePanel'
import { closureReasonMessage } from '../utils/closureMessages'
import { RelatedResponses } from './RelatedResponses'
import { PdfPreview } from './PdfPreview'

/* eslint-disable react/prop-types */
export function ClosureInbox({ allowed, csrfToken, scopeKey }) {
  const inbox = useAssignmentInbox({ active: allowed, allowed, loadInbox: getClosureInbox, scopeKey })
  return <ClosureInboxView inbox={inbox} allowed={allowed} csrfToken={csrfToken} />
}

export function ClosureInboxView({ inbox, allowed, csrfToken, initialCategory = 'APTAS' }) {
  const [selectedId, setSelectedId] = useState('')
  const [category, setCategory] = useState(initialCategory)
  const categories = { APTAS: 'Aptas para cierre', PENDIENTES: 'Pendientes', CERRADAS: 'Cerradas' }
  const complete = inbox.complete === true && !inbox.error && !inbox.loading && !inbox.refreshing
  const visible = (inbox.documents || []).filter(d => d.closure.category === category)
  const selected = (inbox.documents || []).find(d => d.id === selectedId)
  if (!allowed) return <p role="alert">La bandeja requiere Dirección competente con autorización documental.</p>
  return <section className="received-inbox" aria-label="Aprobar cierres">
    <h1>Aprobar cierres</h1>
    <p>Intervenciones de tu dependencia. El cumplimiento preliminar no constituye cierre formal.</p>
    <button type="button" className="button-secondary" disabled={inbox.loading || inbox.refreshing} onClick={inbox.refresh}>Actualizar bandeja</button>
    {inbox.loading && <p role="status">Consultando Alfresco y evaluando obligaciones…</p>}
    {inbox.error && <p role="alert">{inbox.error} No se confirmó la consulta actual; actualiza antes de decidir.</p>}
    {inbox.warning && <p role="alert">{inbox.warning}</p>}
    {!inbox.loading && !complete && <p role="status">Información parcial o pendiente de verificar. No se muestran contadores de cobertura completa.</p>}
    <div role="tablist" aria-label="Clasificación de intervenciones">{Object.entries(categories).map(([id, label]) =>
      <button type="button" role="tab" aria-selected={category === id} key={id} onClick={() => { setCategory(id); setSelectedId('') }}>{label}{complete && Number.isSafeInteger(inbox.counts?.[id]) ? ` (${inbox.counts[id]})` : ''}</button>)}</div>
    {!inbox.loading && !inbox.error && !inbox.documents?.length && <p>No hay intervenciones en las fuentes institucionales consultadas.</p>}
    {!inbox.loading && !inbox.error && Boolean(inbox.documents?.length) && !visible.length && <p>No hay intervenciones en esta categoría.</p>}
    <div className="table-scroll"><table className="document-table"><thead><tr>
      <th>Documento / asunto</th><th>Dependencia</th><th>Responsables</th><th>Cumplimiento</th><th>Pendientes</th><th>Fecha de registro</th><th>Consulta</th>
      <th>Cierre acreditado</th>
    </tr></thead><tbody>{visible.map(d => <tr key={d.closure.key}>
      <td>{d.subject || d.attachmentName}<small> · {d.attachmentName}</small><p>UUID: {d.id}</p></td>
      <td>{d.closure.dependency.toUpperCase()}</td><td>{d.closure.responsibleUserIds.join(', ') || 'Sin responsables verificables'}</td>
      <td>{d.closure.category === 'CERRADAS' ? 'Cierre real verificado' : d.closure.compliance === 'BLOCKED' ? 'Pendiente de atención o con bloqueos' : d.closure.compliance === 'INDETERMINATE' ? 'Indeterminada: evidencia insuficiente' : 'Cumplimiento documental verificado'}<ul>{d.closure.evaluation.blockingReasons.map(code => <li key={code}>{closureReasonMessage(code)} <small>{code}</small></li>)}</ul></td>
      <td>{d.closure.evaluation.summary?.pending ?? 'No determinado'}</td><td>{d.createdAt ? new Date(d.createdAt).toLocaleString('es-PE') : 'No registrada'}</td>
      <td><button type="button" onClick={() => setSelectedId(d.id)}>Abrir y evaluar</button></td>
      <td>{d.closure.category === 'CERRADAS' ? `${new Date(d.closure.closedAt).toLocaleString('es-PE')} · ${d.closure.closedBy}` : 'Sin cierre real acreditado'}</td>
    </tr>)}</tbody></table></div>
    {selected && !inbox.error && <section key={selected.closure.key} aria-label="Documento para decisión">
      <button type="button" onClick={() => setSelectedId('')}>Cerrar vista previa</button>
      <h2>{selected.subject}</h2>
      <ClosurePanel key={inbox.lastUpdated || selected.closure.key} documentId={selected.id} csrfToken={csrfToken} onChanged={inbox.refresh} autoEvaluate readOnly={inbox.loading || inbox.refreshing} />
      <RelatedResponses documentId={selected.id} csrfToken={csrfToken} />
      <p>Las relaciones de anexos y antecedentes requieren un contrato institucional; las respuestas se consultan por separado.</p>
      <PdfPreview nodeId={selected.id} declaredMimeType={selected.mimeType} fileName={selected.attachmentName} />
    </section>}
  </section>
}
