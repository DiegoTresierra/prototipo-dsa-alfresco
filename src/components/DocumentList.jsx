import { formatDocumentDate } from '../utils/documentFormat'

/* eslint-disable react/prop-types */
function formatFileSize(sizeInBytes) {
  if (!sizeInBytes) return '-'
  if (sizeInBytes < 1024) return `${sizeInBytes} B`
  if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`
  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
}

/* eslint-disable react/prop-types */
export function DocumentList({ title, description, documents, onSelectDocument, selectedDocumentId, showAlfrescoDetails = false }) {
  return (
    <section aria-labelledby="document-list-title" className="document-list-page">
      <p className="breadcrumb">Bandeja de trabajo</p>
      <h1 id="document-list-title">{title}</h1>
      <p className="panel-page__intro">{description}</p>
      {documents.length === 0 ? (
        <div className="empty-state">Todavía no hay documentos registrados en esta sesión.</div>
      ) : (
        <div className="table-scroll">
          <table className={`document-table${showAlfrescoDetails ? ' document-table--alfresco' : ''}`}>
            {showAlfrescoDetails ? (
              <>
                <thead><tr><th>Id Alfresco</th><th>Nombre del archivo</th><th>Título</th><th>Fecha</th><th>Creador</th><th>Tipo</th><th>Tamaño</th><th>Estado</th></tr></thead>
                <tbody>{documents.map((document) => <tr className={document.id === selectedDocumentId ? 'document-table__row--selected' : ''} key={document.id}><td>{document.id}</td><td><button className="document-link" onClick={() => onSelectDocument?.(document)} type="button">{document.attachmentName}</button></td><td>{document.subject || '-'}</td><td>{formatDocumentDate(document.createdAt)}</td><td>{document.sender || '-'}</td><td>{document.mimeType || '-'}</td><td>{formatFileSize(document.sizeInBytes)}</td><td>{document.status || 'No disponible'}</td></tr>)}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th>Identificador temporal</th><th>Asunto</th><th>Remitente</th><th>Unidad</th><th>Responsable principal</th><th>Fecha</th><th>Estado</th></tr></thead>
                <tbody>{documents.map((document) => <tr key={document.id}><td>{document.id}</td><td><strong>{document.subject}</strong><small className="table-secondary">{document.attachmentName}</small></td><td>{document.sender}<small className="table-secondary">{document.originatingDependency}</small></td><td>{document.unitName}</td><td>{document.specialistName}</td><td>{formatDocumentDate(document.createdAt)}</td><td><span className="status-label">{document.status}</span></td></tr>)}</tbody>
              </>
            )}
          </table>
        </div>
      )}
    </section>
  )
}
