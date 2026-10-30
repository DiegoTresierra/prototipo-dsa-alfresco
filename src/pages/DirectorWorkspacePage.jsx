/* eslint-disable react/prop-types */
import { useState } from 'react'
import { DocumentForm } from '../components/DocumentForm'
import { DocumentList } from '../components/DocumentList'
import { PanelPage } from '../components/PanelPage'
import { PdfPreview } from '../components/PdfPreview'
import { DirectorPage } from './DirectorPage'
import { formatDocumentDate } from '../utils/documentFormat'

const normalizeStatus = (status) => String(status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')

function getLocalSummary(documents, office) {
  const sent = documents.filter((document) => document.issuingAcronym === office.acronym)
  const received = documents.filter((document) => document.destinationId === office.dependencyId)
  const related = [...new Map([...sent, ...received].map((document) => [document.id, document])).values()]
  const pendingCount = related.filter((document) => {
    const status = normalizeStatus(document.status)
    return status.includes('pendiente') || status.startsWith('enviado')
  }).length
  const attendedCount = related.filter((document) => {
    const status = normalizeStatus(document.status)
    return status.includes('atendido') || status.includes('resuelto') || status.includes('completado') || status.includes('finalizado')
  }).length

  return { sent, received, related, pendingCount, attendedCount }
}

function DirectorHome({ office, summary }) {
  const recent = [...summary.related]
    .sort((left, right) => new Date(right.createdAt || right.documentDate || 0) - new Date(left.createdAt || left.documentDate || 0))
    .slice(0, 6)

  return (
    <PanelPage description={`Resumen de actividad documental de ${office.office}.`} title="Inicio">
      <p className="director-local-note">Resumen basado en registros locales de demostración.</p>
      <div aria-label="Indicadores de documentos locales" className="director-summary">
        {[
          ['Documentos enviados', summary.sent.length],
          ['Documentos recibidos', summary.received.length],
          ['Pendientes', summary.pendingCount],
          ['Atendidos', summary.attendedCount],
        ].map(([label, value]) => (
          <article className="director-summary__item" key={label}>
            <h2>{label}</h2><p>{value}</p>
          </article>
        ))}
      </div>
      <section className="director-activity" aria-labelledby="director-activity-title">
        <h2 id="director-activity-title">Actividad reciente</h2>
        {recent.length === 0 ? (
          <div className="empty-state">No hay actividad documental local para mostrar.</div>
        ) : (
          <div className="table-scroll">
            <table className="document-table director-activity__table">
              <thead><tr><th>Número documental</th><th>Asunto</th><th>Remitente o destinatario</th><th>Fecha</th><th>Estado local</th></tr></thead>
              <tbody>{recent.map((document) => (
                <tr key={document.id}>
                  <td>{document.documentNumber || '—'}</td>
                  <td>{document.subject || '—'}</td>
                  <td>{document.issuingAcronym === office.acronym ? document.destination : document.sender}</td>
                  <td>{formatDocumentDate(document.createdAt || document.documentDate)}</td>
                  <td><span className="status-label">{document.status || '—'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </PanelPage>
  )
}

export function DirectorWorkspacePage({ title, description, activePanel, documents, alfrescoDocuments = [], onDocumentSubmit, office }) {
  const [selectedSentDocumentId, setSelectedSentDocumentId] = useState('')
  const summary = getLocalSummary(documents, office)
  const confirmedSent = alfrescoDocuments.filter((document) => document.issuingAcronym === office.acronym)
  const selectedSentDocument = confirmedSent.find((document) => document.id === selectedSentDocumentId)

  if (activePanel === 'nuevo-documento') {
    return <DocumentForm onSubmit={onDocumentSubmit} panelLabel={`Panel de Dirección ${office.acronym}`} user={office} />
  }

  if (activePanel === 'inicio') {
    return <DirectorHome office={office} summary={summary} />
  }

  if (activePanel === 'para-conocimiento' && office.acronym === 'DSA') {
    const receivedForDsa = documents.filter((document) => document.destinationId === 'dsa')
    return <DirectorPage activePanel={activePanel} description={description} documents={receivedForDsa} title={title} />
  }

  if (activePanel === 'documentos-enviados') {
    return (
      <PanelPage description="Documentos confirmados por Alfresco y conservados en este navegador." title={title}>
        {confirmedSent.length === 0 ? (
          <div className="empty-state">No hay documentos confirmados por Alfresco para esta dependencia.</div>
        ) : (
          <div className="table-scroll">
            <table className="document-table">
              <thead><tr><th>Id Alfresco</th><th>Número documental</th><th>Asunto</th><th>Archivo principal</th><th>Fecha de emisión</th><th>Estado</th></tr></thead>
              <tbody>{confirmedSent.map((document) => (
                <tr key={document.id}>
                  <td>{document.id}</td><td>{document.documentNumber}</td><td>{document.subject}</td>
                  <td><button className="document-link" onClick={() => setSelectedSentDocumentId(document.id)} type="button">Ver documento</button><small className="table-secondary">{document.attachmentName}</small></td>
                  <td>{formatDocumentDate(document.emissionDate)}</td>
                  <td><span className="status-label">Confirmado por Alfresco</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {selectedSentDocument && (
          <section aria-labelledby="sent-document-preview-title" className="document-preview">
            <div className="document-preview__header">
              <div><p className="breadcrumb">Vista previa</p><h2 id="sent-document-preview-title">{selectedSentDocument.attachmentName}</h2></div>
              <button className="button-secondary" onClick={() => setSelectedSentDocumentId('')} type="button">Cerrar vista previa</button>
            </div>
            <PdfPreview declaredMimeType={selectedSentDocument.attachmentType} fileName={selectedSentDocument.attachmentName} nodeId={selectedSentDocument.id} />
          </section>
        )}
      </PanelPage>
    )
  }

  if (activePanel === 'para-conocimiento' || activePanel === 'para-atencion') {
    const received = summary.received
    return <DocumentList description="Documentos locales de demostración recibidos por esta dependencia." documents={received} title={title} />
  }

  if (activePanel === 'mis-documentos' || activePanel === 'seguimiento') {
    return <DocumentList description="Documentos locales de demostración relacionados con esta dependencia." documents={summary.related} title={title} />
  }

  return (
    <PanelPage description={description} title={title}>
      <p className="director-local-note">Esta sección es una vista de demostración; todavía no procesa solicitudes ni aprobaciones.</p>
    </PanelPage>
  )
}
