/* eslint-disable react/prop-types */
import { PanelPage } from '../components/PanelPage'
import { DocumentList } from '../components/DocumentList'

export function DirectorPage({ title, description, activePanel, documents }) {
  if (activePanel === 'para-conocimiento') {
    return <DocumentList description="Documentos enviados en esta sesión para conocimiento." documents={documents} title={title} />
  }

  return <PanelPage description={description} title={title} />
}
