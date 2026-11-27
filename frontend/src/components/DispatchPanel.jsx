import { reconcileDispatch } from '../api/alfresco'
import { pendingDispatch, reserveDispatch, releaseDispatch, receiptMatches } from '../utils/dispatchAttempts'
import { operationKey } from '../utils/operationKey'
import { useEffect, useRef, useState } from 'react'
import { eligibleDispatchRecipients } from '../utils/dispatchRecipients'

/* eslint-disable react/prop-types */
export function DispatchPanel({ actorId, document, recipients = [], allowedRecipientRoles = [], initialRecipientIds = [], assignedUserIds = [], loading, error, onDispatch, originAssignmentId = null, directory = {} }) {
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
  const [phase, setPhase] = useState('LOADING')
  const [payload, setPayload] = useState(null)
  const [message, setMessage] = useState('')
  const busy = useRef(false)
  useEffect(() => {
    let active = true
    setPhase('LOADING')
    pendingDispatch(actorId, document.id).then(saved => {
      if (active) { setPayload(saved); setPhase(saved ? 'PENDING' : 'IDLE') }
    }).catch(() => { if (active) setPhase('UNAVAILABLE') })
    return () => { active = false }
  }, [actorId, document.id])
  const confirm = async (intent, receipt) => {
    if (!receiptMatches(actorId, intent, receipt)) throw new Error('El registro no confirma este intento.')
    await releaseDispatch(actorId, intent)
    setPhase('CONFIRMED')
    setMessage('Derivación registrada: ' + receipt.id)
    window.dispatchEvent(new Event('uac:alfresco-document-created'))
  }
  const verify = async () => {
    if (busy.current || !payload) return
    busy.current = true
    setPhase('VERIFYING')
    try { await confirm(payload, await reconcileDispatch(payload)) }
    catch {
      setPhase('PENDING')
      setMessage('No se pudo acreditar el resultado. Se mantiene el bloqueo.')
    } finally { busy.current = false }
  }
  const toggleRecipient = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const chooseUnit = (id) => {
    if (phase !== 'IDLE' || busy.current) return
    setSelectedUnit(id ? { id, revision: hierarchyRevision } : null)
    setSelectedIds([])
    setMessage('')
  }
  const submit = async (event) => {
    event.preventDefault()
    if (busy.current || phase !== 'IDLE' || !actorId || loading || error || requiresUnit && !unit) return
    const selectedRecipientIds = selectedIds.filter((id) => eligibleRecipients.some((recipient) => recipient.id === id))
    if (!selectedRecipientIds.length || !instruction.trim()) {
      setMessage('Selecciona al menos un destinatario e indica la instrucción del encargo.')
      return
    }
    busy.current = true
    setMessage('')
    setPhase('SENDING')
    let intent
    try {
      intent = { documentId: document.id, recipientUserIds: selectedRecipientIds, instruction: instruction.trim(),
        priority, requestKey: operationKey(), originAssignmentId,
        ...(requiresUnit ? { unitId: unit.id, hierarchyRevision: selectedUnit.revision } : {}) }
      await reserveDispatch(actorId, intent)
    } catch {
      try {
        const saved = await pendingDispatch(actorId, document.id)
        setPayload(saved)
        setPhase(saved ? 'PENDING' : 'UNAVAILABLE')
      } catch { setPhase('UNAVAILABLE') }
      busy.current = false
      return
    }
    setPayload(intent)
    try {
      await confirm(intent, await onDispatch(intent))
    } catch (failure) {
      setPhase('UNCERTAIN')
      if (failure.rejectedBeforeWrite) {
        try {
          await releaseDispatch(actorId, intent)
          setPayload(null)
          setPhase('IDLE')
          setMessage(failure.message)
        } catch { setPhase('PENDING') }
      }
    } finally { busy.current = false }
  }
  const disabled = phase !== 'IDLE'
  const submitting = phase === 'SENDING'
  const confirmed = phase === 'CONFIRMED'
  const unresolved = ['UNCERTAIN', 'PENDING', 'VERIFYING'].includes(phase)
  return <form className="dispatch-panel" onSubmit={submit}>
    <h3>Derivar documento</h3>
    <p>Documento: <strong>{document.subject || document.attachmentName}</strong></p>
    {loading && <p className="form-message" role="status">Consultando destinatarios autorizados...</p>}
    {error && <p className="form-message form-message--error" role="alert">{error}</p>}
    {requiresUnit && <label className="form-field">
      <span>Unidad organizacional</span>
      <select disabled={disabled || loading || Boolean(error) || !units.length} onChange={(event) => chooseUnit(event.target.value)} required value={(unresolved ? payload.unitId : unit?.id) || ''}>
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
      <input checked={(unresolved ? payload.recipientUserIds : selectedIds).includes(recipient.id)} onChange={() => toggleRecipient(recipient.id)} type="checkbox" />
      <span><strong>{recipient.displayName}</strong><small>{recipient.functionalRole === 'jefe-unidad' ? 'Jefatura' : 'Especialista'} · {recipient.unit?.name || recipient.dependency?.toUpperCase()}{assignedUserIds.includes(recipient.id) ? ' — Ya asignado' : ''}</small></span>
    </label>)}</fieldset>
    <label className="form-field"><span>Instrucción de atención</span><textarea disabled={disabled} maxLength="2000" onChange={(event) => setInstruction(event.target.value)} required rows="3" value={unresolved ? payload.instruction : instruction} /></label>
    <label className="form-field"><span>Prioridad</span><select disabled={disabled} onChange={(event) => setPriority(event.target.value)} value={unresolved ? payload.priority : priority}><option>Normal</option><option>Alta</option><option>Urgente</option></select></label>
    {phase === 'UNAVAILABLE' && <p role="alert">No se puede verificar el registro local del intento. Solicita conciliación antes de enviar.</p>}
    {unresolved && <div role="status"><p>Resultado pendiente de verificación. El envío y la edición están bloqueados.</p>
      <p>Clave de conciliación: <code>{payload.requestKey}</code></p>
      <p>Destinatarios del intento: {payload.recipientUserIds.join(', ')}</p>
      {payload.unitId && <p>Unidad del intento: {payload.unitId}</p>}
      <button type="button" disabled={phase === 'VERIFYING'} onClick={verify}>Verificar despacho</button></div>}
    {message && <p className="form-message" role="status">{message}</p>}
    <button className="button-primary" disabled={disabled || loading || Boolean(error) || !eligibleRecipients.length} type="submit">{submitting ? 'Registrando...' : confirmed ? 'Derivación registrada' : 'Confirmar derivación'}</button>
  </form>
}
