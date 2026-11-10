/* eslint-disable react/prop-types */
import { Icon } from './Icon'

export function TopBar({ onMenuClick, roleLabel, officeAcronym, officeName, profileName, onLogout }) {
  return (
    <header className="topbar">
      <button aria-label="Abrir menú" className="topbar__menu" onClick={onMenuClick} type="button"><Icon name="menu" /></button>
      <div className="topbar__title">
        <p className="topbar__eyebrow">{officeName}</p>
        <h2>Gestión Documental {officeAcronym}</h2>
      </div>
      <div className="topbar__controls">
        <div className="profile-summary">
          <span>{profileName}</span>
          <small>{roleLabel}</small>
          <button className="button-secondary" onClick={onLogout} type="button">Cerrar sesión</button>
        </div>
      </div>
    </header>
  )
}
