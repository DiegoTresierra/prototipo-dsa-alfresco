import { documentPriority } from '../utils/documentViews'

/* eslint-disable react/prop-types */
function formatDetectedAt(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Fecha de detección no disponible'
  return `Detectado ${date.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

export function NotificationList({ notifications, onViewDocument, emptyMessage = 'No se detectaron documentos nuevos desde la última consulta guardada.' }) {
  if (notifications.length === 0) return <p className="notification-list__empty">{emptyMessage}</p>

  return (
    <ul aria-label="Documentos detectados recientemente" className="notification-list">
      {notifications.map((notification) => {
        const priority = documentPriority(notification.priority)
        return (
          <li className={`notification-item${notification.isRead ? ' notification-item--read' : ' notification-item--unread'}`} key={notification.id}>
            <div className="notification-item__top">
              <span className={`notification-item__state${notification.isRead ? ' notification-item__state--read' : ''}`}>{notification.isRead ? 'Revisado en este navegador' : 'Nuevo'}</span>
              <span className={`inbox-priority inbox-priority--${priority.className}`}>{priority.label}</span>
            </div>
            <h3>{notification.title || 'Documento sin título'}</h3>
            {notification.sender && <p className="notification-item__sender">De {notification.sender}</p>}
            <time className="notification-item__time" dateTime={notification.detectedAt}>{formatDetectedAt(notification.detectedAt)}</time>
            <button className="notification-item__open" onClick={() => onViewDocument(notification)} type="button">Ver documento</button>
          </li>
        )
      })}
    </ul>
  )
}
