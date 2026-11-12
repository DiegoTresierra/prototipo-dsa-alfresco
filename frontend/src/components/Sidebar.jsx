import { useState } from 'react'
import { Icon } from './Icon'

/* eslint-disable react/prop-types */
export function Sidebar({ activePanel, collapsed, isOpen, items, onNavigate, onClose, onToggleCollapse, office, roleLabel, onLogout }) {
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  return (
    <>
      {isOpen && <button aria-label="Cerrar menú" className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''} ${collapsed ? 'sidebar--collapsed' : ''}`}>
        <div className="sidebar__brand">
          <div className="brand-mark"><Icon name="file" size={22} /></div>
          {!collapsed && <div className="sidebar__brand-copy"><strong>Gestión Documental</strong><span>{office.acronym ? `${office.acronym} · Universidad Andina` : office.office}</span></div>}
          <button aria-label="Cerrar menú" className="sidebar__close" onClick={onClose} type="button"><Icon name="close" /></button>
        </div>

        <div className="sidebar__profile-wrap">
          <button aria-expanded={isProfileOpen} aria-label={collapsed ? `Perfil de ${office.name}` : undefined} className="sidebar__profile" onClick={() => setIsProfileOpen((open) => !open)} title={collapsed ? `${office.name} · ${office.position || roleLabel} · ${office.office}` : undefined} type="button">
            <span className="sidebar__avatar"><Icon name="user" /></span>
            {!collapsed && <span className="sidebar__profile-copy"><strong>{office.name}</strong><span>{office.position || roleLabel}</span><small>{office.office}</small></span>}
            {!collapsed && <Icon name="chevron" size={17} />}
          </button>
          {isProfileOpen && <div className="sidebar__profile-menu">
            <div className="sidebar__profile-details"><strong>{office.name}</strong><span>{office.position || roleLabel}</span><small>{office.office}</small></div>
            <span className="sidebar__role-label">Función verificada: {roleLabel}</span>
            <button className="sidebar__logout" onClick={onLogout} type="button"><Icon name="logout" size={18} />Cerrar sesión</button>
          </div>}
        </div>

        {!collapsed && <div className="sidebar__section-label">Menú principal</div>}
        <nav aria-label="Navegación principal" className="sidebar__nav">
          {items.map((item) => (
            <button aria-current={activePanel === item.id ? 'page' : undefined} className={`nav-item ${activePanel === item.id ? 'nav-item--active' : ''}`} key={item.id} onClick={() => onNavigate(item.id)} title={collapsed ? item.label : undefined} type="button">
              <Icon name={item.icon || 'file'} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          <button aria-label={collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'} className="sidebar__collapse" onClick={onToggleCollapse} type="button"><Icon name="menu" /><span>{collapsed ? 'Expandir menú' : 'Contraer menú'}</span></button>
          {!collapsed && <small>Prototipo · Versión inicial</small>}
        </div>
      </aside>
    </>
  )
}
