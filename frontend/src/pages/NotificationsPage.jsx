import { NotificationList } from '../components/NotificationList'
import { PanelPage } from '../components/PanelPage'

/* eslint-disable react/prop-types */
export function NotificationsPage({ notifications, onViewDocument }) {
  const orderedNotifications = [...notifications].sort((left, right) => new Date(right.detectedAt) - new Date(left.detectedAt))

  return (
    <PanelPage description="Documentos detectados desde la última consulta guardada en este navegador." title="Notificaciones">
      <div className="notifications-page">
        <div className="notifications-page__session-note" role="status">
          Avisos locales de este navegador: se guardan identificadores, detección y preferencia de lectura. Los detalles se obtienen de la bandeja autorizada actual. La detección no acredita fecha de distribución institucional ni sincroniza lecturas entre dispositivos.
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
          <p className="notifications-page__unavailable">La atención individual se consulta en la bandeja de asignaciones; estos avisos locales no representan tareas ni estados de cierre global.</p>
        </section>
      </div>
    </PanelPage>
  )
}
