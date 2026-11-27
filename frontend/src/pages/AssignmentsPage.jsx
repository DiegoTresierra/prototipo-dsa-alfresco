import { useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { PdfPreview } from '../components/PdfPreview'
import { DispatchPanel } from '../components/DispatchPanel'
import { assignmentRows, canDeriveAssignment } from '../utils/assignmentViews'
import { assignmentBackground, documentResponsibilities } from '../utils/dispatchPersistence'
import { responsibilityBadges } from '../utils/responsibleColors'
import { ResponsibilityIndicator } from '../components/ResponsibilityIndicator'
import { AttentionActions } from '../components/AttentionActions'
import { DocumentIdentitySummary } from '../components/DocumentIdentitySummary'
import { DeliveryDeadlineDateCell, DeliveryDeadlineStatusCell } from '../components/DeliveryDeadlineCells'

/* eslint-disable react/prop-types */
export function AssignmentsPage({ title, description, allowAlfresco, inbox, userId, mode = 'received', recipientRoles = [], recipients = [], recipientsLoading, recipientsError, onDispatch, csrfToken, canAttend = false, canIssueResponse = false, canLinkResponse = false, onAttentionChanged, onEmitResponse }) {
  const [selectedId, setSelectedId] = useState('')
  const [readOnlyId, setReadOnlyId] = useState('')
  if (!allowAlfresco) return <PanelPage title={title} description={description}><p className="form-message">La consulta requiere una sesión con permiso de lectura.</p></PanelPage>
  const sent = mode === 'sent'
  const rows = assignmentRows(sent ? inbox.sentDispatches || [] : inbox.dispatchRecords || [], userId, mode)
  const selected = rows.find(({ assignment }) => assignment.id === selectedId)
  const documentFor = (id) => inbox.documents?.find((document) => document.id === id)
  const document = selected && documentFor(selected.dispatch.documentId)
  const readOnlyDocuments = sent ? [] : (inbox.documents || []).filter((item) => !rows.some((row) => row.dispatch.documentId === item.id))
  const readOnlyDocument = readOnlyDocuments.find((item) => item.id === readOnlyId)
  const canDerive = !sent && selected && canDeriveAssignment(recipientRoles, selected.assignment, userId)
  const dateLabel = (value) => value ? new Date(value).toLocaleString('es-PE') : 'No registrada'
  return <section className="received-inbox" aria-labelledby="assignments-title">
    <header className="received-inbox__header"><div><p className="breadcrumb">Despacho interno</p><h1 id="assignments-title">{title}</h1><p className="received-inbox__intro">{sent ? 'Derivaciones realizadas, con un encargo individual por destinatario.' : 'Tus encargos sobre el documento original, sin copias del PDF.'}</p></div>
      <div className="received-inbox__refresh"><button className="button-secondary" disabled={inbox.loading || inbox.refreshing} onClick={inbox.refresh} type="button">{inbox.refreshing ? 'Actualizando...' : 'Actualizar bandeja'}</button></div>
    </header>
    {inbox.error && <p className="form-message form-message--error" role="alert">{inbox.error}</p>}
    {Boolean(inbox.documentErrors?.length) && <p className="form-message form-message--error" role="alert">La consulta es parcial: no se pudieron verificar algunos documentos o fuentes. No interpretes las ausencias como falta de encargos; actualiza la bandeja o verifica el permiso de lectura.</p>}
    <div className="table-scroll received-inbox__table-scroll" role="region" aria-label={title} tabIndex={0} aria-busy={inbox.loading || inbox.refreshing}>
      <table className="document-table received-inbox__table"><thead><tr><th>Documento</th><th>{sent ? 'Destinatario' : 'Autor del despacho'}</th><th>Encargo</th><th>Estado individual</th>{!sent && <><th>Fecha de entrega</th><th>Estado</th></>}<th>Acción</th></tr></thead><tbody>
        {!rows.length ? <tr><td className="received-inbox__empty" colSpan={sent ? 5 : 7}>{inbox.error ? 'No se pudo verificar la bandeja. Reintenta la consulta.' : inbox.loading ? 'Cargando encargos...' : sent ? 'Todavía no registraste derivaciones.' : 'No tienes asignaciones registradas.'}</td></tr> : rows.map(({ dispatch, assignment }) => {
          const item = documentFor(dispatch.documentId)
          const badges = responsibilityBadges(documentResponsibilities([...(inbox.dispatchRecords || []), ...(inbox.sentDispatches || [])], dispatch.documentId, true))
          return <tr key={assignment.id} className={badges.length ? 'document-table__row--assigned' : undefined} style={badges.length ? { '--assignment-background': assignmentBackground(badges.map((badge) => badge.color)) } : undefined}><td><div className="received-inbox__document"><ResponsibilityIndicator badges={badges} /><div>{item ? <button className="document-link received-inbox__subject" onClick={() => setSelectedId(assignment.id)} type="button">{item.subject || item.attachmentName}</button> : <span>Documento {dispatch.documentId}</span>}<span className="table-secondary">{item?.attachmentName || 'PDF no disponible para esta sesión'}</span><span className="table-secondary">Emisor documental: {dispatch.documentIdentity?.originalDependency || item?.documentIdentity?.originalDependency || 'No registrado'}</span></div></div></td>
            <td>{sent ? assignment.displayName || assignment.userId : dispatch.senderUserId}<span className="table-secondary">{sent ? assignment.functionalRole : dispatch.senderRole} · {dispatch.senderDependency?.toUpperCase()}</span></td>
            <td>{dispatch.instruction}<span className="table-secondary">{dateLabel(assignment.assignedAt || dispatch.createdAt)} · {dispatch.priority}</span>{assignment.originAssignmentId && <span className="table-secondary">Derivado de una asignación previa</span>}</td>
            <td><span className={assignment.status === 'ATENDIDO' ? 'assignment-state--attended' : ''}>{assignment.status}</span>{assignment.attendedAt && <span className="table-secondary">{dateLabel(assignment.attendedAt)}</span>}</td>{!sent && <DeliveryDeadlineDateCell assignment={assignment} />}{!sent && <DeliveryDeadlineStatusCell assignment={assignment} />}<td><button className="button-secondary" disabled={!item} onClick={() => setSelectedId(assignment.id)} type="button">Ver PDF{!sent && canDeriveAssignment(recipientRoles, assignment, userId) ? ' / Derivar' : ''}</button></td></tr>
        })}
      </tbody></table>
    </div>
    {selected && document && <section className="document-preview" aria-labelledby="assignment-preview-title"><div className="document-preview__header"><h2 id="assignment-preview-title">{document.subject || document.attachmentName}</h2><button className="button-secondary" onClick={() => setSelectedId('')} type="button">Cerrar vista previa</button></div>
      <div className="dispatch-summary"><strong>Encargo de {selected.dispatch.senderUserId}</strong><p>{selected.dispatch.instruction}</p><p>{selected.assignment.status} · {dateLabel(selected.dispatch.createdAt)}</p></div>
      <DocumentIdentitySummary identity={selected.dispatch.documentIdentity || document.documentIdentity} dispatch={selected.dispatch} />
      {!sent && selected.assignment.userId === userId && <AttentionActions key={selected.assignment.id} documentId={document.id} assignment={selected.assignment} csrfToken={csrfToken} canAttend={canAttend} canIssue={canIssueResponse} canLink={canLinkResponse} onChanged={onAttentionChanged} onEmit={onEmitResponse} />}
      {canDerive && <DispatchPanel key={selected.assignment.id} document={document} recipients={recipients} allowedRecipientRoles={recipientRoles} loading={recipientsLoading} error={recipientsError} onDispatch={onDispatch} originAssignmentId={selected.assignment.id} assignedUserIds={documentResponsibilities([...(inbox.dispatchRecords || []), ...(inbox.sentDispatches || [])], document.id, true).map((recipient) => recipient.userId)} />}
      <PdfPreview declaredMimeType={document.mimeType} fileName={document.attachmentName} nodeId={document.id} />
    </section>}
    {readOnlyDocuments.length > 0 && <section aria-label="Lectura institucional sin encargo"><h2>Documentos propios y Por conocimiento</h2><p>La lectura no implica responsabilidad ni permite derivar.</p><ul>{readOnlyDocuments.map((item) => <li key={item.id}>{item.subject || item.attachmentName}<button type="button" className="button-secondary" onClick={() => setReadOnlyId(item.id)}>Consultar PDF</button></li>)}</ul></section>}
    {readOnlyDocument && <section className="document-preview"><h2>{readOnlyDocument.subject || readOnlyDocument.attachmentName}</h2><button type="button" onClick={() => setReadOnlyId('')}>Cerrar lectura</button><PdfPreview declaredMimeType={readOnlyDocument.mimeType} fileName={readOnlyDocument.attachmentName} nodeId={readOnlyDocument.id} /></section>}
  </section>
}
