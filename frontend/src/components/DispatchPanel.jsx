import { useState } from 'react'
import { eligibleDispatchRecipients } from '../utils/dispatchRecipients'

/* eslint-disable react/prop-types */
export function DispatchPanel({ document, recipients = [], allowedRecipientRoles = [], initialRecipientIds = [], assignedUserIds = [], loading, error, onDispatch, originAssignmentId = null }) {
  const eligibleRecipients = eligibleDispatchRecipients(recipients, allowedRecipientRoles)
  const [selectedIds, setSelectedIds] = useState(() => initialRecipientIds.filter((id) => eligibleRecipients.some((recipient) => recipient.id === id)))
  const [instruction, setInstruction] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [requestKey] = useState(() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const toggleRecipient = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const submit = async (event) => {
    event.preventDefault()
    if (confirmed || submitting) return
    const selectedRecipientIds = selectedIds.filter((id) => eligibleRecipients.some((recipient) => recipient.id === id))
    if (!selectedRecipientIds.length || !instruction.trim()) {
      setMessage('Selecciona al menos un destinatario e indica la instrucción del encargo.')
      return
    }
    setSubmitting(true)
    setMessage('')
    try {
      await onDispatch(document.id, selectedRecipientIds, instruction.trim(), priority, requestKey, originAssignmentId)
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
    {!loading && !error && !eligibleRecipients.length && <p className="form-message" role="status">No hay destinatarios habilitados para tu rol y dependencia.</p>}
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
