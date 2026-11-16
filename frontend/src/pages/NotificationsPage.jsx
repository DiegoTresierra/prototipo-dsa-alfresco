import { NotificationList } from '../components/NotificationList'
import { PanelPage } from '../components/PanelPage'

/* eslint-disable react/prop-types */
export function NotificationsPage({ notifications, onViewDocument }) {
  const orderedNotifications = [...notifications].sort((left, right) => new Date(right.detectedAt) - new Date(left.detectedAt))

  return (
    <PanelPage description="Documentos detectados desde la última consulta guardada en este navegador." title="Notificaciones">
      <div className="notifications-page">
        <div className="notifications-page__session-note" role="status">
          Se conservan solo metadatos de notificación y lectura en este navegador, no los archivos PDF. La hora indica cuándo se detectó el documento; el BFF no proporciona la hora real de recepción ni sincroniza lecturas entre dispositivos.
        </div>
        <section aria-labelledby="notifications-new-title" className="notifications-page__section">
          <div className="notifications-page__section-heading">
            <div>
              <p className="breadcrumb">Documentos entrantes</p>
              <h2 id="notifications-new-title">Documentos nuevos</h2>
            </div>
            <span className="notifications-page__count">{notifications.filter((notification) => !notification.isRead).length} sin revisar</span>
          </div>
          <NotificationList notifications={orderedNotifications} onViewDocument={onViewDocument} />
        </section>
        <section aria-labelledby="notifications-pending-title" className="notifications-page__section notifications-page__section--pending">
          <p className="breadcrumb">Seguimiento</p>
          <h2 id="notifications-pending-title">Pendientes de atención</h2>
          <p className="notifications-page__unavailable">No se muestran tareas pendientes: el BFF y Alfresco no proporcionan actualmente un estado verificable de atención.</p>
        </section>
      </div>
    </PanelPage>
  )
}
