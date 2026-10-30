import { formatDocumentDate } from '../utils/documentFormat'

/* eslint-disable react/prop-types */
export function DocumentList({ title, description, documents }) {
  return (
    <section aria-labelledby="document-list-title" className="document-list-page">
      <p className="breadcrumb">Bandeja de trabajo</p>
      <h1 id="document-list-title">{title}</h1>
      <p className="panel-page__intro">{description}</p>
      {documents.length === 0 ? (
        <div className="empty-state">Todavía no hay documentos registrados en esta sesión.</div>
      ) : (
        <div className="table-scroll">
          <table className="document-table">
            <thead><tr><th>Identificador temporal</th><th>Asunto</th><th>Remitente</th><th>Unidad</th><th>Responsable principal</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>{documents.map((document) => <tr key={document.id}><td>{document.id}</td><td><strong>{document.subject}</strong><small className="table-secondary">{document.attachmentName}</small></td><td>{document.sender}<small className="table-secondary">{document.originatingDependency}</small></td><td>{document.unitName}</td><td>{document.specialistName}</td><td>{formatDocumentDate(document.createdAt)}</td><td><span className="status-label">{document.status}</span></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
