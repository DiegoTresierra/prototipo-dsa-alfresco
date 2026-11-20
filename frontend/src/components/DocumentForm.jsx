import { useEffect, useRef, useState } from 'react'
import { listEligibleDocumentRecipients } from '../api/alfresco'
import { documentPriorities, documentTypes, recipientDependencies } from '../data/emisorCatalog'
import { PdfPreview } from './PdfPreview'
import { SearchableSelect } from './SearchableSelect'
import { getDocumentSubmissionError, isDirectorRole } from '../utils/documentValidation'

const maxFileSize = 20 * 1024 * 1024
const createToken = () => globalThis.crypto.randomUUID()
function extensionOf(name) { return name.split('.').pop()?.toLowerCase() || '' }
function sizeLabel(size) { return size < 1024 * 1024 ? Math.max(1, Math.round(size / 1024)) + ' KB' : (size / (1024 * 1024)).toFixed(2) + ' MB' }

async function validatePdf(file) {
  if (extensionOf(file.name) !== 'pdf') return 'Selecciona un archivo PDF.'
  if (file.type && file.type.toLowerCase() !== 'application/pdf') return 'El tipo MIME del archivo no es PDF.'
  if (!file.size || file.size > maxFileSize) return 'El archivo debe tener contenido y no superar 20 MB.'
  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  return String.fromCharCode(...signature) === '%PDF-' ? '' : 'El contenido no tiene una firma PDF válida.'
}

/* eslint-disable react/prop-types */
export function DocumentForm({ onSubmit, user, allowAlfrescoUpload = false, panelLabel = 'Panel de Dirección' }) {
  const issuer = user
  const pendingStorageKey = `uac.pending-delivery.${issuer.userId}`
  const [restoredDelivery] = useState(() => {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(pendingStorageKey))
      return stored?.uncertain === true ? stored : null
    } catch { return null }
  })
  const isDirector = isDirectorRole(issuer.roleId)
  const restoredParameters = restoredDelivery?.officialParameters || {}
  const [dependencyId, setDependencyId] = useState(restoredParameters.recipientDependencyId || '')
  const [selectedPositionId, setSelectedPositionId] = useState(restoredParameters.recipientPositionId || '')
  const [documentType, setDocumentType] = useState(restoredParameters.documentType || '')
  const [documentPeriod, setDocumentPeriod] = useState(restoredParameters.documentPeriod || '')
  const [reservedNumber, setReservedNumber] = useState('')
  const [confirmedNumbering, setConfirmedNumbering] = useState(null)
  const [recipients, setRecipients] = useState([])
  const [recipientsLoading, setRecipientsLoading] = useState(!isDirector)
  const [recipientsError, setRecipientsError] = useState('')
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uncertainSubmission, setUncertainSubmission] = useState(Boolean(restoredDelivery))
  const [resultDocumentId, setResultDocumentId] = useState('')
  const [emissionDate, setEmissionDate] = useState('')
  const [successWarning, setSuccessWarning] = useState('')
  const [mainDocument, setMainDocument] = useState(null)
  const [validatingPdf, setValidatingPdf] = useState(false)
  const [attachments, setAttachments] = useState([])
  const lock = useRef(false)
  const pendingDelivery = useRef(restoredDelivery)
  const [pendingNodeId, setPendingNodeId] = useState(restoredDelivery?.existingNodeId || '')
  const [recoveryNodeId, setRecoveryNodeId] = useState('')
  const rememberPending = (payload, nodeId = '') => {
    try {
      const previous = JSON.parse(window.sessionStorage.getItem(pendingStorageKey) || 'null')
      const requestKey = payload.submissionToken || payload.requestKey || ''
      const originalParameters = previous?.official && previous.requestKey === requestKey ? previous.officialParameters : null
      window.sessionStorage.setItem(pendingStorageKey, JSON.stringify({
        uncertain: true,
        official: payload.officialEmission === true,
        requestKey,
        officialParameters: payload.officialEmission ? originalParameters || Object.fromEntries(['recipientDependencyId', 'recipientUnitId', 'recipientPositionId', 'documentType', 'documentPeriod', 'subject', 'description', 'priority'].map((key) => [key, payload[key]])) : undefined,
        existingNodeId: nodeId,
        recipientDependencyId: payload.recipientDependencyId,
        receiptCategory: payload.receiptCategory,
      }))
    } catch { /* The visible ID still permits manual reconciliation. */ }
  }
  const clearPending = () => {
    try { window.sessionStorage.removeItem(pendingStorageKey) } catch { /* storage may be unavailable */ }
  }
  const token = useRef(restoredDelivery?.requestKey || createToken())
  const officialPending = isDirector && (pendingDelivery.current?.officialEmission === true || restoredDelivery?.official === true)
  const inputRef = useRef(null)
  const attachmentsInputRef = useRef(null)
  const documentYear = String(new Date().getFullYear())
  const academicPeriods = [...new Set([`${documentYear} - I`, `${documentYear} - II`, ...(restoredParameters.documentPeriod ? [restoredParameters.documentPeriod] : [])])]
  const selectedDependency = recipientDependencies.find((dependency) => dependency.id === dependencyId)
  const dependencyRecipients = recipients.filter((recipient) => recipient.dependency === dependencyId)
  const selectedRecipient = dependencyRecipients.find((recipient) => recipient.id === selectedPositionId) || null
  const recipientUnit = selectedRecipient?.unit || null
  const directionPosition = isDirector && selectedDependency ? { id: 'direccion', title: 'Dirección', recipientName: selectedDependency.name, available: true }
    : selectedRecipient ? { id: selectedRecipient.id, title: selectedRecipient.functionalRole, recipientName: selectedRecipient.displayName, available: true } : null

  const counter = { last: '', next: reservedNumber }
  const counterError = ''

  useEffect(() => {
    if (isDirector) return undefined
    let active = true
    listEligibleDocumentRecipients()
      .then((entries) => { if (active) setRecipients(entries) })
      .catch((error) => { if (active) setRecipientsError(error.message) })
      .finally(() => { if (active) setRecipientsLoading(false) })
    return () => { active = false }
  }, [isDirector])

  const unlockAfterEdit = () => {
    if (lock.current && !uncertainSubmission) {
      lock.current = false
      token.current = createToken()
      setSubmitted(false)
      setResultDocumentId('')
      setEmissionDate('')
      setSuccessWarning('')
      setReservedNumber('')
      setConfirmedNumbering(null)
    }
  }

  const choosePdf = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    unlockAfterEdit()
    setValidatingPdf(true)
    setMainDocument(null)
    try {
      const error = await validatePdf(file)
      if (error) {
        setFormError(error)
        return
      }
      setMainDocument(file)
      setFormError('')
    } catch {
      setFormError('No se pudo leer el PDF seleccionado. Vuelve a seleccionarlo.')
    } finally {
      setValidatingPdf(false)
    }
  }

  const chooseAttachments = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    unlockAfterEdit()
    const checkedFiles = await Promise.all(files.map(async (file) => ({ file, error: await validatePdf(file) })))
    const validFiles = checkedFiles.filter(({ error }) => !error).map(({ file }) => file)
    const firstError = checkedFiles.find(({ error }) => error)?.error
    setAttachments((current) => {
      const existing = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
      return [...current, ...validFiles.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))]
    })
    setFormError(firstError || '')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!allowAlfrescoUpload) {
      setFormError('El envío no está disponible en este momento.')
      return
    }
    if (submitting || validatingPdf) return
    // A pending delivery must reuse its node, even when the restored form is empty.
    if (uncertainSubmission && !officialPending) {
      const nodeId = pendingNodeId || recoveryNodeId.trim()
      if (!isDirector || !/^[a-zA-Z0-9-]+$/.test(nodeId)) {
        setFormError('El envío anterior quedó pendiente. Introduce el ID del PDF que está en Emitidos para reintentar su distribución sin volver a cargarlo.')
        return
      }
      await retryDelivery(nodeId)
      return
    }
    if (lock.current || !event.currentTarget.reportValidity()) return
    const values = new FormData(event.currentTarget)
    const validationError = getDocumentSubmissionError({
      fields: { documentType, documentPeriod, priority: values.get('priority'), subject: values.get('subject'), description: values.get('description') },
      issuer, dependency: selectedDependency, unit: recipientUnit, position: directionPosition,
      recipient: selectedRecipient, counter: { ...counter, next: counter.next || 'pending' }, counterError, counterPending: !reservedNumber, mainDocument,
    })
    if (validationError) {
      setFormError(validationError)
      return
    }
    if (attachments.length) {
      setFormError('Los adjuntos están seleccionados localmente, pero su envío asociado a Alfresco aún no está habilitado. Retíralos para enviar solo el documento principal.')
      return
    }
    lock.current = true
    setSubmitting(true)
    setFormError('')
    let result
    try {
      const payload = {
        submissionToken: token.current,
        officialEmission: isDirector,
        destinationId: selectedDependency.id,
        destination: selectedDependency.name,
        recipientDependencyId: selectedDependency.id,
        recipientUserId: selectedRecipient?.id || '',
        recipientName: directionPosition.recipientName,
        recipientRole: directionPosition.title,
        recipientUnit: recipientUnit?.name || '',
        recipientUnitId: recipientUnit?.id || '',
        recipientPositionId: directionPosition.id,
        recipientInboxNodeId: selectedRecipient?.inboxNodeId || '',
        receiptCategory: isDirector ? 'por-atender' : '',
        documentType,
        documentPeriod,
        originalConsecutive: '',
        documentYear,
        issuingAcronym: issuer.acronym,
        issuerCode: issuer.issuerCode,
        issuerUnitAcronym: issuer.unitAcronym,
        sender: issuer.name,
        senderPosition: issuer.position,
        originatingDependency: issuer.office,
        originatingUnit: issuer.unitName,
        subject: String(values.get('subject')).trim(),
        priority: values.get('priority'),
        description: String(values.get('description')).trim(),
        attachmentName: mainDocument.name,
        attachmentSize: mainDocument.size,
        attachmentType: 'application/pdf',
        mainDocument: { name: mainDocument.name, format: 'PDF', mimeType: 'application/pdf', size: mainDocument.size },
        mainDocumentFile: mainDocument,
      }
      pendingDelivery.current = payload
      // Preserve an uncertain operation before the request, including reloads in flight.
      rememberPending(payload)
      result = await onSubmit(payload)
    } catch (error) {
      result = { ok: false, error: error.message || 'No se pudo completar el envío a Alfresco.' }
    }
    setSubmitting(false)
    if (!result?.ok) {
      if (result?.emittedNodeId) setPendingNodeId(result.emittedNodeId)
      if (result?.uncertain || (uncertainSubmission && officialPending)) {
        setUncertainSubmission(true)
        if (isDirector) lock.current = false
        rememberPending(pendingDelivery.current, result.emittedNodeId)
      }
      else {
        lock.current = false
        clearPending()
      }
      setFormError(result?.error || 'Alfresco no confirmó la creación del documento.')
      return
    }
    setUncertainSubmission(false)
    setReservedNumber(result.document.originalConsecutive || '')
    setConfirmedNumbering({ code: result.document.issuerCode, cycle: result.document.documentYear, number: result.document.originalConsecutive })
    setResultDocumentId(result.document.id)
    setEmissionDate(result.document.emissionDate || '')
    setSuccessWarning(result.warning || '')
    setSubmitted(true)
    clearPending()
  }

  const retryDelivery = async (nodeId = pendingNodeId) => {
    if (!allowAlfrescoUpload || submitting || !nodeId || !pendingDelivery.current) return
    const payload = pendingDelivery.current
    if (!payload.recipientDependencyId || !payload.receiptCategory) {
      setFormError('No se conservó el destino del envío anterior. Es necesario revisar ese envío antes de distribuirlo.')
      return
    }
    setPendingNodeId(nodeId)
    rememberPending(payload, nodeId)
    setSubmitting(true)
    try {
      const result = await onSubmit({ ...payload, existingNodeId: nodeId })
      if (!result?.ok) {
        setFormError(result?.error || 'No se pudo confirmar la distribución. El PDF conserva su ID.')
        return
      }
      setResultDocumentId(result.document.id)
      setEmissionDate(result.document.emissionDate || '')
      setSuccessWarning(result.warning || '')
      setSubmitted(true)
      setUncertainSubmission(false)
      setPendingNodeId('')
      setFormError('')
      clearPending()
    } catch {
      setFormError('No se pudo confirmar la distribución. Puedes reintentar usando el mismo ID.')
    } finally {
      setSubmitting(false)
    }
  }

  const options = recipientDependencies.map((dependency) => ({ id: dependency.id, label: dependency.name, disabled: !dependency.available }))
  const numberPreview = confirmedNumbering?.number && confirmedNumbering.code && confirmedNumbering.cycle
    ? `${documentType.toLocaleUpperCase('es')} N.° ${confirmedNumbering.number}-${confirmedNumbering.cycle}-${confirmedNumbering.code}`
    : 'Se confirma con los datos registrados por Alfresco al emitir'

  return (
    <section aria-labelledby="document-form-title" className="document-form-page">
      <p className="breadcrumb">{panelLabel}</p>
      <h1 id="document-form-title">Nuevo documento</h1>
      <form className="document-form" noValidate onChange={unlockAfterEdit} onSubmit={handleSubmit}>
        <fieldset className="form-section"><legend>I. Destinatario</legend><div className="form-grid form-grid--recipient">
          <SearchableSelect label="Dependencia destinataria" onChange={(value) => { unlockAfterEdit(); setDependencyId(value); setSelectedPositionId('') }} options={options} placeholder="Buscar dependencia" required value={dependencyId} />
          {!isDirector && <label className="form-field"><span>Cuenta destinataria</span><select disabled={!dependencyId || recipientsLoading} onChange={(event) => { unlockAfterEdit(); setSelectedPositionId(event.target.value) }} required value={selectedPositionId}><option value="">Selecciona una cuenta verificada</option>{dependencyRecipients.map((recipient) => <option disabled={!recipient.inboxNodeId} key={recipient.id} value={recipient.id}>{recipient.displayName} · {recipient.id} · {recipient.functionalRole}</option>)}</select></label>}
          <aside className="position-description" aria-live="polite"><h2>Destinatario seleccionado</h2><p><strong>{directionPosition?.recipientName || 'Selecciona una dependencia'}</strong></p><p>{directionPosition?.title || ''}</p>{!isDirector && <p>Unidad y código institucional pendientes de verificación. El organigrama provisional no acredita subordinación.</p>}</aside>
          {recipientsError && !isDirector && <p className="form-message form-message--error" role="alert">{recipientsError}</p>}
          {!recipientsLoading && !recipientsError && !isDirector && recipients.length === 0 && <p className="form-message" role="status">No hay destinatarios habilitados con bandeja configurada.</p>}
        </div></fieldset>

        <fieldset className="form-section"><legend>II. Identificación documental</legend><p className="form-message">El tipo documental se registra en Alfresco. La prioridad documental y el período académico aún no tienen propiedades verificadas: no se conservan como metadatos documentales y son opcionales en la carga genérica. La prioridad del despacho se registra por separado en sus asignaciones.</p><div className="form-grid">
          <label className="form-field"><span>Tipo documental <b aria-hidden="true">*</b></span><select name="documentType" onChange={(event) => { unlockAfterEdit(); setDocumentType(event.target.value) }} required value={documentType}><option value="">Selecciona un tipo</option>{documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label className="form-field"><span>Periodo {isDirector && <b aria-hidden="true">*</b>}</span><select name="documentPeriod" onChange={(event) => { unlockAfterEdit(); setDocumentPeriod(event.target.value) }} required={isDirector} value={documentPeriod}><option value="">Selecciona un periodo</option>{academicPeriods.map((period) => <option key={period} value={period}>{period}</option>)}</select></label>
          <label className="form-field"><span>Último correlativo institucional</span><input readOnly value={counter.last || 'Se consulta al confirmar'} /></label>
          <label className="form-field"><span>Correlativo a emitir</span><input readOnly value={counter.next} placeholder="Se asignará al confirmar" /></label>
          <label className="form-field"><span>Ciclo documental</span><input readOnly value={confirmedNumbering?.cycle || 'Se determina al emitir'} /></label>
          <label className="form-field"><span>Sigla de oficina emisora</span><input readOnly value={issuer.acronym} /></label>
          <label className="form-field"><span>Código del emisor</span><input placeholder="Pendiente de asignación" readOnly value={issuer.issuerCode || ''} /></label>
          <label className="form-field form-field--full"><span>Vista previa del número documental</span><output className="document-number-preview">{numberPreview}</output></label>
        </div>{counterError && <p className="form-message form-message--error" role="alert">{counterError}</p>}</fieldset>

        <fieldset className="form-section"><legend>III. Información del remitente</legend><div className="form-grid">
          <label className="form-field"><span>Remitente</span><input readOnly value={issuer.name} /></label>
          <label className="form-field"><span>Cargo</span><input readOnly value={issuer.position} /></label>
          <label className="form-field form-field--full"><span>Oficina de origen</span><input readOnly value={issuer.office} /></label>
          {!['director', 'director-dti', 'director-dsa'].includes(issuer.roleId) && <label className="form-field form-field--full"><span>Unidad de origen</span><input readOnly value={issuer.unitName || ''} /></label>}
        </div></fieldset>

        <fieldset className="form-section"><legend>IV. Información del documento</legend><div className="form-grid">
          <label className="form-field form-field--full"><span>Asunto <b aria-hidden="true">*</b></span><input autoComplete="off" defaultValue={restoredParameters.subject || ''} maxLength="180" name="subject" required /></label>
          <div className="form-field"><span>Fecha de emisión</span><output className="read-only-value">{emissionDate ? new Date(emissionDate).toLocaleString('es-PE') : 'Se asignará al confirmar el envío.'}</output></div>
          <label className="form-field"><span>Prioridad {isDirector && <b aria-hidden="true">*</b>}</span><select defaultValue={restoredParameters.priority || ''} name="priority" required={isDirector}><option value="">Selecciona una prioridad</option>{documentPriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
          <label className="form-field form-field--full"><span>Descripción <b aria-hidden="true">*</b></span><textarea defaultValue={restoredParameters.description || ''} maxLength="2000" name="description" required rows="4" /></label>
        </div></fieldset>

        <fieldset className="form-section"><legend>Documento principal</legend><div className="file-section">
          <input accept="application/pdf,.pdf" hidden onChange={choosePdf} ref={inputRef} type="file" />
          <button className="button-secondary" onClick={() => inputRef.current?.click()} type="button">{mainDocument ? 'Sustituir documento' : 'Subir documento'}</button>
          {mainDocument && <div className="selected-file"><strong>{mainDocument.name}</strong><span>PDF · {sizeLabel(mainDocument.size)}</span></div>}
          <div className="main-document-preview"><PdfPreview blob={mainDocument} declaredMimeType={mainDocument?.type} emptyMessage="Selecciona un PDF para ver la vista previa." fileName={mainDocument?.name || 'documento.pdf'} /></div>
        </div></fieldset>

        <fieldset className="form-section"><legend>Documentos adjuntos</legend><div className="file-section">
          <input accept="application/pdf,.pdf" hidden multiple onChange={chooseAttachments} ref={attachmentsInputRef} type="file" />
          <button className="button-secondary" onClick={() => attachmentsInputRef.current?.click()} type="button">Seleccionar documentos adjuntos</button>
          {attachments.length > 0 && <ul aria-label="Documentos adjuntos seleccionados" className="attachment-list">{attachments.map((file) => <li className="attachment-list__item" key={`${file.name}:${file.size}:${file.lastModified}`}><span className="attachment-list__details"><strong>{file.name}</strong><small>{sizeLabel(file.size)}</small></span><button aria-label={`Quitar ${file.name}`} className="button-secondary button-remove-file" onClick={() => { unlockAfterEdit(); setAttachments((current) => current.filter((entry) => entry !== file)) }} type="button">Quitar</button></li>)}</ul>}
        </div></fieldset>
        {formError && <p className="form-message form-message--error" role="alert">{formError}</p>}
        {submitted && <p className="form-message" role="status">Documento enviado correctamente. ID Alfresco: {resultDocumentId}</p>}
        {successWarning && <p className="form-message form-message--error" role="status">{successWarning}</p>}
        {uncertainSubmission && !officialPending && isDirector && <p className="form-message" role="status">Hay un envío anterior pendiente. Puedes reintentar su distribución usando el mismo PDF de Emitidos, sin completar nuevamente el formulario.</p>}
        {uncertainSubmission && !isDirector && <p className="form-message" role="alert">Carga genérica pendiente de verificación en la carpeta destinataria. No vuelvas a cargar el PDF antes de revisar el resultado. ID Alfresco: {pendingNodeId || 'no confirmado'}</p>}
        {uncertainSubmission && !officialPending && !pendingNodeId && isDirector && <label className="form-field"><span>ID del PDF que ya está en Emitidos</span><input autoComplete="off" onChange={(event) => setRecoveryNodeId(event.target.value)} placeholder="Pega el ID Alfresco del documento existente" value={recoveryNodeId} /></label>}
        {uncertainSubmission && officialPending && <p className="form-message" role="alert">Emision pendiente de conciliacion. Conserva la misma clave y vuelve a seleccionar el mismo PDF y los mismos datos. No crees otra emision. Clave: {token.current}</p>}
        {pendingNodeId && isDirector && <p className="form-message" role="status">PDF almacenado en Emitidos. Distribución pendiente. ID Alfresco: {pendingNodeId}</p>}
        <div className="form-actions"><button className="button-primary" disabled={!allowAlfrescoUpload || validatingPdf || submitting || submitted || uncertainSubmission && !isDirector} type="submit">{validatingPdf ? 'Validando PDF...' : submitting ? 'Procesando envío...' : submitted ? 'Envío confirmado' : uncertainSubmission ? !isDirector ? 'Carga pendiente de verificación' : officialPending ? 'Conciliar emisión pendiente' : 'Reintentar solo la distribución' : 'Enviar documento'}</button></div>
      </form>
    </section>
  )
}
