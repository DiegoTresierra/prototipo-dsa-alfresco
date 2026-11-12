import { useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { loadOrganizationalData, saveOrganizationalData } from '../utils/organizationalStore'

const hierarchyRoles = [
  { id: 'director', label: 'Director' },
  { id: 'jefe_unidad', label: 'Jefe de oficina o unidad' },
  { id: 'especialista', label: 'Especialista' },
]

const createLocalId = () => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/* eslint-disable react/prop-types */
export function HierarchyManagementPage({ office, localScopeId }) {
  const [data, setData] = useState(() => loadOrganizationalData(office.dependencyId, localScopeId))
  const [person, setPerson] = useState({ name: '', position: '', officeId: '', roleId: 'especialista' })
  const [newOfficeName, setNewOfficeName] = useState('')
  const [message, setMessage] = useState('')

  const updateData = (nextData) => {
    setData(nextData)
    saveOrganizationalData(localScopeId, nextData)
  }

  const addOffice = (event) => {
    event.preventDefault()
    const name = newOfficeName.trim()
    if (!name) return
    const nextData = { ...data, offices: [...data.offices, { id: createLocalId(), name, parentOfficeId: null }] }
    updateData(nextData)
    setNewOfficeName('')
    setMessage('Unidad añadida al catálogo local de demostración.')
  }

  const addPerson = (event) => {
    event.preventDefault()
    if (!person.name.trim() || !person.position.trim() || !person.officeId) return
    const nextData = { ...data, people: [{ ...person, id: createLocalId(), name: person.name.trim(), position: person.position.trim(), dependencyId: office.dependencyId }, ...data.people] }
    updateData(nextData)
    setPerson({ name: '', position: '', officeId: '', roleId: 'especialista' })
    setMessage('Persona añadida a los registros locales de demostración.')
  }

  const removePerson = (personId) => {
    updateData({ ...data, people: data.people.filter((entry) => entry.id !== personId) })
    setMessage('Persona retirada de los registros locales de demostración.')
  }

  return (
    <PanelPage description={`Personas y asignaciones de demostración para ${office.office}.`} title="Gestión de jerarquía">
      <p className="hierarchy-demo-note">Los cambios de esta pantalla se guardan localmente y no modifican permisos ni accesos documentales.</p>
      <div className="hierarchy-layout">
        <section className="hierarchy-card" aria-labelledby="hierarchy-add-person-title">
          <h2 id="hierarchy-add-person-title">Agregar persona</h2>
          <form className="hierarchy-form" onSubmit={addPerson}>
            <label className="form-field"><span>Nombre completo</span><input autoComplete="off" onChange={(event) => setPerson({ ...person, name: event.target.value })} required value={person.name} /></label>
            <label className="form-field"><span>Cargo</span><input autoComplete="off" onChange={(event) => setPerson({ ...person, position: event.target.value })} required value={person.position} /></label>
            <label className="form-field"><span>Oficina o unidad</span><select onChange={(event) => setPerson({ ...person, officeId: event.target.value })} required value={person.officeId}><option value="">Seleccionar oficina o unidad</option>{data.offices.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label className="form-field"><span>Rol</span><select onChange={(event) => setPerson({ ...person, roleId: event.target.value })} value={person.roleId}>{hierarchyRoles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
            <button className="button-primary" disabled={data.offices.length === 0} type="submit">Agregar persona</button>
            {data.offices.length === 0 && <p className="hierarchy-form__hint">Agrega primero una oficina o unidad para habilitar la asignación.</p>}
          </form>
        </section>

        <section className="hierarchy-card" aria-labelledby="hierarchy-offices-title">
          <h2 id="hierarchy-offices-title">Oficinas y unidades</h2>
          <p className="hierarchy-card__intro">Estructura disponible para {office.acronym}.</p>
          {data.offices.length === 0 ? <p className="hierarchy-empty">No hay unidades de demostración configuradas para esta dependencia.</p> : <ul className="hierarchy-office-list">{data.offices.map((entry) => <li key={entry.id}><span>{entry.name}</span><small>{data.people.filter((personEntry) => personEntry.officeId === entry.id).length} personas asignadas</small></li>)}</ul>}
          <form className="hierarchy-office-form" onSubmit={addOffice}>
            <label className="form-field"><span>Agregar oficina o unidad local</span><input autoComplete="off" onChange={(event) => setNewOfficeName(event.target.value)} value={newOfficeName} /></label>
            <button className="button-secondary" type="submit">Agregar unidad</button>
          </form>
        </section>
      </div>

      <section className="hierarchy-card hierarchy-people" aria-labelledby="hierarchy-people-title">
        <h2 id="hierarchy-people-title">Personas registradas localmente</h2>
        {data.people.length === 0 ? <p className="hierarchy-empty">Aún no se han agregado personas a esta dependencia.</p> : <div className="table-scroll"><table className="document-table"><thead><tr><th>Nombre</th><th>Cargo</th><th>Oficina o unidad</th><th>Rol</th><th>Acción</th></tr></thead><tbody>{data.people.map((entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.position}</td><td>{data.offices.find((unit) => unit.id === entry.officeId)?.name || '—'}</td><td>{hierarchyRoles.find((role) => role.id === entry.roleId)?.label || entry.roleId}</td><td><button className="hierarchy-remove" onClick={() => removePerson(entry.id)} type="button">Quitar</button></td></tr>)}</tbody></table></div>}
      </section>
      {message && <p aria-live="polite" className="hierarchy-message">{message}</p>}
    </PanelPage>
  )
}
