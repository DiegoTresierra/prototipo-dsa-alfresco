/* eslint-disable no-unused-vars, react/prop-types */
import { Icon } from './Icon'

const navigationItems = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'recepcion', label: 'Recepción documental', icon: 'inbox' },
  { id: 'revision', label: 'Revisión', icon: 'review' },
  { id: 'archivo', label: 'Archivo', icon: 'archive' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },
]

export function Sidebar({ activePanel, isOpen, items, onNavigate, onClose }) {
  const navigationItems = items || []
  return <>
    {isOpen && <button aria-label="Cerrar menú" className="sidebar-backdrop" onClick={onClose} />}
    <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
      <div className="sidebar__brand"><div className="brand-mark"><Icon name="file" size={22} /></div><div><strong>DSA</strong><span>Gestión Documental</span></div><button aria-label="Cerrar menú" className="sidebar__close" onClick={onClose}><Icon name="close" /></button></div>
      <div className="sidebar__section-label">Paneles</div>
      <nav aria-label="Navegación principal" className="sidebar__nav">{navigationItems.map((item) => <button className={`nav-item ${activePanel === item.id ? 'nav-item--active' : ''}`} key={item.id} onClick={() => onNavigate(item.id)} type="button"><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar__footer">Prototipo · Versión inicial</div>
    </aside>
  </>
}
