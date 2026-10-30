/* eslint-disable react/prop-types */
import { Icon } from './Icon'

export function Sidebar({ activePanel, isOpen, items, onNavigate, onClose, officeAcronym = 'DSA' }) {
  return (
    <>
      {isOpen && <button aria-label="Cerrar menú" className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <div className="brand-mark"><Icon name="file" size={22} /></div>
          <div><strong>{officeAcronym}</strong><span>Gestión Documental</span></div>
          <button aria-label="Cerrar menú" className="sidebar__close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="sidebar__section-label">Paneles</div>
        <nav aria-label="Navegación principal" className="sidebar__nav">
          {items.map((item) => (
            <button className={`nav-item ${activePanel === item.id ? 'nav-item--active' : ''}`} key={item.id} onClick={() => onNavigate(item.id)} type="button">
              <Icon name={item.icon || 'file'} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">Prototipo · Versión inicial</div>
      </aside>
    </>
  )
}
