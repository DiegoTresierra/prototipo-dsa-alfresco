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
            <thead>
              <tr>
                <th scope="col">ID interno temporal</th>
                <th scope="col">Tipo</th>
                <th scope="col">Correlativo original</th>
                <th scope="col">Año</th>
                <th scope="col">Sigla emisora</th>
                <th scope="col">Fecha del documento</th>
                <th scope="col">Asunto y descripción</th>
                <th scope="col">Remitente y origen</th>
                <th scope="col">Dependencia / destinatario</th>
                <th scope="col">Folios / prioridad</th>
                <th scope="col">Referencia</th>
                <th scope="col">Adjunto (solo metadatos)</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td><code className="temporary-id">{document.id}</code></td>
                  <td>{document.documentType}</td>
                  <td>{document.originalConsecutive}</td>
                  <td>{document.documentYear}</td>
                  <td>{document.issuingAcronym}</td>
                  <td>{formatDocumentDate(document.documentDate)}</td>
                  <td><strong>{document.subject}</strong><small className="table-secondary">{document.description}</small></td>
                  <td>{document.sender}<small className="table-secondary">{document.senderPosition}</small><small className="table-secondary">{document.originatingDependency}</small></td>
                  <td>{document.destination || document.recipientName}<small className="table-secondary">{document.recipientPosition}</small><small className="table-secondary">{document.organizationalUnit}</small></td>
                  <td>{document.folioCount}<small className="table-secondary">{document.priority}</small></td>
                  <td>{document.reference || '—'}</td>
                  <td>{document.attachmentName}<small className="table-secondary">{document.attachmentType} · {document.attachmentSize} bytes</small></td>
                  <td><span className="status-label">{document.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
