/* eslint-disable react/prop-types */
import { Icon } from './Icon'

export function TopBar({ onMenuClick, roleId, roleLabel, onRoleChange, roles, officeAcronym, officeName, profileName }) {
  return (
    <header className="topbar">
      <button aria-label="Abrir menú" className="topbar__menu" onClick={onMenuClick} type="button"><Icon name="menu" /></button>
      <div className="topbar__title">
        <p className="topbar__eyebrow">{officeName}</p>
        <h2>Gestión Documental {officeAcronym}</h2>
      </div>
      <div className="topbar__controls">
        <label className="role-selector">
          <span>Función activa</span>
          <select aria-label="Seleccionar función" onChange={(event) => onRoleChange(event.target.value)} value={roleId}>
            {Object.values(roles).map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
          </select>
          <small>{roleLabel} · {profileName}</small>
        </label>
      </div>
    </header>
  )
}
