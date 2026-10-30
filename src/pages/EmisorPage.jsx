/* eslint-disable react/prop-types */
import { PanelPage } from '../components/PanelPage'
import { DocumentForm } from '../components/DocumentForm'
import { DocumentList } from '../components/DocumentList'

export function EmisorPage({ title, description, activePanel, documents, onDocumentSubmit }) {
  if (activePanel === 'nuevo-documento') {
    return <DocumentForm onSubmit={onDocumentSubmit} />
  }

  if (activePanel === 'mis-envios') {
    return <DocumentList description="Documentos registrados durante esta sesión de prueba." documents={documents} title={title} />
  }

  return <PanelPage description={description} title={title} />
}
