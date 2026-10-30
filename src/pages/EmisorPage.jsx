/* eslint-disable react/prop-types */
import { PanelPage } from '../components/PanelPage'
import { DocumentForm } from '../components/DocumentForm'
import { DocumentList } from '../components/DocumentList'
import { formatDocumentDate } from '../utils/documentFormat'

const normalizeStatus = (status) => String(status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')

function getDocumentCounts(documents) {
  return documents.reduce((counts, document) => {
    const status = normalizeStatus(document.status)
    counts.total += 1
    if (status.includes('pendiente') || status.startsWith('enviado')) counts.pending += 1
    if (status.includes('atendido') || status.includes('resuelto') || status.includes('completado') || status.includes('finalizado')) counts.attended += 1
    if (status.includes('devuelto')) counts.returned += 1
    return counts
  }, { total: 0, pending: 0, attended: 0, returned: 0 })
}

function EmisorHome({ description, documents, title }) {
  const counts = getDocumentCounts(documents)
  const recentDocuments = [...documents]
    .sort((left, right) => new Date(right.createdAt || right.documentDate || 0) - new Date(left.createdAt || left.documentDate || 0))
    .slice(0, 8)

  return (
    <PanelPage description={description} title={title}>
      <div aria-label="Resumen de documentos" className="emisor-summary">
        {[
          ['Documentos enviados', counts.total],
          ['Pendientes', counts.pending],
          ['Atendidos', counts.attended],
          ['Devueltos', counts.returned],
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
                <tr><th>Número documental</th><th>Asunto</th><th>Destinatario</th><th>Fecha</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {recentDocuments.map((document) => (
                  <tr key={document.id}>
                    <td>{document.documentNumber || '—'}</td>
                    <td>{document.subject || '—'}</td>
                    <td>{document.destination || '—'}</td>
                    <td>{formatDocumentDate(document.createdAt || document.documentDate)}</td>
                    <td><span className="status-label">{document.status || '—'}</span></td>
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
    return <DocumentList description="Documentos registrados durante esta sesión de prueba." documents={documents} title={title} />
  }

  if (activePanel === 'inicio') {
    return <EmisorHome description={description} documents={documents} title={title} />
  }

  return <PanelPage description={description} title={title} />
}
