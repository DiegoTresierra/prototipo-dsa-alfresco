import { documentPriority } from '../utils/documentViews'

/* eslint-disable react/prop-types */
function formatDetectedAt(value, type) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Fecha no disponible'
  const label = type === 'assignment-created' ? 'Encargo registrado' : type === 'assignment-attended' ? 'Encargo atendido' : type === 'deadline-near' ? 'Próximo a vencer' : type === 'deadline-overdue' ? 'Documento vencido' : 'Documento recibido'
  return `${label} ${date.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

function remainingLabel(value) {
  if (!Number.isFinite(value)) return 'No disponible'
  const totalMinutes = Math.ceil(Math.abs(value) / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts = [days ? `${days} d` : '', hours ? `${hours} h` : '', !days && !hours ? `${minutes} min` : ''].filter(Boolean)
  return value < 0 ? `Vencido hace ${parts.join(' ')}` : `Restan ${parts.join(' ')}`
}

export function NotificationList({ notifications, onViewDocument, emptyMessage = 'No se detectaron documentos nuevos desde la última consulta guardada.' }) {
  if (notifications.length === 0) return <p className="notification-list__empty">{emptyMessage}</p>

  return (
    <ul aria-label="Documentos y encargos recientes" className="notification-list">
      {notifications.map((notification) => {
        const priority = documentPriority(notification.priority)
        const titles = {
          'assignment-created': 'Nuevo encargo',
          'deadline-near': 'Próximo a vencer',
          'deadline-overdue': 'Documento vencido',
          'assignment-attended': 'Encargo atendido',
        }
        return (
          <li className={`notification-item${notification.isRead ? ' notification-item--read' : ' notification-item--unread'}`} key={notification.id}>
            <div className="notification-item__top">
              <span className={`notification-item__state${notification.isRead ? ' notification-item__state--read' : ''}`}>{notification.isRead ? 'Revisado en este navegador' : 'Sin revisar'}</span>
              <span className={`inbox-priority inbox-priority--${priority.className}`}>{priority.label}</span>
            </div>
            <h3>{titles[notification.type] || 'Documento recibido'} · {notification.title || 'Documento sin título'}</h3>
            {notification.sender && <p className="notification-item__sender">De {notification.sender}</p>}
            <time className="notification-item__time" dateTime={notification.detectedAt}>{formatDetectedAt(notification.detectedAt, notification.type)}</time>
            {notification.deadline && <div className="notification-item__deadline">
              <span>Estado: {({ EN_PLAZO: 'En plazo', POR_VENCER: 'Por vencer', VENCIDO: 'Vencido', ATENDIDO: 'Atendido', SIN_PLAZO_REGISTRADO: 'Sin plazo registrado' })[notification.deadline.status] || 'Sin plazo registrado'}</span>
              {notification.deadline.dueAt && <time dateTime={notification.deadline.dueAt}>Fecha límite: {new Date(notification.deadline.dueAt).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</time>}
              {notification.deadline.remainingMs !== null && notification.deadline.status !== 'ATENDIDO' && <span>{remainingLabel(notification.deadline.remainingMs)}</span>}
            </div>}
            <button className="notification-item__open" onClick={() => onViewDocument(notification)} type="button">Ver documento</button>
          </li>
        )
      })}
    </ul>
  )
}
