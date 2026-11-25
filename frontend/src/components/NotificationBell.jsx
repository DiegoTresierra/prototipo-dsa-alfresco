import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { NotificationList } from './NotificationList'

/* eslint-disable react/prop-types */
export function NotificationBell({ notifications, loading, error, onRefresh, onViewDocument, onViewAll, pendingMessage = '' }) {
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)
  const unreadCount = notifications.filter((notification) => !notification.isRead).length

  useEffect(() => {
    if (!isOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }
    const closeOnOutsidePointer = (event) => {
      if (!panelRef.current?.contains(event.target)) setIsOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }
  }, [isOpen])

  const handleViewAll = () => {
    setIsOpen(false)
    onViewAll()
  }

  return (
    <div className="topbar__notifications" ref={panelRef}>
      <button aria-controls="notification-panel" aria-expanded={isOpen} aria-label={`Avisos sin revisar: ${unreadCount}`} className="topbar__bell" onClick={() => setIsOpen((open) => !open)} ref={buttonRef} type="button">
        <Icon name="bell" />{unreadCount > 0 && <span className="topbar__notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {isOpen && <section aria-labelledby="notification-panel-title" className="notification-panel" id="notification-panel">
        <header className="notification-panel__header">
          <div><p className="breadcrumb">Actividad documental</p><h2 id="notification-panel-title">Notificaciones</h2><p>{unreadCount} avisos sin revisar</p></div>
          <button aria-label="Cerrar notificaciones" className="notification-panel__close" onClick={() => setIsOpen(false)} type="button"><Icon name="close" size={18} /></button>
        </header>
        <div className="notification-panel__body" aria-live="polite" aria-busy={loading}>
          {loading && notifications.length === 0 && <p className="notification-panel__state" role="status">Consultando tus bandejas autorizadas…</p>}
          {error && <div className="notification-panel__error" role="alert"><p>{error}</p><button className="button-secondary" disabled={loading} onClick={onRefresh} type="button">Reintentar</button></div>}
          {notifications.length > 0 && <NotificationList notifications={[...notifications].sort((left, right) => new Date(right.detectedAt) - new Date(left.detectedAt)).slice(0, 5)} onViewDocument={onViewDocument} />}
          {!error && !loading && notifications.length === 0 && <NotificationList notifications={[]} onViewDocument={onViewDocument} />}
          {pendingMessage && <p className="notification-panel__pending" role="status">{pendingMessage}</p>}
        </div>
        <footer className="notification-panel__footer"><button className="notification-panel__all" onClick={handleViewAll} type="button">Ver todas las notificaciones</button></footer>
      </section>}
    </div>
  )
}
