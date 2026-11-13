/* eslint-disable react/prop-types */
import { useState } from 'react'
import { DocumentList } from '../components/DocumentList'
import { PanelPage } from '../components/PanelPage'
import { PdfPreview } from '../components/PdfPreview'
import { DirectorPage } from './DirectorPage'
import { HierarchyManagementPage } from './HierarchyManagementPage'
import { formatDocumentDate } from '../utils/documentFormat'

function DirectorHome({ office, sent, received }) {
  const recent = [...sent, ...received]
    .filter((document, index, all) => all.findIndex((entry) => entry.id === document.id) === index)
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .slice(0, 6)

  return (
    <PanelPage description={`Resumen de actividad documental de ${office.office}.`} title="Inicio">
      <div aria-label="Indicadores documentales de Alfresco" className="director-summary">
        {[
          ['Documentos enviados', sent.length],
          ['Documentos recibidos', received.length],
          ['Pendientes', '—'],
          ['Atendidos', '—'],
        ].map(([label, value]) => (
          <article className="director-summary__item" key={label}><h2>{label}</h2><p>{value}</p></article>
        ))}
      </div>
      <section className="director-activity" aria-labelledby="director-activity-title">
        <h2 id="director-activity-title">Actividad reciente</h2>
        {recent.length === 0 ? <div className="empty-state">No hay documentos confirmados por Alfresco para mostrar.</div> : (
          <div className="table-scroll">
            <table className="document-table director-activity__table">
              <thead><tr><th>Archivo</th><th>Asunto</th><th>Remitente</th><th>Fecha</th><th>Estado</th></tr></thead>
              <tbody>{recent.map((document) => (
                <tr key={document.id}>
                  <td>{document.attachmentName || '—'}</td><td>{document.subject || '—'}</td>
                  <td>{document.sender || '—'}</td><td>{formatDocumentDate(document.createdAt || document.emissionDate)}</td>
                  <td><span className="status-label">{document.status || 'Sin estado en Alfresco'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </PanelPage>
  )
}

export function DirectorWorkspacePage({ title, description, activePanel, alfrescoDocuments = [], office, localScopeId, allowAlfresco = false, inbox }) {
  const [selectedSentDocumentId, setSelectedSentDocumentId] = useState('')
  const sent = office.userId ? alfrescoDocuments.filter((document) => document.senderUserId === office.userId) : []
  const received = inbox?.documents || []
  const selectedSentDocument = sent.find((document) => document.id === selectedSentDocumentId)

  if (activePanel === 'inicio') return <DirectorHome office={office} received={received} sent={sent} />
  if (activePanel === 'gestion-jerarquia') return <HierarchyManagementPage localScopeId={localScopeId} office={office} />
  if (['documentos-recibidos', 'para-conocimiento', 'para-atencion'].includes(activePanel)) {
    return <DirectorPage allowAlfresco={allowAlfresco} description={description} inbox={inbox} title={title} />
  }

  if (activePanel === 'documentos-enviados') {
    return (
      <PanelPage description="Documentos cuya creacion fue confirmada por Alfresco." title={title}>
        {sent.length === 0 ? <div className="empty-state">No hay documentos enviados registrados en esta sesion del navegador.</div> : (
          <div className="table-scroll"><table className="document-table">
            <thead><tr><th>Id Alfresco</th><th>Asunto</th><th>Archivo principal</th><th>Fecha de emision</th><th>Estado</th></tr></thead>
            <tbody>{sent.map((document) => (
              <tr key={document.id}>
                <td>{document.id}</td><td>{document.subject}</td>
                <td><button className="document-link" onClick={() => setSelectedSentDocumentId(document.id)} type="button">Ver documento</button><small className="table-secondary">{document.attachmentName}</small></td>
                <td>{formatDocumentDate(document.emissionDate)}</td><td><span className="status-label">Confirmado por Alfresco</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {selectedSentDocument && <section aria-labelledby="sent-document-preview-title" className="document-preview">
          <div className="document-preview__header"><div><p className="breadcrumb">Vista previa</p><h2 id="sent-document-preview-title">{selectedSentDocument.attachmentName}</h2></div>
            <button className="button-secondary" onClick={() => setSelectedSentDocumentId('')} type="button">Cerrar vista previa</button></div>
          <PdfPreview declaredMimeType={selectedSentDocument.attachmentType} fileName={selectedSentDocument.attachmentName} nodeId={selectedSentDocument.id} />
        </section>}
      </PanelPage>
    )
  }

  if (activePanel === 'mis-documentos' || activePanel === 'seguimiento') {
    const related = [...new Map([...sent, ...received].map((document) => [document.id, document])).values()]
    return <DocumentList description="Documentos disponibles desde Alfresco para esta sesion." documents={related} title={title} />
  }

  return <PanelPage description={description} title={title}><p className="empty-state">Esta operacion requiere un flujo y estados configurados en Alfresco.</p></PanelPage>
}
