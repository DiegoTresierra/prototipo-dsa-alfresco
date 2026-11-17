import { useEffect, useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { PdfPreview } from '../components/PdfPreview'
import { Icon } from '../components/Icon'
import { DispatchPanel } from '../components/DispatchPanel'
import { documentPriority } from '../utils/documentViews'
import { eligibleDispatchRecipients } from '../utils/dispatchRecipients'
import { assignmentBackground, documentResponsibilities } from '../utils/dispatchPersistence'
import { responsibilityBadges } from '../utils/responsibleColors'
import { ResponsibilityIndicator } from '../components/ResponsibilityIndicator'

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}
function priorityOf(document) {
  return documentPriority(document.priority)
}
function timestamp(value) {
  const time = value ? new Date(value).getTime() : NaN
  return Number.isFinite(time) ? time : 0
}
/* eslint-disable react/prop-types */
function DocumentDate({ value }) {
  if (!timestamp(value)) return <span className="received-inbox__muted">No registrada</span>
  const date = new Date(value)
  return <time dateTime={date.toISOString()} className="received-inbox__date">
    <span>{date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
    <small>{date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</small>
  </time>
}
export function DirectorPage({ title, description, allowAlfresco = false, inbox, mode = 'received', attentionIds = [], onPersonalAttentionChange, assignmentError = '', canDispatch = false, recipients = [], recipientRoles = [], recipientsLoading = false, recipientsError = '', onDispatch, dispatchRecords = [], openDocumentId = '', onDocumentPreviewClose }) {
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const [pendingRecipient, setPendingRecipient] = useState(null)
  const [query, setQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('newest')
  useEffect(() => {
    if (openDocumentId) setSelectedDocumentId(openDocumentId)
  }, [openDocumentId])
  const isSent = mode === 'sent'
  const isAttention = mode === 'attention'
  const dispatchRecipients = canDispatch ? eligibleDispatchRecipients(recipients, recipientRoles) : []
  const chooseAssignee = (documentId, value) => {
    if (value.startsWith('dispatch:')) {
      const recipientId = value.slice('dispatch:'.length)
      if (!dispatchRecipients.some((recipient) => recipient.id === recipientId)) return
      setPendingRecipient({ documentId, recipientId })
      setSelectedDocumentId(documentId)
      return // Choosing a candidate never sends a dispatch or changes personal attention.
    }
    setPendingRecipient(null)
    onPersonalAttentionChange?.(documentId, value === 'self')
  }
  if (!allowAlfresco) {
    return <PanelPage description={description} title={title}><p className="form-message" role="status">La consulta requiere una sesión autenticada con permiso de lectura.</p></PanelPage>
  }
  const documents = inbox.documents || []
  const search = normalize(query)
  const visibleDocuments = documents.filter((document) => {
    const matchesQuery = normalize([document.subject, document.description, document.attachmentName, document.sender, document.recipientName, document.recipientUnit].join(' ')).includes(search)
    return matchesQuery && (priorityFilter === 'all' || priorityOf(document).className === priorityFilter)
  }).sort((left, right) => {
    if (sortOrder === 'subject') return String(left.subject || left.attachmentName || '').localeCompare(String(right.subject || right.attachmentName || ''), 'es')
    if (sortOrder === 'priority') {
      const order = { urgent: 0, high: 1, normal: 2, unknown: 3 }
      const difference = order[priorityOf(left).className] - order[priorityOf(right).className]
      if (difference) return difference
    }
    return (timestamp(left.createdAt) - timestamp(right.createdAt)) * (sortOrder === 'oldest' ? 1 : -1)
  })
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId)
  const selectedDispatch = selectedDocument ? dispatchRecords.find((dispatch) => dispatch.documentId === selectedDocument.id) : null
  const emptyMessage = inbox.error
    ? 'No se pudo cargar la bandeja. Vuelve a actualizarla cuando se restablezca la conexión.'
    : inbox.loading ? 'Cargando documentos...'
      : documents.length ? 'No hay documentos que coincidan con tu búsqueda o prioridad.'
        : isAttention ? 'Todavía no seleccionaste documentos Para mí. Hazlo desde Documentos recibidos.'
          : isSent ? 'Todavía no hay envíos tuyos registrados en este navegador.' : 'Todavía no hay documentos en esta bandeja.'
  const intro = isSent ? 'Los documentos que enviaste tú, con su destinatario y prioridad.'
    : isAttention ? 'Solo los documentos que marcaste Para mí desde Documentos recibidos.'
      : 'Consulta los documentos recibidos y selecciona Para mí en los que vayas a atender.'
  return (
    <section className="received-inbox" aria-labelledby="received-inbox-title">
      <header className="received-inbox__header">
        <div><p className="breadcrumb">Bandeja de trabajo</p><h1 id="received-inbox-title">{title}</h1><p className="received-inbox__intro">{intro}</p></div>
        {!isSent && <div className="received-inbox__refresh"><button className="button-secondary" disabled={inbox.loading || inbox.refreshing} onClick={inbox.refresh} type="button">{inbox.refreshing ? 'Actualizando...' : 'Actualizar bandeja'}</button>{inbox.lastUpdated && <span className="received-inbox__muted">Actualizada: {new Date(inbox.lastUpdated).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>}</div>}
      </header>
      {inbox.error && <p className="form-message form-message--error" role="alert">{inbox.error}</p>}
      {assignmentError && <p className="form-message form-message--error" role="alert">{assignmentError}</p>}
      {canDispatch && recipientsError && <p className="form-message form-message--error" role="alert">{recipientsError}</p>}
      <div className="received-inbox__filters" aria-label="Organizar documentos recibidos">
        <label className="form-field received-inbox__search"><span>Buscar documento</span><input onChange={(event) => setQuery(event.target.value)} placeholder={isSent ? 'Asunto, archivo o destinatario' : 'Asunto, archivo o remitente'} type="search" value={query} /></label>
        <label className="form-field"><span>Prioridad</span><select onChange={(event) => setPriorityFilter(event.target.value)} value={priorityFilter}><option value="all">Todas las prioridades</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option><option value="unknown">No registrada</option></select></label>
        <label className="form-field"><span>Ordenar por</span><select onChange={(event) => setSortOrder(event.target.value)} value={sortOrder}><option value="newest">Documento más reciente</option><option value="oldest">Documento más antiguo</option><option value="subject">Asunto: A–Z</option><option value="priority">Mayor prioridad primero</option></select></label>
      </div>
      <div className="received-inbox__list-heading"><p aria-live="polite">{visibleDocuments.length} {visibleDocuments.length === 1 ? 'documento' : 'documentos'}{search || priorityFilter !== 'all' ? ' de ' + documents.length : ''}</p><div className="received-inbox__legend" aria-label="Colores de prioridad">{['Normal', 'Alta', 'Urgente'].map(documentPriority).map((priority) => <span className={'inbox-priority-key inbox-priority-key--' + priority.className} key={priority.className}>{priority.label}</span>)}</div></div>
      <div className="table-scroll received-inbox__table-scroll" role="region" aria-label={title} tabIndex={0} aria-busy={inbox.loading || inbox.refreshing}>
        <table className={'document-table received-inbox__table' + (isSent ? ' received-inbox__table--sent' : '')}>
          <thead><tr><th scope="col">Documento</th><th scope="col">{isSent ? 'Destinatario' : 'Remitente'}</th><th scope="col">{isSent ? 'Fecha de envío' : 'Fecha del documento'}</th>{!isSent && <th scope="col">Recepción</th>}<th scope="col">Prioridad</th>{!isSent && <th scope="col">Asignar responsable</th>}<th scope="col">Acción</th></tr></thead>
          <tbody>{visibleDocuments.length === 0 ? <tr><td colSpan={isSent ? 5 : 7} className="received-inbox__empty">{emptyMessage}</td></tr> : visibleDocuments.map((document) => {
            const priority = priorityOf(document)
            const subject = document.subject || document.attachmentName || 'Documento sin título'
            const documentDispatch = { recipients: documentResponsibilities(dispatchRecords, document.id, true) }
            const assignedUnits = responsibilityBadges(documentDispatch.recipients)
            const assignedUserIds = new Set(documentDispatch.recipients.map((recipient) => recipient.userId))
            return <tr className={[selectedDocumentId === document.id ? 'document-table__row--selected' : '', assignedUnits.length ? 'document-table__row--assigned' : ''].filter(Boolean).join(' ')} style={assignedUnits.length ? { '--assignment-background': assignmentBackground(assignedUnits.map((unit) => unit.color)) } : undefined} key={document.id}>
              <td><div className="received-inbox__document"><ResponsibilityIndicator badges={assignedUnits} /><span className="received-inbox__file-icon"><Icon name="file" size={21} /></span><div><button className="document-link received-inbox__subject" onClick={() => setSelectedDocumentId(document.id)} type="button">{subject}</button><span className="table-secondary">{document.attachmentName}</span>{document.description && <p className="received-inbox__description">{document.description}</p>}</div></div></td>
              <td>{isSent ? <><span className="received-inbox__sender">{document.recipientName || 'No registrado'}</span><span className="table-secondary">{document.recipientUnit || document.recipientDependencyId?.toLocaleUpperCase('es')}</span></> : <><span className="received-inbox__sender">{document.sender || 'No registrado'}</span>{document.originatingDependency && <span className="table-secondary">{document.originatingDependency}</span>}</>}</td>
              <td><DocumentDate value={isSent ? document.emissionDate || document.createdAt : document.createdAt} /></td>{!isSent && <td><DocumentDate value={document.receivedAt} /></td>}
              <td><span className={'inbox-priority inbox-priority--' + priority.className} title={document.prioritySource === 'browser' || isSent ? 'Prioridad seleccionada al enviar, guardada en este navegador' : undefined}>{priority.label}</span></td>
              {!isSent && <td><label className="form-field received-inbox__assignee"><select aria-label={'Asignar responsable a ' + subject} value={pendingRecipient?.documentId === document.id ? `dispatch:${pendingRecipient.recipientId}` : attentionIds.includes(document.id) ? 'self' : ''} disabled={!onPersonalAttentionChange && (!canDispatch || recipientsLoading || Boolean(recipientsError) || !dispatchRecipients.length)} onChange={(event) => chooseAssignee(document.id, event.target.value)}><option value="">{inbox.loading || inbox.refreshing ? 'Consultando asignaciones...' : assignedUserIds.size ? `${assignedUserIds.size} responsable${assignedUserIds.size === 1 ? ' asignado' : 's asignados'}` : 'Sin seleccionar'}</option><option disabled={!onPersonalAttentionChange} value="self">Para mí</option>{canDispatch && <optgroup disabled={inbox.loading || inbox.refreshing || Boolean(inbox.error) || recipientsLoading || Boolean(recipientsError)} label="Derivar a"><>{dispatchRecipients.map((recipient) => <option key={recipient.id} value={`dispatch:${recipient.id}`} data-already-assigned={assignedUserIds.has(recipient.id) ? 'true' : undefined}>{recipient.displayName} · {recipient.functionalRole === 'jefe-unidad' ? 'Jefatura' : 'Especialista'}{assignedUserIds.has(recipient.id) ? ' \u2014 Ya asignado' : ''}</option>)}</></optgroup>}</select><small>{canDispatch ? recipientsLoading ? 'Consultando destinatarios...' : 'Elige un destinatario y confirma en el formulario de derivación.' : onPersonalAttentionChange ? 'Selección personal' : 'No disponible'}</small></label></td>}
              <td><button className="button-secondary received-inbox__open" aria-label={'Ver PDF: ' + subject} onClick={() => setSelectedDocumentId(document.id)} type="button">Ver PDF</button></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <p className="received-inbox__data-note">{isSent ? 'Se muestran tus envíos confirmados y su prioridad guardada en este navegador.' : 'Tu selección Para mí se conserva en este navegador. La prioridad se muestra cuando el envío está registrado aquí. La fecha de recepción sigue pendiente de registro.'}</p>
      {selectedDocument && <section aria-labelledby="document-preview-title" className="document-preview"><div className="document-preview__header"><div><p className="breadcrumb">Vista previa del documento</p><h2 id="document-preview-title">{selectedDocument.subject || selectedDocument.attachmentName}</h2></div><button className="button-secondary" onClick={() => { setSelectedDocumentId(''); setPendingRecipient(null); onDocumentPreviewClose?.() }} type="button">Cerrar vista previa</button></div>{selectedDispatch && <div className="dispatch-summary"><strong>Encargo: {selectedDispatch.status}</strong><p><b>Instrucción:</b> {selectedDispatch.instruction}</p><p><b>Fecha:</b> {new Date(selectedDispatch.createdAt).toLocaleString('es-PE')} · <b>Prioridad:</b> {selectedDispatch.priority}</p></div>}{canDispatch && <DispatchPanel key={`${selectedDocument.id}:${pendingRecipient?.documentId === selectedDocument.id ? pendingRecipient.recipientId : ''}`} document={selectedDocument} error={recipientsError} loading={recipientsLoading} onDispatch={onDispatch} recipients={recipients} allowedRecipientRoles={recipientRoles} assignedUserIds={documentResponsibilities(dispatchRecords, selectedDocument.id, true).map((recipient) => recipient.userId)} initialRecipientIds={pendingRecipient?.documentId === selectedDocument.id ? [pendingRecipient.recipientId] : []} />}<PdfPreview declaredMimeType={selectedDocument.mimeType || selectedDocument.attachmentType} fileName={selectedDocument.attachmentName} nodeId={selectedDocument.id} /></section>}
    </section>
  )
}
