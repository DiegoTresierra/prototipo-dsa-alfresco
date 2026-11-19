/* eslint-disable react/prop-types */
import { PanelPage } from '../components/PanelPage'
import { DocumentForm } from '../components/DocumentForm'
import { DocumentList } from '../components/DocumentList'
import { formatDocumentDate } from '../utils/documentFormat'

function EmisorHome({ description, documents, title }) {
  const recentDocuments = [...documents]
    .sort((left, right) => new Date(right.createdAt || right.documentDate || 0) - new Date(left.createdAt || left.documentDate || 0))
    .slice(0, 8)

  return (
    <PanelPage description={description} title={title}>
      <div aria-label="Resumen de documentos" className="emisor-summary">
        {[
          ['Documentos enviados', documents.length],
          ['Pendientes', '—'],
          ['Atendidos', '—'],
          ['Devueltos', '—'],
        ].map(([label, value]) => (
          <article className="emisor-summary__item" key={label}>
            <h2>{label}</h2>
            <p>{value}</p>
          </article>
        ))}
      </div>

      <section aria-labelledby="emisor-recent-title" className="emisor-recent">
        <h2 id="emisor-recent-title">Documentos recientes</h2>
        {recentDocuments.length === 0 ? (
          <div className="empty-state">La bandeja aún no tiene documentos enviados.</div>
        ) : (
          <div className="table-scroll">
            <table className="document-table emisor-recent__table">
              <thead>
                <tr><th>Archivo</th><th>Asunto</th><th>Destinatario</th><th>Fecha</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {recentDocuments.map((document) => (
                  <tr key={document.id}>
                    <td>{document.attachmentName || '—'}</td>
                    <td>{document.subject || '—'}</td>
                    <td>{document.destination || '—'}</td>
                    <td>{formatDocumentDate(document.createdAt || document.documentDate)}</td>
                    <td><span className="status-label">{document.status || 'Creado en Alfresco'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PanelPage>
  )
}

export function EmisorPage({ title, description, activePanel, documents, onDocumentSubmit }) {
  if (activePanel === 'nuevo-documento') {
    return <DocumentForm onSubmit={onDocumentSubmit} />
  }

  if (activePanel === 'mis-envios') {
    return <DocumentList description="Documentos confirmados por Alfresco durante esta sesión." documents={documents} title={title} />
  }

  if (activePanel === 'inicio') {
    return <EmisorHome description={description} documents={documents} title={title} />
  }

  return <PanelPage description={description} title={title} />
}
