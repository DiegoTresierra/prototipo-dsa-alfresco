/* eslint-disable react/prop-types */
import { PanelPage } from '../components/PanelPage'
import { DocumentList } from '../components/DocumentList'

export function EspecialistaPage({ title, description, activePanel, documents }) {
  if (activePanel === 'mis-asignaciones') {
    return <DocumentList description="Documentos asignados al responsable principal seleccionado al enviarlos." documents={documents} title={title} />
  }

  return <PanelPage description={description} title={title} />
}
