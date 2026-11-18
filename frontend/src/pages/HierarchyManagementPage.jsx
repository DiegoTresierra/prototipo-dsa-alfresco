import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { PanelPage } from '../components/PanelPage'
import { getHierarchy, saveHierarchy } from '../api/alfresco'

const moduleViews = { home: 'home', office: 'office', timings: 'timings' }
const lanes = [
  { id: 'direccion', role: 'direccion', title: 'Dirección', description: 'Dirección de la dependencia' },
  { id: 'jefes', role: 'jefe-unidad', title: 'Jefes de unidad', description: 'Responsables de oficina o unidad' },
  { id: 'especialistas', role: 'especialista', title: 'Especialistas', description: 'Responsables de atención documental' },
]
const timingLevels = [
  { id: 'director', title: 'Dirección', description: 'Tiempo para distribuir el documento' },
  { id: 'unit-head', title: 'Jefatura de unidad', description: 'Tiempo para asignar al especialista' },
  { id: 'specialist', title: 'Especialista', description: 'Tiempo para iniciar la atención' },
]
const emptyMembers = { direccion: null, jefes: [], especialistas: [] }

/* eslint-disable react/prop-types */
function SettingsHome({ officeName, onOpen }) {
  return (
    <div className="settings-entry-grid">
      <button className="settings-entry-card" onClick={() => onOpen(moduleViews.office)} type="button">
        <span className="settings-entry-card__icon"><Icon name="users" size={23} /></span>
        <span className="settings-entry-card__copy">
          <strong>Administrar mi oficina</strong>
          <span>Organiza la Dirección, las jefaturas de unidad y los especialistas de {officeName}.</span>
        </span>
        <span aria-hidden="true" className="settings-entry-card__arrow">›</span>
      </button>
      <button className="settings-entry-card" onClick={() => onOpen(moduleViews.timings)} type="button">
        <span className="settings-entry-card__icon"><Icon name="chart" size={23} /></span>
        <span className="settings-entry-card__copy">
          <strong>Tiempos de entrega dentro de la oficina</strong>
          <span>Consulta los plazos de distribución y asignación de documentos en la oficina.</span>
        </span>
        <span aria-hidden="true" className="settings-entry-card__arrow">›</span>
      </button>
    </div>
  )
}

function OfficeHierarchy({ officeName, dependency, members, specialistUnits, recipients, staleCount, loading, loadingError, saving, onRefresh, onAddMembers, onRemoveMember, onAssignSpecialist, onBack }) {
  const [addOpen, setAddOpen] = useState(false)
  const [laneId, setLaneId] = useState('jefes')
  const [unitHeadUserId, setUnitHeadUserId] = useState('')
  const [unitDrafts, setUnitDrafts] = useState({})
  const [selectedIds, setSelectedIds] = useState([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!addOpen) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') setAddOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addOpen])

  const selectedLane = lanes.find((lane) => lane.id === laneId) || lanes[1]
  const assignedIds = useMemo(() => new Set([...members.jefes, ...members.especialistas]), [members.jefes, members.especialistas])
  const unitHeads = members.jefes.map((id) => recipients.find((recipient) => recipient.id === id)).filter(Boolean)
  const unassignedSpecialists = members.especialistas.filter((id) => !specialistUnits[id] || !members.jefes.includes(specialistUnits[id]))
  const availableMembers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es')
    return recipients.filter((recipient) => recipient.functionalRole === selectedLane.role &&
      String(recipient.dependency || '').toLowerCase() === String(dependency || '').toLowerCase() &&
      !assignedIds.has(recipient.id) &&
      (!query || `${recipient.displayName} ${recipient.id}`.toLocaleLowerCase('es').includes(query)))
  }, [assignedIds, dependency, recipients, search, selectedLane])

  const openAdd = () => {
    setLaneId('jefes')
    setUnitHeadUserId('')
    setSelectedIds([])
    setSearch('')
    setAddOpen(true)
  }
  const addSelected = async () => {
    if (!selectedIds.length) return
    const saved = await onAddMembers(laneId, selectedIds, laneId === 'especialistas' ? unitHeadUserId : '')
    if (saved) {
      setSelectedIds([])
      setAddOpen(false)
    }
  }

  return (
    <div className="settings-detail">
      <button className="button-secondary settings-back" onClick={onBack} type="button"><span aria-hidden="true">‹</span> Volver a Ajustes</button>
      <div className="settings-detail__toolbar">
        <div><h2>Administrar mi oficina</h2><p>Organiza la estructura de {officeName} con usuarios disponibles en los grupos de Alfresco.</p></div>
        <div className="settings-detail__actions">
          <button className="button-secondary" disabled={loading || saving} onClick={onRefresh} type="button">Actualizar usuarios</button>
          <button className="button-primary" disabled={loading || Boolean(loadingError) || saving} onClick={openAdd} type="button">Añadir miembros</button>
        </div>
      </div>
      {loading && <p className="hierarchy-message" role="status">Consultando usuarios y estructura de la oficina…</p>}
      {loadingError && <p className="form-message form-message--error" role="alert">{loadingError}</p>}
      {staleCount > 0 && !loadingError && <p className="settings-stale-note" role="status">Hay {staleCount} asignación(es) cuyo usuario ya no aparece en los grupos actuales de la oficina. Revisa la membresía en Alfresco.</p>}
      <div aria-label={`Jerarquía de ${officeName}`} className="settings-lanes">
        {lanes.map((lane) => {
          const laneMembers = lane.id === 'direccion'
            ? members.direccion ? [members.direccion] : []
            : (members[lane.id] || []).map((id) => recipients.find((recipient) => recipient.id === id)).filter(Boolean)
          return (
            <section className="settings-lane" key={lane.id}>
              <header className="settings-lane__header"><div><h3>{lane.title}</h3><p>{lane.description}</p></div><span className="settings-lane__count">{laneMembers.length}</span></header>
              {laneMembers.length ? <ul className="settings-lane__members">
                {laneMembers.map((member) => <li key={member.id}>
                  <span aria-hidden="true" className="settings-lane__avatar"><Icon name="user" size={17} /></span>
                  <span className="settings-lane__identity"><strong>{member.displayName}</strong><small>{member.id}</small></span>
                  {lane.id !== 'direccion' && <button aria-label={`Quitar a ${member.displayName} de ${lane.title}`} className="hierarchy-remove" disabled={saving || loading} onClick={() => onRemoveMember(lane.id, member.id)} type="button">Quitar</button>}
                  {lane.id === 'direccion' && <small className="settings-lane__current">Sesión actual</small>}
                </li>)}
              </ul> : <p className="hierarchy-empty">{lane.id === 'direccion' ? 'No se pudo identificar la sesión de Dirección.' : 'Aún no hay miembros asignados a este nivel.'}</p>}
            </section>
          )
        })}
      </div>
      <section aria-labelledby="office-chart-title" className="office-chart-section">
        <div className="office-chart-section__heading"><div><h2 id="office-chart-title">Organigrama de la oficina</h2><p>Los especialistas se muestran debajo de la jefatura/unidad seleccionada al añadirlos.</p></div></div>
        <div className="office-chart">
          <div className="office-chart__director"><span className="settings-lane__avatar"><Icon name="user" size={18} /></span><span><strong>{members.direccion?.displayName || 'Dirección'}</strong><small>Dirección</small></span></div>
          {unitHeads.length ? <div className="office-chart__units" data-unit-count={unitHeads.length} style={{ '--office-unit-count': unitHeads.length }}>
            {unitHeads.map((head) => {
              const linkedSpecialists = members.especialistas
                .filter((id) => specialistUnits[id] === head.id)
                .map((id) => recipients.find((recipient) => recipient.id === id))
                .filter(Boolean)
              const unitLabel = head.unit?.name || head.unit?.code || `Unidad a cargo de ${head.displayName}`
              return <article className="office-chart__unit" key={head.id}>
                <div className="office-chart__head"><span className="settings-lane__avatar"><Icon name="user" size={18} /></span><span><small>{unitLabel}</small><strong>{head.displayName}</strong><small>Jefatura de unidad</small></span></div>
                <div className="office-chart__specialists">
                  {linkedSpecialists.length ? linkedSpecialists.map((specialist) => <div className="office-chart__specialist" key={specialist.id}><span className="settings-lane__avatar"><Icon name="user" size={16} /></span><span><strong>{specialist.displayName}</strong><small>Especialista</small></span></div>) : <p className="office-chart__empty">Sin especialistas asociados</p>}
                </div>
              </article>
            })}
          </div> : <p className="hierarchy-empty">Añade una jefatura para iniciar el organigrama de unidades.</p>}
          {unassignedSpecialists.length > 0 && <div className="office-chart__unassigned"><strong>Especialistas sin unidad asociada</strong><div className="office-chart__unassigned-list">{unassignedSpecialists.map((id) => <div className="office-chart__unassigned-row" key={id}><span>{recipients.find((recipient) => recipient.id === id)?.displayName || id}</span><select aria-label={`Unidad para ${recipients.find((recipient) => recipient.id === id)?.displayName || id}`} disabled={saving || loading || unitHeads.length === 0} onChange={(event) => setUnitDrafts((current) => ({ ...current, [id]: event.target.value }))} value={unitDrafts[id] ?? specialistUnits[id] ?? ''}><option value="">Selecciona unidad/jefatura</option>{unitHeads.map((head) => <option key={head.id} value={head.id}>{head.unit?.name || head.unit?.code || `Unidad a cargo de ${head.displayName}`} · {head.displayName}</option>)}</select><button className="button-secondary" disabled={saving || loading || !unitDrafts[id] || !unitHeads.some((head) => head.id === unitDrafts[id])} onClick={() => onAssignSpecialist(id, unitDrafts[id])} type="button">Asociar</button></div>)}</div></div>}
        </div>
      </section>
      {saving && <p className="hierarchy-message" role="status">Guardando organización de la oficina…</p>}
      <p className="hierarchy-notice">Organigrama provisional guardado en el BFF. No acredita subordinación institucional ni habilita despachos de Jefatura a Especialista. Esta pantalla no modifica usuarios, grupos ni permisos de Alfresco.</p>
      {addOpen && <div className="settings-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false) }}>
        <section aria-labelledby="settings-add-title" aria-modal="true" className="settings-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
          <header className="settings-modal__header"><div><h2 id="settings-add-title">Añadir miembros</h2><p>Elige usuarios activos de los grupos funcionales de {officeName}.</p></div><button aria-label="Cerrar" className="settings-modal__close" onClick={() => setAddOpen(false)} type="button">×</button></header>
          <label className="form-field"><span>Nivel de la jerarquía</span><select onChange={(event) => { setLaneId(event.target.value); setSelectedIds([]); if (event.target.value === 'especialistas') setUnitHeadUserId(unitHeads[0]?.id || '') }} value={laneId}><option value="jefes">Jefes de unidad</option><option value="especialistas">Especialistas</option></select></label>
          {laneId === 'especialistas' && <label className="form-field"><span>Unidad o jefatura donde trabajará</span><select onChange={(event) => setUnitHeadUserId(event.target.value)} value={unitHeadUserId}><option value="">Selecciona una unidad/jefatura</option>{unitHeads.map((head) => <option key={head.id} value={head.id}>{head.unit?.name || head.unit?.code || `Unidad a cargo de ${head.displayName}`} · {head.displayName}</option>)}</select><small>La unidad se vincula a una jefatura que ya está en el organigrama.</small></label>}
          <label className="form-field settings-modal__search"><span>Buscar usuario</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o cuenta" type="search" value={search} /></label>
          <div aria-live="polite" className="settings-modal__results">
            {availableMembers.length === 0
              ? <p className="hierarchy-empty">{laneId === 'especialistas' && !unitHeads.length ? 'Primero añade al menos una jefatura para asociar la unidad.' : 'No hay usuarios disponibles para este nivel en la dependencia actual.'}</p>
              : availableMembers.map((member) => <label className="settings-member-option" key={member.id}><input checked={selectedIds.includes(member.id)} onChange={() => setSelectedIds((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])} type="checkbox" /><span><strong>{member.displayName}</strong><small>{member.id}</small></span></label>)}
          </div>
          <footer className="settings-modal__footer"><button className="button-secondary" onClick={() => setAddOpen(false)} type="button">Cancelar</button><button className="button-primary" disabled={!selectedIds.length || saving || (laneId === 'especialistas' && (!unitHeadUserId || !unitHeads.some((head) => head.id === unitHeadUserId)))} onClick={addSelected} type="button">Añadir seleccionados</button></footer>
        </section>
      </div>}
    </div>
  )
}

function OfficeTimings({ onBack }) {
  return (
    <div className="settings-detail">
      <button className="button-secondary settings-back" onClick={onBack} type="button"><span aria-hidden="true">‹</span> Volver a Ajustes</button>
      <section className="hierarchy-card">
        <h2>Tiempos de entrega dentro de la oficina</h2>
        <p className="hierarchy-card__intro">Los plazos se habilitarán cuando se definan los valores institucionales para cada nivel.</p>
        <div className="settings-timing-list">
          {timingLevels.map((level) => <div className="settings-timing-row" key={level.id}><div><strong>{level.title}</strong><span>{level.description}</span></div><input aria-label={`Plazo para ${level.title}`} disabled placeholder="Sin configurar" type="text" /></div>)}
        </div>
        <p className="hierarchy-notice">No hay plazos guardados y estos campos no están habilitados.</p>
      </section>
    </div>
  )
}

export function HierarchyManagementPage({ office, csrfToken }) {
  const [view, setView] = useState(moduleViews.home)
  const [members, setMembers] = useState(emptyMembers)
  const [specialistUnits, setSpecialistUnits] = useState({})
  const [recipients, setRecipients] = useState([])
  const [staleCount, setStaleCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingError, setLoadingError] = useState('')
  const [saving, setSaving] = useState(false)
  const officeName = office?.office || office?.acronym || 'la oficina actual'

  const loadOffice = async (activeCheck = () => true) => {
    setLoading(true)
    setLoadingError('')
    try {
      const result = await getHierarchy()
      if (!activeCheck()) return
      const candidates = Array.isArray(result.recipients) ? result.recipients : []
      const candidateIds = new Set(candidates.map((member) => member.id))
      const saved = Array.isArray(result.assignments) ? result.assignments : []
      setRecipients(candidates)
      setStaleCount(saved.filter((assignment) => !candidateIds.has(assignment.userId)).length)
      setMembers({
        direccion: result.director || null,
        jefes: saved.filter((assignment) => assignment.laneId === 'jefes' && candidateIds.has(assignment.userId)).map((assignment) => assignment.userId),
        especialistas: saved.filter((assignment) => assignment.laneId === 'especialistas' && candidateIds.has(assignment.userId)).map((assignment) => assignment.userId),
      })
      setSpecialistUnits(Object.fromEntries(saved
        .filter((assignment) => assignment.laneId === 'especialistas' && candidateIds.has(assignment.userId) && assignment.unitHeadUserId)
        .map((assignment) => [assignment.userId, assignment.unitHeadUserId])))
    } catch (error) {
      if (activeCheck()) setLoadingError(error.message || 'No se pudo consultar la oficina.')
    } finally {
      if (activeCheck()) setLoading(false)
    }
  }

  useEffect(() => {
    if (view !== moduleViews.office) return undefined
    let active = true
    const refresh = () => { if (document.visibilityState === 'visible') loadOffice(() => active) }
    loadOffice(() => active)
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [view, office?.dependencyId])

  const persistMembers = async (nextMembers, nextSpecialistUnits = specialistUnits) => {
    const previous = members
    const previousSpecialistUnits = specialistUnits
    const assignments = [
      ...nextMembers.jefes.map((userId) => ({ laneId: 'jefes', userId })),
      ...nextMembers.especialistas.map((userId) => ({ laneId: 'especialistas', userId, ...(nextSpecialistUnits[userId] ? { unitHeadUserId: nextSpecialistUnits[userId] } : {}) })),
    ]
    setMembers(nextMembers)
    setSpecialistUnits(nextSpecialistUnits)
    setSaving(true)
    setLoadingError('')
    try {
      const result = await saveHierarchy(assignments, csrfToken)
      const saved = Array.isArray(result.assignments) ? result.assignments : assignments
      setMembers({
        ...nextMembers,
        jefes: saved.filter((assignment) => assignment.laneId === 'jefes').map((assignment) => assignment.userId),
        especialistas: saved.filter((assignment) => assignment.laneId === 'especialistas').map((assignment) => assignment.userId),
      })
      setSpecialistUnits(Object.fromEntries(saved
        .filter((assignment) => assignment.laneId === 'especialistas' && assignment.unitHeadUserId)
        .map((assignment) => [assignment.userId, assignment.unitHeadUserId])))
      return true
    } catch (error) {
      setMembers(previous)
      setSpecialistUnits(previousSpecialistUnits)
      setLoadingError(error.message || 'No se pudo guardar la organización de la oficina.')
      return false
    } finally {
      setSaving(false)
    }
  }

  if (view === moduleViews.office) {
    return <PanelPage description={`Organiza la jerarquía documental de ${officeName}.`} title="Administrar mi oficina">
      <OfficeHierarchy officeName={officeName} dependency={office?.dependencyId} members={members} specialistUnits={specialistUnits} recipients={recipients} staleCount={staleCount} loading={loading} loadingError={loadingError} saving={saving} onRefresh={() => loadOffice()} onAddMembers={(laneId, ids, unitHeadUserId) => {
        const nextMembers = { ...members, [laneId]: [...new Set([...members[laneId], ...ids])] }
        const nextSpecialistUnits = laneId === 'especialistas'
          ? { ...specialistUnits, ...Object.fromEntries(ids.map((id) => [id, unitHeadUserId])) }
          : specialistUnits
        return persistMembers(nextMembers, nextSpecialistUnits)
      }} onRemoveMember={(laneId, id) => {
        const nextMembers = { ...members, [laneId]: members[laneId].filter((memberId) => memberId !== id) }
        const nextSpecialistUnits = { ...specialistUnits }
        if (laneId === 'especialistas') delete nextSpecialistUnits[id]
        if (laneId === 'jefes') {
          for (const [specialistId, headId] of Object.entries(nextSpecialistUnits)) if (headId === id) delete nextSpecialistUnits[specialistId]
        }
        return persistMembers(nextMembers, nextSpecialistUnits)
      }} onAssignSpecialist={(specialistId, unitHeadUserId) => persistMembers(members, { ...specialistUnits, [specialistId]: unitHeadUserId })} onBack={() => setView(moduleViews.home)} />
    </PanelPage>
  }

  if (view === moduleViews.timings) {
    return <PanelPage description="Plazos de entrega y asignación dentro de la oficina." title="Tiempos de entrega dentro de la oficina"><OfficeTimings onBack={() => setView(moduleViews.home)} /></PanelPage>
  }

  return <PanelPage description={`Opciones de organización para ${officeName}.`} title="Ajustes"><SettingsHome officeName={officeName} onOpen={setView} /></PanelPage>
}
