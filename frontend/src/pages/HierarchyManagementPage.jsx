import { PanelPage } from '../components/PanelPage'

/* eslint-disable react/prop-types */
export function HierarchyManagementPage({ office }) {
  return (
    <PanelPage description={`Administracion de usuarios y asignaciones de ${office.office}.`} title="Gestion de jerarquia">
      <p className="empty-state">La gestion de jerarquia requiere un directorio institucional conectado. No se realizan cambios de usuarios ni permisos desde esta interfaz.</p>
    </PanelPage>
  )
}
