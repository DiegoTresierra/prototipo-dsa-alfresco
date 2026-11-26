import { operationKey } from '../utils/operationKey'
import { useRef, useState } from 'react'
import { eligibleDispatchRecipients } from '../utils/dispatchRecipients'

/* eslint-disable react/prop-types */
export function DispatchPanel({ document, recipients = [], allowedRecipientRoles = [], initialRecipientIds = [], assignedUserIds = [], loading, error, onDispatch, originAssignmentId = null, directory = {} }) {
  const { requiresUnit = false, units = [], hierarchyRevision } = directory
  const [selectedUnit, setSelectedUnit] = useState(null)
  const staleUnit = requiresUnit && selectedUnit && selectedUnit.revision !== hierarchyRevision
  const unit = requiresUnit && !staleUnit ? units.find((item) => item.id === selectedUnit?.id) : null
  const eligibleRecipients = eligibleDispatchRecipients(
    requiresUnit ? recipients.filter((recipient) => unit && recipient.unit?.id === unit.id) : recipients,
    allowedRecipientRoles,
  )
  const [selectedIds, setSelectedIds] = useState(() => initialRecipientIds.filter((id) => eligibleRecipients.some((recipient) => recipient.id === id)))
  const [instruction, setInstruction] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const requestKey = useRef(null)
  const toggleRecipient = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const chooseUnit = (id) => {
    setSelectedUnit(id ? { id, revision: hierarchyRevision } : null)
    setSelectedIds([])
    setMessage('')
  }
  const submit = async (event) => {
    event.preventDefault()
    if (confirmed || submitting || loading || error || requiresUnit && !unit) return
    const selectedRecipientIds = selectedIds.filter((id) => eligibleRecipients.some((recipient) => recipient.id === id))
    if (!selectedRecipientIds.length || !instruction.trim()) {
      setMessage('Selecciona al menos un destinatario e indica la instrucción del encargo.')
      return
    }
    setSubmitting(true)
    setMessage('')
    try {
      const destination = requiresUnit ? { unitId: unit.id, hierarchyRevision: selectedUnit.revision } : undefined
      await onDispatch(document.id, selectedRecipientIds, instruction.trim(), priority, requestKey.current ||= operationKey(), originAssignmentId, destination)
      setConfirmed(true)
      setMessage('Derivación registrada. Cada destinatario conserva su propio encargo sobre el documento original.')
    } catch (dispatchError) {
      setMessage(dispatchError.message)
    } finally {
      setSubmitting(false)
    }
  }
  const disabled = submitting || confirmed
  return <form className="dispatch-panel" onSubmit={submit}>
    <h3>Derivar documento</h3>
    <p>Documento: <strong>{document.subject || document.attachmentName}</strong></p>
    {loading && <p className="form-message" role="status">Consultando destinatarios autorizados...</p>}
    {error && <p className="form-message form-message--error" role="alert">{error}</p>}
    {requiresUnit && <label className="form-field">
      <span>Unidad organizacional</span>
      <select disabled={disabled || loading || Boolean(error) || !units.length} onChange={(event) => chooseUnit(event.target.value)} required value={unit?.id || ''}>
        <option value="">Selecciona una unidad</option>
        {units.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ' · ' + item.code : ''}</option>)}
      </select>
    </label>}
    {!loading && !error && staleUnit && <p className="form-message" role="status">La jerarquía cambió. Vuelve a seleccionar la unidad y el destinatario.</p>}
    {!loading && !error && requiresUnit && !units.length && <p className="form-message" role="status">Tu dependencia aún no tiene unidades activas.</p>}
    {!loading && !error && (!requiresUnit || unit) && !eligibleRecipients.length && <p className="form-message" role="status">
      {requiresUnit ? 'Esta unidad no tiene responsables habilitados.' : 'No hay destinatarios habilitados para tu rol y dependencia.'}
    </p>}
    <fieldset className="dispatch-panel__recipients" disabled={disabled}><legend>Destinatarios equivalentes</legend>{eligibleRecipients.map((recipient) => <label className="dispatch-panel__recipient" key={recipient.id}>
      <input checked={selectedIds.includes(recipient.id)} onChange={() => toggleRecipient(recipient.id)} type="checkbox" />
      <span><strong>{recipient.displayName}</strong><small>{recipient.functionalRole === 'jefe-unidad' ? 'Jefatura' : 'Especialista'} · {recipient.unit?.name || recipient.dependency?.toUpperCase()}{assignedUserIds.includes(recipient.id) ? ' — Ya asignado' : ''}</small></span>
    </label>)}</fieldset>
    <label className="form-field"><span>Instrucción de atención</span><textarea disabled={disabled} maxLength="2000" onChange={(event) => setInstruction(event.target.value)} required rows="3" value={instruction} /></label>
    <label className="form-field"><span>Prioridad</span><select disabled={disabled} onChange={(event) => setPriority(event.target.value)} value={priority}><option>Normal</option><option>Alta</option><option>Urgente</option></select></label>
    {message && <p className="form-message" role="status">{message}</p>}
    <button className="button-primary" disabled={disabled || loading || Boolean(error) || !eligibleRecipients.length} type="submit">{submitting ? 'Registrando...' : confirmed ? 'Derivación registrada' : 'Confirmar derivación'}</button>
  </form>
}
