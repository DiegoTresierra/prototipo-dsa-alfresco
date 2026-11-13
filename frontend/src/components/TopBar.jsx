import { NotificationBell } from './NotificationBell'
import { Icon } from './Icon'

/* eslint-disable react/prop-types */
export function TopBar({ onMenuClick, officeName, notifications, notificationLoading, notificationError, onNotificationRefresh, onViewNotification, onViewAllNotifications, pendingNotificationMessage }) {
  return (
    <header className="topbar">
      <button aria-label="Abrir menú" className="topbar__menu" onClick={onMenuClick} type="button"><Icon name="menu" /></button>
      <div className="topbar__title">
        <p className="topbar__eyebrow">{officeName}</p>
        <h2>Gestión Documental Interna</h2>
      </div>
      <NotificationBell error={notificationError} loading={notificationLoading} notifications={notifications} onRefresh={onNotificationRefresh} onViewAll={onViewAllNotifications} onViewDocument={onViewNotification} pendingMessage={pendingNotificationMessage} />
    </header>
  )
}
