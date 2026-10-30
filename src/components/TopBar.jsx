/* eslint-disable react/prop-types */
import { Icon } from './Icon'

export function TopBar({ onMenuClick, roleId, roleLabel, onRoleChange, roles }) {
  return <header className="topbar"><button aria-label="Abrir menú" className="topbar__menu" onClick={onMenuClick} type="button"><Icon name="menu" /></button><div className="topbar__title"><p className="topbar__eyebrow">Plataforma institucional</p><h2>Gestión Documental DSA</h2></div><label className="role-selector"><span>Rol activo</span><select aria-label="Seleccionar rol" value={roleId} onChange={(event) => onRoleChange(event.target.value)}>{Object.values(roles).map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select><small>{roleLabel}</small></label></header>
}
