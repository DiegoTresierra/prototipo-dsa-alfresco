/* eslint-disable react/prop-types */
import { PanelPage } from '../components/PanelPage'

export function EspecialistaPage({ title, description, activePanel }) {
  if (activePanel === 'mis-asignaciones') {
    return <PanelPage description={description} title={title}><p className="empty-state">Alfresco todavia no proporciona un estado de asignacion para esta bandeja.</p></PanelPage>
  }

  return <PanelPage description={description} title={title} />
}
