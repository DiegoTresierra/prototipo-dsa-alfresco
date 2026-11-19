import { PanelPage } from '../components/PanelPage'
import { AssignmentsPage } from './AssignmentsPage'

/* eslint-disable react/prop-types */
export function EspecialistaPage({ title, description, activePanel, ...props }) {
  if (['mis-asignaciones', 'documentos-recibidos'].includes(activePanel)) {
    return <AssignmentsPage title={title} description={description} {...props} recipientRoles={[]} />
  }
  return <PanelPage description={description} title={title} />
}
