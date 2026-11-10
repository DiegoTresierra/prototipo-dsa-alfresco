import { NotificationBell } from './NotificationBell'
import { Icon } from './Icon'

/* eslint-disable react/prop-types */
export function TopBar({ onMenuClick, officeName, notifications, onNotificationUpdate, notificationMessage = '' }) {
  return (
    <header className="topbar">
      <button aria-label="Abrir menú" className="topbar__menu" onClick={onMenuClick} type="button"><Icon name="menu" /></button>
      <div className="topbar__title">
        <p className="topbar__eyebrow">{officeName}</p>
        <h2>Gestión Documental Interna</h2>
      </div>
      <NotificationBell message={notificationMessage} notifications={notifications} onUpdate={onNotificationUpdate} />
    </header>
  )
}
