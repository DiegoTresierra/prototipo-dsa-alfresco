import { useState } from 'react'
import { Icon } from './Icon'

/* eslint-disable react/prop-types */
export function NotificationBell({ notifications, onUpdate, message = '' }) {
  const [isOpen, setIsOpen] = useState(false)

  const completeNotification = (notificationId) => {
    onUpdate(notifications.filter((notification) => notification.id !== notificationId))
  }

  return (
    <div className="topbar__notifications">
      <button aria-expanded={isOpen} aria-label={`Notificaciones pendientes: ${notifications.length}`} className="topbar__bell" onClick={() => setIsOpen((open) => !open)} type="button">
        <Icon name="bell" />{notifications.length > 0 && <span className="topbar__notification-count">{notifications.length}</span>}
      </button>
      {isOpen && <section aria-label="Panel de notificaciones" className="notification-panel">
        <header className="notification-panel__header"><div><h2>Notificaciones</h2><p>Eventos documentales de Alfresco.</p></div><button aria-label="Cerrar notificaciones" className="notification-panel__close" onClick={() => setIsOpen(false)} type="button"><Icon name="close" size={18} /></button></header>
        {message && <p className="notification-panel__empty" role="status">{message}</p>}
        {!message && notifications.length === 0 ? <p className="notification-panel__empty">No hay notificaciones pendientes.</p> : !message && <ul className="notification-list">{notifications.map((notification) => (
          <li className="notification-item" key={notification.id}>
            <div className="notification-item__top"><span className="notification-item__category">{notification.category}</span></div>
            <h3>{notification.title}</h3><p>{notification.description}</p>
            <div className="notification-item__actions"><button onClick={() => completeNotification(notification.id)} type="button">{notification.actionLabel || 'Marcar atendida'}</button><button onClick={() => completeNotification(notification.id)} type="button">Cerrar</button></div>
          </li>
        ))}</ul>}
      </section>}
    </div>
  )
}
