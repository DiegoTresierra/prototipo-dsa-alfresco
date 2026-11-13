import { useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { PdfPreview } from '../components/PdfPreview'

/* eslint-disable react/prop-types */
function unitKey(unit) {
  return String(unit?.code || unit?.id || unit?.acronym || unit?.name || '').trim().toLowerCase()
}

function dateLabel(value) {
  if (!value) return 'No registrada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'No registrada' : date.toLocaleString('es-PE')
}

export function JefeUnidadPage({ title, description, allowAlfresco = false, inbox, dispatchRecords = [], userId, unit }) {
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  if (!allowAlfresco) {
    return <PanelPage description={description} title={title}><p className="form-message" role="status">La consulta requiere una sesión autenticada con permiso de lectura.</p></PanelPage>
  }
  const currentUnit = unitKey(unit)
  const assigned = dispatchRecords
    .filter((dispatch) => dispatch.recipients?.some((recipient) =>
      recipient.userId === userId && (!currentUnit || unitKey(recipient.unit) === currentUnit)))
    .map((dispatch) => {
      const document = inbox.documents?.find((entry) => entry.id === dispatch.documentId)
      return document ? { dispatch, document } : null
    })
    .filter(Boolean)
  const selected = assigned.find(({ document }) => document.id === selectedDocumentId)
  return <section className="received-inbox" aria-labelledby="unit-inbox-title">
    <header className="received-inbox__header">
      <div><p className="breadcrumb">Bandeja de trabajo</p><h1 id="unit-inbox-title">{title}</h1><p className="received-inbox__intro">Documentos asignados de forma persistente a tu unidad organizacional.</p></div>
      <div className="received-inbox__refresh"><button className="button-secondary" disabled={inbox.loading || inbox.refreshing} onClick={inbox.refresh} type="button">{inbox.refreshing ? 'Actualizando...' : 'Actualizar bandeja'}</button></div>
    </header>
    {inbox.error && <p className="form-message form-message--error" role="alert">{inbox.error}</p>}
    <div className="table-scroll received-inbox__table-scroll" role="region" aria-label={title} tabIndex={0} aria-busy={inbox.loading || inbox.refreshing}>
      <table className="document-table received-inbox__table">
        <thead><tr><th scope="col">Documento</th><th scope="col">Dirección emisora</th><th scope="col">Despacho</th><th scope="col">Prioridad</th><th scope="col">Acción</th></tr></thead>
        <tbody>{assigned.length === 0
          ? <tr><td className="received-inbox__empty" colSpan="5">{inbox.loading ? 'Cargando documentos asignados...' : 'No tienes documentos asignados para esta unidad.'}</td></tr>
          : assigned.map(({ dispatch, document }) => <tr key={dispatch.id}>
            <td><button className="document-link received-inbox__subject" onClick={() => setSelectedDocumentId(document.id)} type="button">{document.subject || document.attachmentName || 'Documento sin título'}</button><span className="table-secondary">{document.attachmentName}</span></td>
            <td>{dispatch.senderDependency?.toUpperCase() || document.originatingDependency || document.sender || 'No registrada'}</td>
            <td><span>{dateLabel(dispatch.createdAt)}</span><span className="table-secondary">{dispatch.instruction}</span></td>
            <td>{dispatch.priority || 'Normal'}</td>
            <td><button className="button-secondary received-inbox__open" onClick={() => setSelectedDocumentId(document.id)} type="button">Ver PDF</button></td>
          </tr>)}</tbody>
      </table>
    </div>
    {selected && <section aria-labelledby="unit-document-preview-title" className="document-preview">
      <div className="document-preview__header"><div><p className="breadcrumb">Vista previa del documento</p><h2 id="unit-document-preview-title">{selected.document.subject || selected.document.attachmentName}</h2></div><button className="button-secondary" onClick={() => setSelectedDocumentId('')} type="button">Cerrar vista previa</button></div>
      <div className="dispatch-summary"><strong>Encargo de {selected.dispatch.senderDependency?.toUpperCase() || 'Dirección'}</strong><p><b>Instrucción:</b> {selected.dispatch.instruction}</p><p><b>Fecha:</b> {dateLabel(selected.dispatch.createdAt)} · <b>Prioridad:</b> {selected.dispatch.priority}</p></div>
      <PdfPreview declaredMimeType={selected.document.mimeType} fileName={selected.document.attachmentName} nodeId={selected.document.id} />
    </section>}
  </section>
}
