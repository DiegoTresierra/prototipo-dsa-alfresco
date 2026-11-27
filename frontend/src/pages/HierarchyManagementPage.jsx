import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { PanelPage } from '../components/PanelPage'
import { assignHierarchyHead as postHierarchyHead, assignHierarchySpecialist as postHierarchySpecialist, changeHierarchyHead as postHierarchyHeadChange, createHierarchyUnit as postHierarchyUnit, editHierarchyUnit as patchHierarchyUnit, getHierarchy, getHierarchyAudit, getResponseTimes, reassignHierarchySpecialist as postHierarchySpecialistReassignment, updateResponseTimes } from '../api/alfresco'
import { createHierarchyManagementModel, listAvailableHierarchyCandidates } from '../utils/hierarchyManagementModel'

const moduleViews = { home: 'home', office: 'office', members: 'members', timings: 'timings' }
const lanes = [
  { id: 'direccion', role: 'direccion', title: 'Dirección', description: 'Dirección de la dependencia' },
  { id: 'jefes', role: 'jefe-unidad', title: 'Jefes de unidad', description: 'Responsables de oficina o unidad' },
  { id: 'especialistas', role: 'especialista', title: 'Especialistas', description: 'Responsables de atención documental' },
]
const timingPriorities = [
  { id: 'NORMAL', className: 'normal', title: 'Normal' },
  { id: 'ALTA', className: 'high', title: 'Alta' },
  { id: 'URGENTE', className: 'urgent', title: 'Urgente' },
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
      <button className="settings-entry-card" onClick={() => onOpen(moduleViews.members)} type="button">
        <span className="settings-entry-card__icon"><Icon name="users" size={23} /></span>
        <span className="settings-entry-card__copy">
          <strong>Miembros asignados</strong>
          <span>Consulta las personas vinculadas a los roles de la dependencia.</span>
        </span>
        <span aria-hidden="true" className="settings-entry-card__arrow">›</span>
      </button>
      <button className="settings-entry-card" onClick={() => onOpen(moduleViews.timings)} type="button">
        <span className="settings-entry-card__icon"><Icon name="chart" size={23} /></span>
        <span className="settings-entry-card__copy">
          <strong>Tiempos de respuesta</strong>
          <span>Configura los plazos de respuesta de documentos según su prioridad.</span>
        </span>
        <span aria-hidden="true" className="settings-entry-card__arrow">›</span>
      </button>
    </div>
  )
}

function AssignedMembersDirectory({ officeName, members, recipients, loading, loadingError, onRefresh, onBack }) {
  const groups = [
    { id: 'direccion', title: 'Dirección', people: members.direccion ? [members.direccion] : [] },
    { id: 'jefes', title: 'Jefes de unidad', people: members.jefes.map(id => recipients.find(person => person.id === id) || { id, displayName: id }) },
    { id: 'especialistas', title: 'Especialistas', people: members.especialistas.map(id => recipients.find(person => person.id === id) || { id, displayName: id }) },
  ]
  return <div className="settings-detail">
    <button className="button-secondary settings-back" onClick={onBack} type="button">‹ Volver a Ajustes</button>
    <div className="settings-detail__toolbar"><div><h2>Miembros asignados</h2><p>Consulta los roles vigentes de {officeName} en la jerarquía institucional.</p></div><div className="settings-detail__actions"><button className="button-secondary" disabled={loading} onClick={onRefresh} type="button">Actualizar datos</button></div></div>
    <p className="hierarchy-notice">Vista de consulta. Las asignaciones se administran por unidad en «Administrar mi oficina»; esta pantalla no cambia usuarios ni grupos de Alfresco.</p>
    {loading && <p className="hierarchy-message" role="status">Consultando miembros desde Alfresco…</p>}
    {loadingError && <p className="form-message form-message--error" role="alert">{loadingError}</p>}
    <div className="settings-lanes" aria-label={`Miembros asignados de ${officeName}`}>
      {groups.map(group => <section className="settings-lane" key={group.id}><header className="settings-lane__header"><div><h3>{group.title}</h3></div><span className="settings-lane__count">{group.people.length}</span></header>
        {group.people.length ? <ul className="settings-lane__members">{group.people.map(person => <li key={person.id}><span aria-hidden="true" className="settings-lane__avatar"><Icon name="user" size={17} /></span><span className="settings-lane__identity"><strong>{person.displayName || person.id}</strong><small>{person.id}</small></span></li>)}</ul> : <p className="hierarchy-empty">No hay personas asignadas en este nivel.</p>}
      </section>)}
    </div>
  </div>
}

function AuditChangeDetails({ beforeData, afterData }) {
  const labels = {
    name: 'Nombre', code: 'Código', description: 'Descripción', status: 'Estado', role: 'Rol',
    userId: 'Usuario responsable', previousHeadUserId: 'Jefe anterior', newHeadUserId: 'Nuevo Jefe',
    currentHeadUserId: 'Jefe vigente', replacementUserId: 'Usuario reemplazante',
  }
  const display = (data) => {
    const rows = Object.entries(data || {}).filter(([key, value]) => labels[key] && value !== undefined && value !== null && value !== '')
    return rows.length ? <dl className="hierarchy-audit__changes">{rows.map(([key, value]) => <div key={key}><dt>{labels[key]}</dt><dd>{String(value)}</dd></div>)}</dl> : <p>Sin datos registrados.</p>
  }
  return <div className="hierarchy-audit__details-grid"><section><h4>Antes</h4>{display(beforeData)}</section><section><h4>Después</h4>{display(afterData)}</section></div>
}

function AlfrescoReadOnlyHierarchy({ officeName, dependency, units, members, assignments, recipients, staleCount, revision, pendingHeadChanges, pendingSpecialistReassignments, loading, loadingError, unitCreationEnabled, unitEditEnabled, headAssignmentEnabled, headChangeEnabled, specialistAssignmentEnabled, specialistReassignmentEnabled, creationPending, pendingUnitOperation, creationMessage, creationError, onCreateUnit, onEditUnit, onAssignHead, onChangeHead, onAssignSpecialist, onReassignSpecialist, onRefresh, onBack }) {
  const [unitDraft, setUnitDraft] = useState({ name: '', code: '', description: '' })
  const [headDrafts, setHeadDrafts] = useState({})
  const [specialistDrafts, setSpecialistDrafts] = useState({})
  const [newSpecialistDrafts, setNewSpecialistDrafts] = useState({})
  const [pendingHeadOperations, setPendingHeadOperations] = useState({})
  const [pendingHeadChangeOperations, setPendingHeadChangeOperations] = useState({})
  const [editingUnitId, setEditingUnitId] = useState('')
  const [unitEditDraft, setUnitEditDraft] = useState({ name: '', code: '', description: '' })
  const [pendingUnitEdits, setPendingUnitEdits] = useState({})
  const [unitEditSaving, setUnitEditSaving] = useState(false)
  const [unitEditMessage, setUnitEditMessage] = useState({})
  const [auditPage, setAuditPage] = useState(1)
  const [auditFilters, setAuditFilters] = useState({ operationType: '', phase: '', from: '', to: '' })
  const [auditDraft, setAuditDraft] = useState({ operationType: '', phase: '', from: '', to: '' })
  const [auditResult, setAuditResult] = useState({ events: [], pagination: { page: 1, totalPages: 0, totalItems: 0 } })
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [auditSelected, setAuditSelected] = useState('')

  useEffect(() => {
    let active = true
    setAuditLoading(true)
    setAuditError('')
    getHierarchyAudit({ ...auditFilters, page: auditPage, pageSize: 25 })
      .then((result) => { if (active) { setAuditResult(result); setAuditSelected('') } })
      .catch((error) => { if (active) setAuditError(error.message || 'No se pudo consultar el historial.') })
      .finally(() => { if (active) setAuditLoading(false) })
    return () => { active = false }
  }, [auditFilters, auditPage, revision])
  const [pendingSpecialistOperations, setPendingSpecialistOperations] = useState({})
  const [pendingSpecialistReassignmentOperations, setPendingSpecialistReassignmentOperations] = useState({})
  const [headSavingUnitId, setHeadSavingUnitId] = useState('')
  const [specialistSavingUnitId, setSpecialistSavingUnitId] = useState('')
  const [headMessages, setHeadMessages] = useState({})
  const [headChangeMessages, setHeadChangeMessages] = useState({})
  const [specialistMessages, setSpecialistMessages] = useState({})
  const [specialistReassignmentMessages, setSpecialistReassignmentMessages] = useState({})
  const recipientsById = useMemo(() => new Map(recipients.map((recipient) => [recipient.id, recipient])), [recipients])
  const getPerson = (userId) => recipientsById.get(userId) || { id: userId, displayName: userId }
  const heads = recipients.filter((recipient) => recipient.functionalRole === 'jefe-unidad')
  const specialists = recipients.filter((recipient) => recipient.functionalRole === 'especialista')
  const assignedSpecialists = new Set(assignments.filter((assignment) => assignment.laneId === 'especialistas').map((assignment) => assignment.userId))

  useEffect(() => {
    setPendingHeadChangeOperations(Object.fromEntries((pendingHeadChanges || []).filter((operation) => operation.unitId && operation.operationId && operation.newHeadUserId)
      .map((operation) => [operation.unitId, { operationId: operation.operationId, userId: operation.newHeadUserId }])))
  }, [pendingHeadChanges])
  useEffect(() => {
    setPendingSpecialistReassignmentOperations(Object.fromEntries((pendingSpecialistReassignments || [])
      .filter((operation) => operation.userId && operation.operationId && operation.destinationUnitId)
      .map((operation) => [operation.userId, { operationId: operation.operationId, destinationUnitId: operation.destinationUnitId, sourceUnitId: operation.sourceUnitId }])))
  }, [pendingSpecialistReassignments])
  const createUnit = async (event) => {
    event?.preventDefault()
    if (await onCreateUnit(unitDraft)) setUnitDraft({ name: '', code: '', description: '' })
  }

  const startUnitEdit = (unit) => {
    const pending = pendingUnitEdits[unit.id]
    setEditingUnitId(unit.id)
    setUnitEditDraft(pending || { name: unit.name || '', code: unit.code || '', description: unit.description || '' })
    setUnitEditMessage({})
  }

  const saveUnitEdit = async (event, unit) => {
    event.preventDefault()
    if (!unitEditEnabled || unitEditSaving) return
    const payload = { name: unitEditDraft.name.trim(), code: unitEditDraft.code.trim(), description: unitEditDraft.description.trim() }
    if (!payload.name) return setUnitEditMessage({ unitId: unit.id, error: 'El nombre de la unidad es obligatorio.' })
    if (payload.name.length > 240 || payload.code.length > 80 || payload.description.length > 1000) return setUnitEditMessage({ unitId: unit.id, error: 'Revisa las longitudes: nombre 240, código 80 y descripción 1000 caracteres como máximo.' })
    const pending = pendingUnitEdits[unit.id]
    if (pending && ['name', 'code', 'description'].some((key) => pending[key] !== payload[key])) {
      return setUnitEditMessage({ unitId: unit.id, error: `Hay una operación pendiente ${pending.operationId}. Reintenta con los mismos datos para reconciliarla.` })
    }
    const operationId = pending?.operationId || globalThis.crypto?.randomUUID?.()
    if (!operationId) return setUnitEditMessage({ unitId: unit.id, error: 'No se pudo generar un identificador seguro de operación.' })
    const operation = { ...payload, operationId, expectedRevision: pending?.expectedRevision || revision }
    setPendingUnitEdits((current) => ({ ...current, [unit.id]: operation }))
    setUnitEditSaving(true)
    setUnitEditMessage({})
    try {
      const result = await onEditUnit({ unitId: unit.id, ...operation })
      setPendingUnitEdits((current) => { const next = { ...current }; delete next[unit.id]; return next })
      setUnitEditMessage({ unitId: unit.id, success: result.status === 'SIN_CAMBIOS' ? 'No se detectaron cambios en los datos.' : `Unidad actualizada y verificada. Operación ${result.operationId}.${result.refreshError ? ` ${result.refreshError}` : ''}` })
      setEditingUnitId('')
    } catch (error) {
      const retryable = error.operationStatus === 'PARCIAL' || error.uncertain === true || !error.status || error.status >= 500
      if (!retryable) setPendingUnitEdits((current) => { const next = { ...current }; delete next[unit.id]; return next })
      setUnitEditMessage({ unitId: unit.id, error: retryable
        ? `${error.message || 'El resultado de la edición es parcial o incierto.'} Conserva la operación ${error.operationId || operationId} y reintenta con los mismos datos.`
        : `${error.message || 'No se pudo actualizar la unidad.'}${error.code === 'HIERARCHY_REVISION_CONFLICT' ? ' Actualiza la oficina y revisa los datos antes de intentar de nuevo.' : ''}` })
    } finally {
      setUnitEditSaving(false)
    }
  }

  const removePendingHeadOperation = (unitId) => setPendingHeadOperations((current) => {
    const next = { ...current }
    delete next[unitId]
    return next
  })

  const assignHead = async (unitId) => {
    const userId = pendingHeadOperations[unitId]?.userId || headDrafts[unitId] || ''
    const pending = pendingHeadOperations[unitId]
    if (!userId || (headForUnit(unitId) && !pending) || headSavingUnitId) return
    const operationId = pending?.operationId || globalThis.crypto?.randomUUID?.()
    if (!operationId) {
      setHeadMessages((current) => ({ ...current, [unitId]: { error: 'No se pudo generar un identificador seguro de operación.' } }))
      return
    }
    setHeadSavingUnitId(unitId)
    setHeadMessages((current) => ({ ...current, [unitId]: null }))
    if (!pending) setPendingHeadOperations((current) => ({ ...current, [unitId]: { operationId, userId } }))
    try {
      const result = await onAssignHead({ unitId, userId, operationId })
      removePendingHeadOperation(unitId)
      setHeadMessages((current) => ({
        ...current,
        [unitId]: { success: `Jefe asignado: ${result.assignment.userId}. UUID de asignación ${result.assignment.id}. Operación ${result.operationId}.` },
      }))
    } catch (error) {
      const knownConflict = ['HIERARCHY_ACTIVE_UNIT_HEAD_EXISTS', 'HIERARCHY_OPERATION_DUPLICATE_CONFLICT'].includes(error.code)
      const retryable = !knownConflict && (error.operationStatus === 'PARCIAL' || !error.status || error.status >= 500)
      if (retryable) setPendingHeadOperations((current) => ({ ...current, [unitId]: { operationId: error.operationId || operationId, userId } }))
      else removePendingHeadOperation(unitId)
      const operation = error.operationId || operationId
      setHeadMessages((current) => ({
        ...current,
        [unitId]: { error: knownConflict
          ? `${error.message} No se ha cambiado el Jefe existente. Operación ${operation}.`
          : retryable
            ? `${error.message} Estado parcial o incierto; operación ${operation}${error.assignmentId ? ` · asignación ${error.assignmentId}` : ''}. Reintenta con el mismo usuario sin recargar la pantalla.`
            : `${error.message || 'No se pudo asignar el Jefe.'} Operación ${operation}.` },
      }))
    } finally {
      setHeadSavingUnitId('')
    }
  }

  const changeHead = async (unitId) => {
    const currentHead = headForUnit(unitId)
    const pending = pendingHeadChangeOperations[unitId]
    const newHeadUserId = pending?.userId || headDrafts[unitId] || ''
    if ((!currentHead && !pending) || !newHeadUserId || (!pending && newHeadUserId === currentHead.userId) || headSavingUnitId) return
    if (!pending && !globalThis.confirm(`¿Cambiar el Jefe de ${unitLabel(unitId)} de ${getPerson(currentHead.userId).displayName} a ${getPerson(newHeadUserId).displayName}? Los Especialistas permanecerán asociados a la misma unidad.`)) return
    const operationId = pending?.operationId || globalThis.crypto?.randomUUID?.()
    if (!operationId) {
      setHeadChangeMessages((current) => ({ ...current, [unitId]: { error: 'No se pudo generar un identificador seguro de operación.' } }))
      return
    }
    setHeadSavingUnitId(unitId)
    setHeadChangeMessages((current) => ({ ...current, [unitId]: null }))
    if (!pending) setPendingHeadChangeOperations((current) => ({ ...current, [unitId]: { operationId, userId: newHeadUserId } }))
    try {
      const result = await onChangeHead({ unitId, newHeadUserId, operationId, expectedRevision: revision })
      setPendingHeadChangeOperations((current) => { const next = { ...current }; delete next[unitId]; return next })
      setHeadDrafts((current) => ({ ...current, [unitId]: result.newHeadUserId }))
      setHeadChangeMessages((current) => ({ ...current, [unitId]: { success: `Jefe cambiado: ${result.previousHeadUserId} → ${result.newHeadUserId}. Operación ${result.operationId}. Los Especialistas de la unidad se conservaron.` } }))
    } catch (error) {
      const definiteConflict = [
        'HIERARCHY_HEAD_UNCHANGED', 'HIERARCHY_HEAD_ALREADY_ASSIGNED_TO_OTHER_UNIT', 'HIERARCHY_ACTIVE_UNIT_HEAD_CONFLICT',
        'HIERARCHY_USER_HAS_INCOMPATIBLE_ACTIVE_ASSIGNMENT',
        'HIERARCHY_REVISION_CONFLICT', 'HIERARCHY_USER_DISABLED', 'HIERARCHY_USER_NOT_FOUND', 'HIERARCHY_USER_DEPENDENCY_MISMATCH',
        'HIERARCHY_USER_FUNCTION_MISMATCH', 'HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS', 'HIERARCHY_DIRECTORY_VALIDATION_FAILED',
      ].includes(error.code)
      const retryable = !definiteConflict && (error.operationStatus === 'PARCIAL' || error.uncertain === true || !error.status || error.status >= 500)
      if (retryable) setPendingHeadChangeOperations((current) => ({ ...current, [unitId]: { operationId: error.operationId || operationId, userId: newHeadUserId } }))
      else setPendingHeadChangeOperations((current) => { const next = { ...current }; delete next[unitId]; return next })
      const operation = error.operationId || operationId
      setHeadChangeMessages((current) => ({
        ...current,
        [unitId]: { error: retryable
          ? `${error.message} Resultado parcial o incierto. Conserva la operación ${operation} y reintenta con el mismo nuevo Jefe.`
          : `${error.message || 'No se pudo cambiar el Jefe.'} Operación ${operation}.` },
      }))
    } finally {
      setHeadSavingUnitId('')
    }
  }

  const assignSpecialist = async (unitId) => {
    const pending = pendingSpecialistOperations[unitId]
    const userId = pending?.userId || newSpecialistDrafts[unitId] || ''
    if (!userId || (assignedSpecialists.has(userId) && !pending) || specialistSavingUnitId) return
    const operationId = pending?.operationId || globalThis.crypto?.randomUUID?.()
    if (!operationId) {
      setSpecialistMessages((current) => ({ ...current, [unitId]: { error: 'No se pudo generar un identificador seguro de operación.' } }))
      return
    }
    setSpecialistSavingUnitId(unitId)
    setSpecialistMessages((current) => ({ ...current, [unitId]: null }))
    if (!pending) setPendingSpecialistOperations((current) => ({ ...current, [unitId]: { operationId, userId } }))
    try {
      const result = await onAssignSpecialist({ unitId, userId, operationId })
      setPendingSpecialistOperations((current) => { const next = { ...current }; delete next[unitId]; return next })
      setNewSpecialistDrafts((current) => ({ ...current, [unitId]: '' }))
      setSpecialistMessages((current) => ({ ...current, [unitId]: { success: `Especialista asignado a esta unidad: ${result.assignment.userId}. UUID de asignación ${result.assignment.id}. Operación ${result.operationId}.` } }))
    } catch (error) {
      const definiteConflict = [
        'HIERARCHY_SPECIALIST_ALREADY_ASSIGNED', 'HIERARCHY_UNIT_INACTIVE', 'HIERARCHY_DEPENDENCY_MISMATCH',
        'HIERARCHY_USER_DISABLED', 'HIERARCHY_USER_NOT_FOUND', 'HIERARCHY_USER_DEPENDENCY_MISMATCH',
        'HIERARCHY_USER_FUNCTION_MISMATCH', 'HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS', 'HIERARCHY_DIRECTORY_VALIDATION_FAILED',
      ].includes(error.code)
      const retryable = !definiteConflict && (error.operationStatus === 'PARCIAL' || error.uncertain === true || !error.status || error.status >= 500)
      if (retryable) setPendingSpecialistOperations((current) => ({ ...current, [unitId]: { operationId: error.operationId || operationId, userId } }))
      else setPendingSpecialistOperations((current) => { const next = { ...current }; delete next[unitId]; return next })
      const operation = error.operationId || operationId
      setSpecialistMessages((current) => ({
        ...current,
        [unitId]: { error: retryable
          ? `${error.message} Estado parcial o incierto; conserva la operación ${operation} y reintenta con el mismo Especialista.`
          : `${error.message || 'No se pudo asignar el Especialista.'} Operación ${operation}.` },
      }))
    } finally {
      setSpecialistSavingUnitId('')
    }
  }

  const reassignSpecialist = async (userId, currentUnitId) => {
    const pending = pendingSpecialistReassignmentOperations[userId]
    const destinationUnitId = pending?.destinationUnitId || specialistDrafts[userId] || ''
    const sourceUnitId = pending?.sourceUnitId || currentUnitId
    if (!specialistReassignmentEnabled || !destinationUnitId || (!pending && destinationUnitId === sourceUnitId) || specialistSavingUnitId) return
    if (!pending && !globalThis.confirm(`¿Trasladar a ${getPerson(userId).displayName} de ${unitLabel(currentUnitId)} a ${unitLabel(destinationUnitId)}? Se conservará la asignación anterior como inactiva.`)) return
    const operationId = pending?.operationId || globalThis.crypto?.randomUUID?.()
    if (!operationId) {
      setSpecialistReassignmentMessages((current) => ({ ...current, [userId]: { error: 'No se pudo generar un identificador seguro de operación.' } }))
      return
    }
    setSpecialistSavingUnitId(currentUnitId)
    setSpecialistReassignmentMessages((current) => ({ ...current, [userId]: null }))
    if (!pending) setPendingSpecialistReassignmentOperations((current) => ({ ...current, [userId]: { operationId, destinationUnitId, sourceUnitId } }))
    try {
      const result = await onReassignSpecialist({ userId, destinationUnitId, operationId, expectedRevision: revision })
      setPendingSpecialistReassignmentOperations((current) => { const next = { ...current }; delete next[userId]; return next })
      setSpecialistReassignmentMessages((current) => ({ ...current, [userId]: { success: `Especialista trasladado a ${unitLabel(result.destinationUnitId)}. La asignación anterior se conservó inactiva. Operación ${result.operationId}.` } }))
    } catch (error) {
      const definiteConflict = ['HIERARCHY_SPECIALIST_REASSIGNMENT_SAME_UNIT', 'HIERARCHY_SPECIALIST_ASSIGNMENT_NOT_FOUND',
        'HIERARCHY_SPECIALIST_MULTIPLE_ACTIVE_UNITS', 'HIERARCHY_SPECIALIST_REASSIGNMENT_STATE_CONFLICT',
        'HIERARCHY_SPECIALIST_REASSIGNMENT_COMPLETION_CONFLICT', 'HIERARCHY_UNIT_INACTIVE', 'HIERARCHY_DEPENDENCY_MISMATCH',
        'HIERARCHY_UNIT_OUT_OF_SCOPE', 'HIERARCHY_USER_DISABLED', 'HIERARCHY_USER_NOT_FOUND',
        'HIERARCHY_USER_DEPENDENCY_MISMATCH', 'HIERARCHY_USER_FUNCTION_MISMATCH', 'HIERARCHY_USER_MEMBERSHIP_AMBIGUOUS',
        'HIERARCHY_DIRECTORY_VALIDATION_FAILED', 'HIERARCHY_REVISION_CONFLICT'].includes(error.code)
      const retryable = !definiteConflict && (error.operationStatus === 'PARCIAL' || error.uncertain === true || !error.status || error.status >= 500)
      if (retryable) setPendingSpecialistReassignmentOperations((current) => ({ ...current, [userId]: { operationId: error.operationId || operationId, destinationUnitId, sourceUnitId } }))
      else setPendingSpecialistReassignmentOperations((current) => { const next = { ...current }; delete next[userId]; return next })
      const operation = error.operationId || operationId
      setSpecialistReassignmentMessages((current) => ({
        ...current,
        [userId]: { error: retryable
          ? `${error.message} Estado parcial o incierto. Conserva la operación ${operation} y reintenta con el mismo destino.`
          : `${error.message || 'No se pudo reasignar al Especialista.'} Operación ${operation}.` },
      }))
    } finally {
      setSpecialistSavingUnitId('')
    }
  }

  useEffect(() => {
    if (pendingUnitOperation) {
      setUnitDraft({
        name: pendingUnitOperation.name,
        code: pendingUnitOperation.code,
        description: pendingUnitOperation.description,
      })
    }
  }, [pendingUnitOperation])

  useEffect(() => {
    setHeadDrafts(Object.fromEntries(units.map((unit) => [
      unit.id,
      assignments.find((assignment) => assignment.laneId === 'jefes' && assignment.unitId === unit.id)?.userId || '',
    ])))
    setSpecialistDrafts(Object.fromEntries(assignments
      .filter((assignment) => assignment.laneId === 'especialistas' && assignment.unitId)
      .map((assignment) => [assignment.userId, assignment.unitId])))
  }, [assignments, units])

  const assignmentsForUnit = (unitId) => assignments.filter((assignment) => assignment.unitId === unitId)
  const headForUnit = (unitId) => assignmentsForUnit(unitId).find((assignment) => assignment.laneId === 'jefes') || null
  const specialistsForUnit = (unitId) => assignmentsForUnit(unitId).filter((assignment) => assignment.laneId === 'especialistas')
  const unitLabel = (unitId) => units.find((unit) => unit.id === unitId)?.name || unitId
  const activeHeadsElsewhere = new Set(assignments.filter((assignment) => assignment.laneId === 'jefes').map((assignment) => assignment.userId))
  const enabledActions = [unitCreationEnabled && 'creación de unidades', headAssignmentEnabled && 'asignación de Jefes', headChangeEnabled && 'cambio de Jefes', specialistAssignmentEnabled && 'asignación de Especialistas'].filter(Boolean)
  const unitDraftLocked = !unitCreationEnabled || loading || creationPending || Boolean(pendingUnitOperation)

  return (
    <div className="settings-detail">
      <button className="button-secondary settings-back" onClick={onBack} type="button"><span aria-hidden="true">‹</span> Volver a Ajustes</button>
      <div className="settings-detail__toolbar">
        <div><h2>Administrar mi oficina</h2><p>Consulta las unidades y relaciones vigentes de {officeName} desde Alfresco.</p></div>
        <div className="settings-detail__actions">
          <button className="button-secondary" disabled={loading} onClick={onRefresh} type="button">Actualizar datos</button>
          <button className="button-primary" disabled={!unitCreationEnabled || creationPending || loading} form="alfresco-create-unit-form" type="submit" title={!unitCreationEnabled ? 'La escritura está deshabilitada en el backend.' : undefined}>{creationPending ? 'Procesando…' : pendingUnitOperation ? 'Reintentar operación' : 'Crear unidad'}</button>
        </div>
      </div>
      <p className="hierarchy-notice" role="status"><strong>{enabledActions.length ? `Modo Alfresco · habilitado: ${enabledActions.join(' y ')}.` : 'Modo Alfresco · solo lectura.'}</strong> {specialistReassignmentEnabled ? 'La reasignación de Especialistas está disponible.' : 'La reasignación de Especialistas está deshabilitada.'} La dependencia consultada procede de la sesión autenticada: {dependency?.toUpperCase()}.</p>
      {loading && <p className="hierarchy-message" role="status">Consultando estructura y candidatos de Alfresco…</p>}
      {loadingError && <p className="form-message form-message--error" role="alert">{loadingError}</p>}
      {staleCount > 0 && !loadingError && <p className="settings-stale-note" role="status">Hay {staleCount} asignación(es) cuyo usuario no aparece entre los candidatos actuales. Se muestran con su identificador para revisión.</p>}

      <section aria-labelledby="alfresco-unit-form-title" className="hierarchy-card hierarchy-unit-preparation">
        <div><h2 id="alfresco-unit-form-title">Crear una unidad organizacional</h2><p className="hierarchy-card__intro">El alta requiere un nombre institucional confirmado. El servidor valida duplicados antes de crearla.</p></div>
        <form id="alfresco-create-unit-form" onSubmit={createUnit}>
          <div className="form-grid hierarchy-unit-preparation__fields">
            <label className="form-field"><span>Nombre de la unidad</span><input autoComplete="off" disabled={unitDraftLocked} maxLength={240} onChange={(event) => setUnitDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre institucional confirmado" required value={unitDraft.name} /></label>
            <label className="form-field"><span>Código institucional</span><input autoComplete="off" disabled={unitDraftLocked} maxLength={80} onChange={(event) => setUnitDraft((current) => ({ ...current, code: event.target.value }))} placeholder="Código confirmado (opcional)" value={unitDraft.code} /></label>
            <label className="form-field form-field--full"><span>Descripción</span><textarea disabled={unitDraftLocked} maxLength={1000} onChange={(event) => setUnitDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Descripción opcional" value={unitDraft.description} /></label>
          </div>
          <button className="button-primary" disabled={!unitCreationEnabled || creationPending || loading || !unitDraft.name.trim()} type="submit">{creationPending ? 'Procesando unidad…' : pendingUnitOperation ? 'Reintentar operación pendiente' : unitCreationEnabled ? 'Guardar unidad' : 'Guardar unidad · no disponible'}</button>
        </form>
        {!unitCreationEnabled && <small className="hierarchy-readonly-help">El backend aún no ha habilitado la escritura de unidades.</small>}
        {pendingUnitOperation && <small className="hierarchy-readonly-help">Reintenta con los mismos datos y el mismo identificador de operación: {pendingUnitOperation.operationId}. No cierres ni recargues esta pantalla hasta reconciliarla.</small>}
        {creationMessage && <p className="form-message" role="status">{creationMessage}</p>}
        {creationError && <p className="form-message form-message--error" role="alert">{creationError}</p>}
      </section>

      <section aria-labelledby="office-chart-title" className="office-chart-section">
        <div className="office-chart-section__heading"><div><h2 id="office-chart-title">Organigrama de la oficina</h2><p>Dirección → Unidad organizacional → Jefe de unidad y Especialistas.</p></div></div>
        <div className="office-chart">
          <div className="office-chart__director"><span aria-hidden="true" className="settings-lane__avatar"><Icon name="user" size={18} /></span><span><strong>{members.direccion?.displayName || 'Dirección'}</strong><small>Dirección · {members.direccion?.id || 'sesión actual'}</small></span></div>
          {units.length ? <div className="office-chart__units" data-unit-count={units.length} style={{ '--office-unit-count': units.length }}>
            {units.map((unit) => {
              const headAssignment = headForUnit(unit.id)
              const unitSpecialists = specialistsForUnit(unit.id)
              const currentHeadId = Object.hasOwn(headDrafts, unit.id) ? headDrafts[unit.id] : headAssignment?.userId || ''
              const pendingHead = pendingHeadOperations[unit.id]
              const pendingHeadChange = pendingHeadChangeOperations[unit.id]
              const selectedHeadId = pendingHeadChange?.userId || pendingHead?.userId || currentHeadId
              const headCandidates = heads.filter((candidate) => candidate.id === headAssignment?.userId || !activeHeadsElsewhere.has(candidate.id))
              if (selectedHeadId && !headCandidates.some((candidate) => candidate.id === selectedHeadId)) headCandidates.unshift(getPerson(selectedHeadId))
              return <article className="office-chart__unit" key={unit.id}>
                <div className="office-chart__head"><span aria-hidden="true" className="settings-lane__avatar"><Icon name="users" size={18} /></span><span><small>Unidad organizacional</small><strong>{unit.name}</strong><small>{unit.code || 'Sin código institucional'}</small><small className="office-chart__uuid">UUID: {unit.id}</small></span></div>
                <div className="hierarchy-unit-edit__toolbar"><button className="button-secondary" disabled={!unitEditEnabled || unitEditSaving || loading} onClick={() => startUnitEdit(unit)} type="button">Editar unidad</button>{!unitEditEnabled && <small>Edición deshabilitada por el backend.</small>}</div>
                {unitEditMessage.unitId === unit.id && unitEditMessage.success && <p className="form-message" role="status">{unitEditMessage.success}</p>}
                {editingUnitId === unit.id && <form className="hierarchy-unit-edit" onSubmit={(event) => saveUnitEdit(event, unit)}>
                  <label className="form-field"><span>Nombre de la unidad</span><input disabled={!unitEditEnabled || unitEditSaving} maxLength={240} onChange={(event) => setUnitEditDraft((current) => ({ ...current, name: event.target.value }))} required value={unitEditDraft.name} /></label>
                  <label className="form-field"><span>Código de la unidad</span><input disabled={!unitEditEnabled || unitEditSaving} maxLength={80} onChange={(event) => setUnitEditDraft((current) => ({ ...current, code: event.target.value }))} value={unitEditDraft.code} /></label>
                  <label className="form-field"><span>Descripción</span><textarea disabled={!unitEditEnabled || unitEditSaving} maxLength={1000} onChange={(event) => setUnitEditDraft((current) => ({ ...current, description: event.target.value }))} rows={3} value={unitEditDraft.description} /></label>
                  {pendingUnitEdits[unit.id] && <small>Operación pendiente {pendingUnitEdits[unit.id].operationId}. Conserva estos valores para reconciliarla.</small>}
                  {unitEditMessage.unitId === unit.id && unitEditMessage.error && <p className="form-message form-message--error" role="alert">{unitEditMessage.error}</p>}
                  <div className="hierarchy-unit-edit__actions"><button className="button-primary" disabled={!unitEditEnabled || unitEditSaving || !unitEditDraft.name.trim()} type="submit">{unitEditSaving ? 'Guardando…' : pendingUnitEdits[unit.id] ? 'Reintentar edición' : 'Guardar cambios'}</button><button className="button-secondary" disabled={unitEditSaving} onClick={() => setEditingUnitId('')} type="button">Cancelar</button></div>
                </form>}
                <label className="form-field office-chart__role-field"><span>Jefe de unidad</span><select disabled={Boolean(pendingHead) || Boolean(pendingHeadChange) || headSavingUnitId === unit.id || (headAssignment ? !headChangeEnabled : !headAssignmentEnabled)} onChange={(event) => setHeadDrafts((current) => ({ ...current, [unit.id]: event.target.value }))} value={selectedHeadId}><option value="">{headAssignment ? 'Selecciona el nuevo Jefe' : 'Selecciona un Jefe'}</option>{headCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.id}{candidate.id === headAssignment?.userId ? ' · actual' : ''}</option>)}</select><small>{pendingHeadChange ? `Cambio pendiente · operación ${pendingHeadChange.operationId}. Reintenta con el mismo usuario.` : headAssignment ? `Jefe actual: ${getPerson(headAssignment.userId).displayName}. Se conservan ${unitSpecialists.length} Especialista(s) vinculados a esta unidad.` : pendingHead ? `Reintento con operación ${pendingHead.operationId}.` : `Solo se muestran candidatos habilitados de ${dependency?.toUpperCase()} con rol Jefe de Unidad y sin jefatura activa en otra unidad.`}</small></label>
                <button className="button-secondary" disabled={pendingHeadChange ? (!headChangeEnabled || headSavingUnitId !== '') : headAssignment ? (!headChangeEnabled || (!selectedHeadId || selectedHeadId === headAssignment.userId) || headSavingUnitId !== '') : (!headAssignmentEnabled || (!selectedHeadId && !pendingHead) || headSavingUnitId !== '')} onClick={() => (headAssignment || pendingHeadChange) ? changeHead(unit.id) : assignHead(unit.id)} type="button">{headSavingUnitId === unit.id ? 'Procesando…' : pendingHeadChange ? 'Reintentar cambio' : headAssignment ? headChangeEnabled ? 'Cambiar Jefe' : 'Cambio de Jefe · no disponible' : pendingHead ? 'Reintentar asignación' : headAssignmentEnabled ? 'Asignar Jefe' : 'Asignar Jefe · no disponible'}</button>
                {headMessages[unit.id]?.success && <p className="form-message" role="status">{headMessages[unit.id].success}</p>}
                {headMessages[unit.id]?.error && <p className="form-message form-message--error" role="alert">{headMessages[unit.id].error}</p>}
                {headChangeMessages[unit.id]?.success && <p className="form-message" role="status">{headChangeMessages[unit.id].success}</p>}
                {headChangeMessages[unit.id]?.error && <p className="form-message form-message--error" role="alert">{headChangeMessages[unit.id].error}</p>}
                <div className="office-chart__specialists">
                  <strong>Especialistas ({unitSpecialists.length})</strong>
                  {unitSpecialists.length ? unitSpecialists.map((assignment) => {
                    const person = getPerson(assignment.userId)
                    const pendingReassignment = pendingSpecialistReassignmentOperations[assignment.userId]
                    const selectedUnitId = pendingReassignment?.destinationUnitId || specialistDrafts[assignment.userId] || unit.id
                    return <div className="office-chart__specialist-row" key={assignment.userId}>
                      <div className="office-chart__specialist"><span aria-hidden="true" className="settings-lane__avatar"><Icon name="user" size={16} /></span><span><strong>{person.displayName}</strong><small>{person.id}</small></span></div>
                      <label className="form-field"><span>Unidad actual / destino</span><select disabled={!specialistReassignmentEnabled || Boolean(pendingReassignment) || specialistSavingUnitId !== '' || loading} onChange={(event) => setSpecialistDrafts((current) => ({ ...current, [assignment.userId]: event.target.value }))} value={selectedUnitId}>{units.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.code || option.id}{option.id === unit.id ? ' · actual' : ''}</option>)}</select><small>{pendingReassignment ? `Reasignación pendiente · operación ${pendingReassignment.operationId}. Reintenta con el mismo destino.` : `Unidad actual: ${unit.name}.`}</small></label>
                      <button className="button-secondary" disabled={Boolean(pendingReassignment) || !specialistReassignmentEnabled || (!pendingReassignment && (!selectedUnitId || selectedUnitId === unit.id)) || specialistSavingUnitId !== '' || loading} onClick={() => reassignSpecialist(assignment.userId, unit.id)} type="button">{specialistSavingUnitId === unit.id && selectedUnitId !== unit.id ? 'Procesando…' : specialistReassignmentEnabled ? 'Reasignar' : 'Reasignación · no disponible'}</button>
                      {specialistReassignmentMessages[assignment.userId]?.success && <p className="form-message" role="status">{specialistReassignmentMessages[assignment.userId].success}</p>}
                      {specialistReassignmentMessages[assignment.userId]?.error && <p className="form-message form-message--error" role="alert">{specialistReassignmentMessages[assignment.userId].error}</p>}
                    </div>
                  }) : <p className="office-chart__empty">Esta unidad todavía no tiene especialistas asignados.</p>}
                  <label className="form-field"><span>Asignar Especialista a esta unidad</span><select disabled={!specialistAssignmentEnabled || Boolean(pendingSpecialistOperations[unit.id]) || specialistSavingUnitId !== '' || loading} onChange={(event) => setNewSpecialistDrafts((current) => ({ ...current, [unit.id]: event.target.value }))} value={pendingSpecialistOperations[unit.id]?.userId || newSpecialistDrafts[unit.id] || ''}><option value="">Selecciona un candidato habilitado</option>{specialists.filter((candidate) => !assignedSpecialists.has(candidate.id) || candidate.id === pendingSpecialistOperations[unit.id]?.userId).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.id}</option>)}</select><small>La asignación se vincula a la unidad y no depende de que tenga Jefe.</small></label>
                  <button className="button-secondary" disabled={!specialistAssignmentEnabled || (!newSpecialistDrafts[unit.id] && !pendingSpecialistOperations[unit.id]) || specialistSavingUnitId !== '' || loading} onClick={() => assignSpecialist(unit.id)} type="button">{specialistSavingUnitId === unit.id ? 'Asignando…' : pendingSpecialistOperations[unit.id] ? 'Reintentar misma operación' : specialistAssignmentEnabled ? 'Asignar Especialista' : 'Asignación · no disponible'}</button>
                  {specialistMessages[unit.id]?.success && <p className="form-message" role="status">{specialistMessages[unit.id].success}</p>}
                  {specialistMessages[unit.id]?.error && <p className="form-message form-message--error" role="alert">{specialistMessages[unit.id].error}</p>}
                </div>
              </article>
            })}
          </div> : <div className="hierarchy-empty hierarchy-empty--card"><strong>Alfresco todavía no contiene unidades para esta dependencia.</strong><span>{unitCreationEnabled ? 'Puedes crear una unidad con nombre institucional confirmado mediante el formulario.' : 'Cuando el backend habilite el alta, las unidades aparecerán aquí con su UUID.'}</span></div>}
        </div>
      </section>
      {Object.entries(pendingSpecialistReassignmentOperations).length > 0 && <section aria-labelledby="pending-specialist-reassignments-title" className="hierarchy-card hierarchy-candidates">
        <div><h2 id="pending-specialist-reassignments-title">Reasignaciones pendientes de reconciliación</h2><p className="hierarchy-card__intro">Conserva el mismo destino y operationId mientras se verifica el estado real en Alfresco.</p></div>
        <ul className="settings-lane__members">{Object.entries(pendingSpecialistReassignmentOperations).map(([userId, operation]) => <li key={userId}>
          <span className="settings-lane__identity"><strong>{getPerson(userId).displayName}</strong><small>{userId} · {unitLabel(operation.sourceUnitId)} → {unitLabel(operation.destinationUnitId)} · operación {operation.operationId}</small></span>
          <button className="button-secondary" disabled={!specialistReassignmentEnabled || specialistSavingUnitId !== '' || loading} onClick={() => reassignSpecialist(userId, operation.sourceUnitId)} type="button">{specialistSavingUnitId && specialistSavingUnitId === operation.sourceUnitId ? 'Reconciliando…' : 'Reintentar misma operación'}</button>
        </li>)}</ul>
      </section>}
      <section aria-labelledby="hierarchy-candidates-title" className="hierarchy-card hierarchy-candidates">
        <div><h2 id="hierarchy-candidates-title">Candidatos disponibles</h2><p className="hierarchy-card__intro">Usuarios habilitados consultados en los grupos funcionales de la dependencia.</p></div>
        <div className="settings-lanes hierarchy-candidates__lanes">
          {[{ id: 'jefe-unidad', title: 'Jefes de unidad', list: heads }, { id: 'especialista', title: 'Especialistas', list: specialists }].map((group) => (
            <section className="settings-lane" key={group.id}>
              <header className="settings-lane__header"><div><h3>{group.title}</h3><p>Selección habilitada solo como borrador</p></div><span className="settings-lane__count">{group.list.length}</span></header>
              {group.list.length ? <ul className="settings-lane__members">{group.list.map((person) => <li key={person.id}><span aria-hidden="true" className="settings-lane__avatar"><Icon name="user" size={17} /></span><span className="settings-lane__identity"><strong>{person.displayName}</strong><small>{person.id}</small></span></li>)}</ul> : <p className="hierarchy-empty">No hay candidatos disponibles para este rol.</p>}
            </section>
          ))}
        </div>
      </section>
      <section aria-labelledby="hierarchy-audit-title" className="hierarchy-card hierarchy-audit">
        <div className="hierarchy-audit__heading"><div><h2 id="hierarchy-audit-title">Historial de movimientos</h2><p className="hierarchy-card__intro">Consulta los eventos de auditoría registrados para {officeName}. La consulta es de solo lectura.</p></div>
          <button className="button-secondary" disabled={auditLoading} onClick={() => setAuditPage(1)} type="button">Actualizar historial</button></div>
        <form className="hierarchy-audit__filters" onSubmit={(event) => { event.preventDefault(); setAuditPage(1); setAuditFilters({ ...auditDraft }) }}>
          <label className="form-field"><span>Tipo de operación</span><select onChange={(event) => setAuditDraft((current) => ({ ...current, operationType: event.target.value }))} value={auditDraft.operationType}><option value="">Todas</option><option value="unidad">Creación de unidad</option><option value="asignacion-jefe">Asignación de Jefe</option><option value="cambio-jefe">Cambio de Jefe</option><option value="asignacion-especialista">Asignación de Especialista</option><option value="reasignacion-especialista">Reasignación de Especialista</option></select></label>
          <label className="form-field"><span>Resultado</span><select onChange={(event) => setAuditDraft((current) => ({ ...current, phase: event.target.value }))} value={auditDraft.phase}><option value="">Todos</option><option value="INICIADA">Iniciada</option><option value="CAMBIO_APLICADO">Cambio aplicado</option><option value="COMPLETADA">Completada</option><option value="PARCIAL">Parcial</option><option value="RECONCILIACION">Reconciliación</option></select></label>
          <label className="form-field"><span>Desde</span><input onChange={(event) => setAuditDraft((current) => ({ ...current, from: event.target.value }))} type="date" value={auditDraft.from} /></label>
          <label className="form-field"><span>Hasta</span><input onChange={(event) => setAuditDraft((current) => ({ ...current, to: event.target.value }))} type="date" value={auditDraft.to} /></label>
          <button className="button-primary" disabled={auditLoading} type="submit">Aplicar filtros</button>
        </form>
        {auditLoading && <p className="hierarchy-message" role="status">Consultando historial…</p>}
        {auditError && <p className="form-message form-message--error" role="alert">{auditError}</p>}
        {!auditLoading && !auditError && auditResult.events.length === 0 && <p className="hierarchy-empty">No hay movimientos para los filtros seleccionados.</p>}
        {auditResult.events.length > 0 && <div className="hierarchy-audit__table-wrap"><table className="hierarchy-audit__table"><thead><tr><th>Fecha y hora</th><th>Movimiento</th><th>Unidad</th><th>Responsable</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>
          {auditResult.events.map((event) => {
            const labels = { unidad: 'Creación de unidad', 'edicion-unidad': 'Edición de unidad', 'asignacion-jefe': 'Asignación de Jefe', 'cambio-jefe': 'Cambio de Jefe', 'asignacion-especialista': 'Asignación de Especialista', 'reasignacion-especialista': 'Reasignación de Especialista' }
            const selected = auditSelected === event.id
            const eventUnit = units.find((unit) => unit.id === event.unitId || unit.id === event.afterData?.destinationUnitId || unit.id === event.beforeData?.sourceUnitId)
            const phaseLabel = { INICIADA: 'Iniciada', CAMBIO_APLICADO: 'Cambio aplicado', COMPLETADA: 'Completada', PARCIAL: 'Parcial', RECONCILIACION: 'Reconciliación' }[event.phase] || event.phase
            return <tr className={event.phase === 'PARCIAL' ? 'hierarchy-audit__partial' : ''} key={event.id}>
              <td>{event.occurredAt ? new Date(event.occurredAt).toLocaleString('es-PE') : 'Fecha no disponible'}</td>
              <td>{labels[event.operationType] || 'Movimiento de jerarquía'}</td>
              <td>{event.unitName || eventUnit?.name || (event.unitId ? `Unidad ${event.unitId}` : 'No especificada')}{event.unitCode && <small>Código: {event.unitCode}</small>}</td>
              <td>{event.actor || 'No identificado'}{event.userId && <small>Usuario afectado: {event.userId}</small>}</td>
              <td><span className={`hierarchy-audit__status hierarchy-audit__status--${event.phase.toLowerCase()}`}>{phaseLabel}</span></td>
              <td><button className="button-secondary hierarchy-audit__detail-button" onClick={() => setAuditSelected(selected ? '' : event.id)} type="button">{selected ? 'Ocultar' : 'Ver detalle'}</button>
                {selected && <details className="hierarchy-audit__details" open><summary>Datos del movimiento</summary><AuditChangeDetails afterData={event.afterData} beforeData={event.beforeData} /></details>}</td>
            </tr>
          })}
        </tbody></table></div>}
        <div className="hierarchy-audit__pagination"><span>{auditResult.pagination.totalItems || 0} movimiento(s) · página {auditResult.pagination.page || auditPage} de {auditResult.pagination.totalPages || 0}</span><div><button className="button-secondary" disabled={auditLoading || auditPage <= 1} onClick={() => setAuditPage((page) => Math.max(1, page - 1))} type="button">Anterior</button><button className="button-secondary" disabled={auditLoading || !auditResult.pagination.hasMoreItems} onClick={() => setAuditPage((page) => page + 1)} type="button">Siguiente</button></div></div>
      </section>
    </div>
  )
}

function OfficeHierarchy({ officeName, dependency, members, specialistUnits, recipients, staleCount, revision, pendingHeadChanges, pendingSpecialistReassignments, units, assignments, alfrescoReadOnly, loading, loadingError, saving, unitCreationEnabled, unitEditEnabled, headAssignmentEnabled, headChangeEnabled, specialistAssignmentEnabled, specialistReassignmentEnabled, creationPending, pendingUnitOperation, creationMessage, creationError, onCreateUnit, onEditUnit, onAssignHead, onChangeHead, onAssignSpecialist, onReassignSpecialist, onRefresh, onAddMembers, onRemoveMember, onBack }) {
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
    return listAvailableHierarchyCandidates(recipients, { role: selectedLane.role, dependency, assignedIds, query: search })
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

  if (alfrescoReadOnly) {
    return <AlfrescoReadOnlyHierarchy
      assignments={assignments}
      dependency={dependency}
      headAssignmentEnabled={headAssignmentEnabled}
      headChangeEnabled={headChangeEnabled}
      specialistAssignmentEnabled={specialistAssignmentEnabled}
      specialistReassignmentEnabled={specialistReassignmentEnabled}
      revision={revision}
      pendingHeadChanges={pendingHeadChanges}
      pendingSpecialistReassignments={pendingSpecialistReassignments}
      creationError={creationError}
      creationMessage={creationMessage}
      creationPending={creationPending}
      pendingUnitOperation={pendingUnitOperation}
      loading={loading}
      loadingError={loadingError}
      members={members}
      onCreateUnit={onCreateUnit}
      onEditUnit={onEditUnit}
      onAssignHead={onAssignHead}
      onChangeHead={onChangeHead}
      onAssignSpecialist={onAssignSpecialist}
      onReassignSpecialist={onReassignSpecialist}
      onBack={onBack}
      onRefresh={onRefresh}
      officeName={officeName}
      recipients={recipients}
      staleCount={staleCount}
      units={units}
      unitCreationEnabled={unitCreationEnabled}
      unitEditEnabled={unitEditEnabled}
    />
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

function OfficeTimings({ onBack, csrfToken }) {
  const [settings, setSettings] = useState(null)
  const [draft, setDraft] = useState([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingOperationId, setPendingOperationId] = useState('')
  const [operationPending, setOperationPending] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const canEdit = settings?.capabilities?.edit === true

  const loadSettings = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getResponseTimes()
      setSettings(result)
      setDraft(result.values || [])
    } catch (loadError) {
      setError(loadError.message || 'No se pudieron consultar los tiempos de respuesta.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSettings() }, [])

  const updateDraft = (priority, changes) => {
    setPendingOperationId('')
    setDraft((current) => current.map((entry) => entry.priority === priority ? { ...entry, ...changes } : entry))
  }
  const cancelEdit = () => { setDraft(settings?.values || []); setPendingOperationId(''); setOperationPending(false); setEditing(false); setError(''); setMessage('') }
  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true
    const operationId = pendingOperationId || globalThis.crypto?.randomUUID?.() || `response-times-${Date.now()}`
    setSaving(true)
    setError('')
    setMessage('')
    try {
      setPendingOperationId(operationId)
      await updateResponseTimes({ operationId, expectedRevision: settings?.revision, values: draft }, csrfToken)
      const refreshed = await getResponseTimes()
      setSettings(refreshed)
      setDraft(refreshed.values || [])
      setPendingOperationId('')
      setOperationPending(false)
      setEditing(false)
      setMessage('Los tiempos se guardaron y se volvieron a consultar desde el servidor.')
    } catch (saveError) {
      setError(saveError.message || 'No se pudieron guardar los tiempos.')
      if (saveError.operationStatus === 'PARCIAL' || saveError.code === 'RESPONSE_TIMES_OPERATION_PENDING') {
        setOperationPending(true)
        setPendingOperationId(saveError.operationId || operationId)
      }
      if (saveError.code === 'RESPONSE_TIMES_REVISION_CONFLICT') {
        try {
          const refreshed = await getResponseTimes()
          setSettings(refreshed)
          setMessage('Se cargó la revisión actual del servidor. Revisa el borrador antes de volver a guardarlo.')
        } catch { /* keep the conflict visible; do not submit again automatically */ }
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const formatValue = ({ value, unit }) => `${value} ${unit === 'DIAS' ? (value === 1 ? 'día' : 'días') : (value === 1 ? 'hora' : 'horas')}`
  return (
    <div className="settings-detail">
      <button className="button-secondary settings-back" onClick={onBack} type="button"><span aria-hidden="true">‹</span> Volver a Ajustes</button>
      <section className="hierarchy-card">
        <div className="settings-detail__toolbar">
          <div><h2>Tiempos de respuesta</h2><p>Configure los plazos de respuesta de los documentos según su prioridad. Valores para {settings?.dependency?.toUpperCase() || 'la dependencia de tu sesión'}.</p></div>
          {!editing
            ? <button className="button-secondary" disabled={!canEdit || loading} onClick={() => { setDraft(settings?.values || []); setEditing(true); setMessage('') }} type="button">Editar tiempos</button>
            : <div className="settings-detail__actions"><button className="button-secondary" disabled={saving || operationPending} onClick={cancelEdit} type="button">Cancelar</button><button className="button-primary" disabled={saving || !canEdit} onClick={save} type="button">{saving ? 'Guardando…' : 'Guardar cambios'}</button></div>}
        </div>
        {loading ? <p className="hierarchy-notice" role="status">Consultando configuración…</p> : null}
        {error ? <p className="settings-feedback settings-feedback--error" role="alert">{error}</p> : null}
        {message ? <p className="settings-feedback" role="status">{message}</p> : null}
        {!loading && settings ? <>
          <div className="settings-timing-list">
            {timingPriorities.map((priority) => {
              const value = (editing ? draft : settings.values).find((entry) => entry.priority === priority.id)
              if (!value) return null
              return <div className={`settings-timing-row settings-timing-row--${priority.className}`} key={priority.id}>
                <div><strong>{priority.title}</strong><span>Tiempo máximo de respuesta</span></div>
                {editing
                  ? <div className="settings-timing-controls"><input aria-label={`Cantidad de tiempo ${priority.title}`} disabled={saving || operationPending} max={value.unit === 'DIAS' ? 365 : 8760} min="1" onChange={(event) => updateDraft(priority.id, { value: event.target.value === '' ? '' : Number(event.target.value) })} step="1" type="number" value={value.value} /><select aria-label={`Unidad de tiempo ${priority.title}`} disabled={saving || operationPending} onChange={(event) => updateDraft(priority.id, { unit: event.target.value })} value={value.unit}><option value="DIAS">Días</option><option value="HORAS">Horas</option></select></div>
                  : <strong className="settings-timing-value">{formatValue(value)}</strong>}
              </div>
            })}
          </div>
          <p className="hierarchy-notice">{settings.isDefault ? 'Se muestran valores predeterminados de referencia. Aún no existe una configuración institucional persistida.' : 'Configuración persistida en el servicio institucional.'}{!canEdit ? ' El guardado solo se habilita durante un piloto DSA autorizado con instancia única.' : ''}</p>
        </> : null}
      </section>
    </div>
  )
}

export function HierarchyManagementPage({ office, csrfToken }) {
  const [view, setView] = useState(moduleViews.home)
  const [members, setMembers] = useState(emptyMembers)
  const [specialistUnits, setSpecialistUnits] = useState({})
  const [units, setUnits] = useState([])
  const [hierarchyAssignments, setHierarchyAssignments] = useState([])
  const [hierarchyRevision, setHierarchyRevision] = useState('')
  const [pendingHeadChanges, setPendingHeadChanges] = useState([])
  const [pendingSpecialistReassignments, setPendingSpecialistReassignments] = useState([])
  const [alfrescoReadOnly, setAlfrescoReadOnly] = useState(false)
  const [unitCreationEnabled, setUnitCreationEnabled] = useState(false)
  const [unitEditEnabled, setUnitEditEnabled] = useState(false)
  const [headAssignmentEnabled, setHeadAssignmentEnabled] = useState(false)
  const [headChangeEnabled, setHeadChangeEnabled] = useState(false)
  const [specialistAssignmentEnabled, setSpecialistAssignmentEnabled] = useState(false)
  const [specialistReassignmentEnabled, setSpecialistReassignmentEnabled] = useState(false)
  const [creationPending, setCreationPending] = useState(false)
  const [pendingUnitOperation, setPendingUnitOperation] = useState(null)
  const [creationMessage, setCreationMessage] = useState('')
  const [creationError, setCreationError] = useState('')
  const [recipients, setRecipients] = useState([])
  const [staleCount, setStaleCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingError, setLoadingError] = useState('')
  const [saving] = useState(false)
  const officeName = office?.office || office?.acronym || 'la oficina actual'

  const loadOffice = async (activeCheck = () => true) => {
    setLoading(true)
    setLoadingError('')
    try {
      const result = await getHierarchy()
      if (!activeCheck()) return
      const model = createHierarchyManagementModel(result)
      setRecipients(model.recipients)
      setStaleCount(model.staleCount)
      setMembers(model.members)
      setSpecialistUnits(model.specialistUnits)
      setUnits(model.units)
      setHierarchyAssignments(model.assignments)
      setHierarchyRevision(result.revision || '')
      setPendingHeadChanges(Array.isArray(result.pendingHeadChanges) ? result.pendingHeadChanges : [])
      setPendingSpecialistReassignments(Array.isArray(result.pendingSpecialistReassignments) ? result.pendingSpecialistReassignments : [])
      setAlfrescoReadOnly(model.alfrescoReadOnly)
      setUnitCreationEnabled(model.alfrescoReadOnly && result.capabilities?.createUnits === true)
      setUnitEditEnabled(model.alfrescoReadOnly && result.capabilities?.editUnits === true)
      setHeadAssignmentEnabled(model.alfrescoReadOnly && result.capabilities?.assignHeads === true)
      setHeadChangeEnabled(model.alfrescoReadOnly && result.capabilities?.changeHeads === true)
      setSpecialistAssignmentEnabled(model.alfrescoReadOnly && result.capabilities?.assignSpecialists === true)
      setSpecialistReassignmentEnabled(model.alfrescoReadOnly && result.capabilities?.reassignSpecialists === true)
    } catch (error) {
      if (activeCheck()) {
        setLoadingError(error.message || 'No se pudo consultar la oficina.')
        setMembers(emptyMembers)
        setSpecialistUnits({})
        setUnits([])
        setHierarchyAssignments([])
        setHierarchyRevision('')
        setPendingHeadChanges([])
        setPendingSpecialistReassignments([])
        setRecipients([])
        setStaleCount(0)
        setUnitCreationEnabled(false)
        setUnitEditEnabled(false)
        setHeadAssignmentEnabled(false)
        setHeadChangeEnabled(false)
        setSpecialistAssignmentEnabled(false)
        setSpecialistReassignmentEnabled(false)
        if (String(error.code || '').startsWith('HIERARCHY_ALFRESCO_')) setAlfrescoReadOnly(true)
      }
    } finally {
      if (activeCheck()) setLoading(false)
    }
  }

  const createUnit = async (draft) => {
    if (!unitCreationEnabled || creationPending) return false
    const payload = { name: draft.name.trim(), code: draft.code.trim(), description: draft.description.trim() }
    let operationId = pendingUnitOperation?.operationId
    if (pendingUnitOperation && (pendingUnitOperation.name !== payload.name || pendingUnitOperation.code !== payload.code || pendingUnitOperation.description !== payload.description)) {
      setCreationError('Hay una operación pendiente con datos distintos. Reintenta primero con los mismos datos para reconciliarla.')
      return false
    }
    if (!operationId) {
      operationId = globalThis.crypto?.randomUUID?.()
      if (!operationId) {
        setCreationError('Este navegador no pudo generar un identificador de operación seguro. Actualízalo antes de reintentar.')
        return false
      }
      setPendingUnitOperation({ ...payload, operationId })
    }
    setCreationPending(true)
    setCreationMessage('')
    setCreationError('')
    try {
      const result = await postHierarchyUnit({
        ...payload, operationId,
      }, csrfToken)
      setPendingUnitOperation(null)
      setCreationMessage(`Unidad creada y verificada: ${result.unit.name} · UUID ${result.unit.id}. Operación ${result.operationId}.`)
      try {
        const refreshed = await getHierarchy()
        const model = createHierarchyManagementModel(refreshed)
        setRecipients(model.recipients)
        setStaleCount(model.staleCount)
        setMembers(model.members)
        setSpecialistUnits(model.specialistUnits)
        setUnits(model.units)
        setHierarchyAssignments(model.assignments)
        setHierarchyRevision(refreshed.revision || '')
        setPendingHeadChanges(Array.isArray(refreshed.pendingHeadChanges) ? refreshed.pendingHeadChanges : [])
        setAlfrescoReadOnly(model.alfrescoReadOnly)
        setUnitCreationEnabled(model.alfrescoReadOnly && refreshed.capabilities?.createUnits === true)
        setHeadAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignHeads === true)
        setHeadChangeEnabled(model.alfrescoReadOnly && refreshed.capabilities?.changeHeads === true)
        setSpecialistAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignSpecialists === true)
      } catch (refreshError) {
        setCreationError(`El BFF confirmó la creación y auditoría, pero no se pudo actualizar la lista: ${refreshError.message || 'error de lectura'}. Operación ${result.operationId}. Usa «Actualizar datos».`)
      }
      return true
    } catch (error) {
      const operation = error.operationId || operationId
      const partial = error.operationStatus === 'PARCIAL' || error.code === 'HIERARCHY_UNIT_OPERATION_PARTIAL'
      const definiteConflict = ['HIERARCHY_UNIT_NAME_DUPLICATE', 'HIERARCHY_UNIT_CODE_DUPLICATE', 'HIERARCHY_OPERATION_DUPLICATE_CONFLICT'].includes(error.code)
      const retryable = !definiteConflict && (partial || !error.status || error.status >= 500)
      if (retryable) setPendingUnitOperation({ ...payload, operationId: operation })
      else setPendingUnitOperation(null)
      setCreationError(definiteConflict
        ? `${error.message} La solicitud fue rechazada por conflicto; no vuelvas a enviarla sin revisar los datos. Operación ${operation}.`
        : partial
        ? `${error.message} Estado parcial; operación ${operation}${error.unitId ? ` · unidad ${error.unitId}` : ''}. Actualiza los datos antes de reintentar.`
        : `${error.message || 'No se pudo crear la unidad.'} Operación ${operation}.`)
      return false
    } finally {
      setCreationPending(false)
    }
  }

  const editUnit = async ({ unitId, name, code, description, operationId, expectedRevision }) => {
    const result = await patchHierarchyUnit({ unitId, name, code, description, operationId, expectedRevision }, csrfToken)
    try {
      const refreshed = await getHierarchy()
      const model = createHierarchyManagementModel(refreshed)
      setRecipients(model.recipients)
      setStaleCount(model.staleCount)
      setMembers(model.members)
      setSpecialistUnits(model.specialistUnits)
      setUnits(model.units)
      setHierarchyAssignments(model.assignments)
      setHierarchyRevision(refreshed.revision || '')
      setPendingHeadChanges(Array.isArray(refreshed.pendingHeadChanges) ? refreshed.pendingHeadChanges : [])
      setPendingSpecialistReassignments(Array.isArray(refreshed.pendingSpecialistReassignments) ? refreshed.pendingSpecialistReassignments : [])
      setAlfrescoReadOnly(model.alfrescoReadOnly)
      setUnitCreationEnabled(model.alfrescoReadOnly && refreshed.capabilities?.createUnits === true)
      setUnitEditEnabled(model.alfrescoReadOnly && refreshed.capabilities?.editUnits === true)
      setHeadAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignHeads === true)
      setHeadChangeEnabled(model.alfrescoReadOnly && refreshed.capabilities?.changeHeads === true)
      setSpecialistAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignSpecialists === true)
      setSpecialistReassignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.reassignSpecialists === true)
    } catch (refreshError) {
      return { ...result, refreshError: refreshError.message || 'No se pudo actualizar la vista desde Alfresco.' }
    }
    return result
  }

  const assignHead = async ({ unitId, userId, operationId }) => {
    const result = await postHierarchyHead({ unitId, userId, operationId }, csrfToken)
    const refreshed = await getHierarchy()
    const model = createHierarchyManagementModel(refreshed)
    setRecipients(model.recipients)
    setStaleCount(model.staleCount)
    setMembers(model.members)
    setSpecialistUnits(model.specialistUnits)
    setUnits(model.units)
    setHierarchyAssignments(model.assignments)
    setHierarchyRevision(refreshed.revision || '')
    setPendingHeadChanges(Array.isArray(refreshed.pendingHeadChanges) ? refreshed.pendingHeadChanges : [])
    setPendingSpecialistReassignments(Array.isArray(refreshed.pendingSpecialistReassignments) ? refreshed.pendingSpecialistReassignments : [])
    setAlfrescoReadOnly(model.alfrescoReadOnly)
    setUnitCreationEnabled(model.alfrescoReadOnly && refreshed.capabilities?.createUnits === true)
    setHeadAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignHeads === true)
    setHeadChangeEnabled(model.alfrescoReadOnly && refreshed.capabilities?.changeHeads === true)
    setSpecialistAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignSpecialists === true)
    setSpecialistReassignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.reassignSpecialists === true)
    return result
  }

  const reassignSpecialist = async ({ userId, destinationUnitId, operationId, expectedRevision }) => {
    const result = await postHierarchySpecialistReassignment({ userId, destinationUnitId, operationId, expectedRevision }, csrfToken)
    const refreshed = await getHierarchy()
    const model = createHierarchyManagementModel(refreshed)
    setRecipients(model.recipients)
    setStaleCount(model.staleCount)
    setMembers(model.members)
    setSpecialistUnits(model.specialistUnits)
    setUnits(model.units)
    setHierarchyAssignments(model.assignments)
    setHierarchyRevision(refreshed.revision || '')
    setPendingHeadChanges(Array.isArray(refreshed.pendingHeadChanges) ? refreshed.pendingHeadChanges : [])
    setPendingSpecialistReassignments(Array.isArray(refreshed.pendingSpecialistReassignments) ? refreshed.pendingSpecialistReassignments : [])
    setAlfrescoReadOnly(model.alfrescoReadOnly)
    setUnitCreationEnabled(model.alfrescoReadOnly && refreshed.capabilities?.createUnits === true)
    setHeadAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignHeads === true)
    setHeadChangeEnabled(model.alfrescoReadOnly && refreshed.capabilities?.changeHeads === true)
    setSpecialistAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignSpecialists === true)
    setSpecialistReassignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.reassignSpecialists === true)
    return result
  }

  const assignSpecialist = async ({ unitId, userId, operationId }) => {
    const result = await postHierarchySpecialist({ unitId, userId, operationId }, csrfToken)
    const refreshed = await getHierarchy()
    const model = createHierarchyManagementModel(refreshed)
    setRecipients(model.recipients)
    setStaleCount(model.staleCount)
    setMembers(model.members)
    setSpecialistUnits(model.specialistUnits)
    setUnits(model.units)
    setHierarchyAssignments(model.assignments)
    setHierarchyRevision(refreshed.revision || '')
    setPendingHeadChanges(Array.isArray(refreshed.pendingHeadChanges) ? refreshed.pendingHeadChanges : [])
    setPendingSpecialistReassignments(Array.isArray(refreshed.pendingSpecialistReassignments) ? refreshed.pendingSpecialistReassignments : [])
    setAlfrescoReadOnly(model.alfrescoReadOnly)
    setUnitCreationEnabled(model.alfrescoReadOnly && refreshed.capabilities?.createUnits === true)
    setHeadAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignHeads === true)
    setHeadChangeEnabled(model.alfrescoReadOnly && refreshed.capabilities?.changeHeads === true)
    setSpecialistAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignSpecialists === true)
    setSpecialistReassignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.reassignSpecialists === true)
    return result
  }

  const changeHead = async ({ unitId, newHeadUserId, operationId, expectedRevision }) => {
    const result = await postHierarchyHeadChange({ unitId, newHeadUserId, operationId, expectedRevision }, csrfToken)
    const refreshed = await getHierarchy()
    const model = createHierarchyManagementModel(refreshed)
    setRecipients(model.recipients)
    setStaleCount(model.staleCount)
    setMembers(model.members)
    setSpecialistUnits(model.specialistUnits)
    setUnits(model.units)
    setHierarchyAssignments(model.assignments)
    setHierarchyRevision(refreshed.revision || '')
    setPendingHeadChanges(Array.isArray(refreshed.pendingHeadChanges) ? refreshed.pendingHeadChanges : [])
    setAlfrescoReadOnly(model.alfrescoReadOnly)
    setUnitCreationEnabled(model.alfrescoReadOnly && refreshed.capabilities?.createUnits === true)
    setHeadAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignHeads === true)
    setHeadChangeEnabled(model.alfrescoReadOnly && refreshed.capabilities?.changeHeads === true)
    setSpecialistAssignmentEnabled(model.alfrescoReadOnly && refreshed.capabilities?.assignSpecialists === true)
    return result
  }

  useEffect(() => {
    if (![moduleViews.office, moduleViews.members].includes(view)) return undefined
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

  const persistMembers = async () => {
    setLoadingError('La jerarquía institucional solo se modifica mediante las operaciones verificadas de Alfresco.')
    return false
  }

  if (view === moduleViews.office) {
    return <PanelPage description={`Organiza la jerarquía documental de ${officeName}.`} title="Administrar mi oficina">
      <OfficeHierarchy officeName={officeName} dependency={office?.dependencyId} members={members} specialistUnits={specialistUnits} recipients={recipients} staleCount={staleCount} revision={hierarchyRevision} pendingHeadChanges={pendingHeadChanges} pendingSpecialistReassignments={pendingSpecialistReassignments} units={units} assignments={hierarchyAssignments} alfrescoReadOnly={alfrescoReadOnly} loading={loading} loadingError={loadingError} saving={saving} unitCreationEnabled={unitCreationEnabled} unitEditEnabled={unitEditEnabled} headAssignmentEnabled={headAssignmentEnabled} headChangeEnabled={headChangeEnabled} specialistAssignmentEnabled={specialistAssignmentEnabled} specialistReassignmentEnabled={specialistReassignmentEnabled} creationPending={creationPending} pendingUnitOperation={pendingUnitOperation} creationMessage={creationMessage} creationError={creationError} onCreateUnit={createUnit} onEditUnit={editUnit} onAssignHead={assignHead} onChangeHead={changeHead} onReassignSpecialist={reassignSpecialist} onRefresh={() => loadOffice()} onAddMembers={(laneId, ids, unitHeadUserId) => {
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
      }} onAssignSpecialist={alfrescoReadOnly ? assignSpecialist : (specialistId, unitHeadUserId) => persistMembers(members, { ...specialistUnits, [specialistId]: unitHeadUserId })} onBack={() => setView(moduleViews.home)} />
    </PanelPage>
  }

  if (view === moduleViews.members) {
    return <PanelPage description={`Consulta los miembros asignados de ${officeName}.`} title="Ajustes">
      <AssignedMembersDirectory officeName={officeName} members={members} recipients={recipients} loading={loading} loadingError={loadingError} onRefresh={() => loadOffice()} onBack={() => setView(moduleViews.home)} />
    </PanelPage>
  }

  if (view === moduleViews.timings) {
    return <PanelPage description="Plazos de respuesta institucionales clasificados por prioridad." title="Tiempos de respuesta"><OfficeTimings csrfToken={csrfToken} onBack={() => setView(moduleViews.home)} /></PanelPage>
  }

  return <PanelPage description={`Opciones de organización para ${officeName}.`} title="Ajustes"><SettingsHome officeName={officeName} onOpen={setView} /></PanelPage>
}
