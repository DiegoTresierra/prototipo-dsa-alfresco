import { useEffect, useRef, useState } from 'react'
import { documentPriorities, documentTypes, organizationalUnits, recipientDependencies } from '../data/emisorCatalog'
import { simulatedUser } from '../data/simulatedSession'
import { getCorrelativeStatus } from '../utils/documentStore'
import { SearchableSelect } from './SearchableSelect'

const maxFileSize = 20 * 1024 * 1024
const createToken = () => Date.now() + '-' + Math.random().toString(36).slice(2)
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
export function DocumentForm({ onSubmit, user = simulatedUser, panelLabel = 'Panel de Dirección DTI' }) {
  const issuer = user
  const [dependencyId, setDependencyId] = useState('dsa')
  const [documentType, setDocumentType] = useState('')
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uncertainSubmission, setUncertainSubmission] = useState(false)
  const [resultDocumentId, setResultDocumentId] = useState('')
  const [emissionDate, setEmissionDate] = useState('')
  const [successWarning, setSuccessWarning] = useState('')
  const [mainDocument, setMainDocument] = useState(null)
  const [preview, setPreview] = useState({ url: '', message: 'Selecciona un PDF para ver la vista previa.' })
  const lock = useRef(false)
  const token = useRef(createToken())
  const inputRef = useRef(null)
  const documentYear = String(new Date().getFullYear())
  const recipientUnit = organizationalUnits.find((unit) => unit.id === 'dsa-direccion')
  const directionPosition = recipientUnit.positions.find((position) => position.id === 'dsa-puesto-direccion')
  const selectedDependency = recipientDependencies.find((dependency) => dependency.id === dependencyId)

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    if (!mainDocument) {
      setPreview({ url: '', message: 'Selecciona un PDF para ver la vista previa.' })
      return undefined
    }
    const createPreview = async () => {
      const error = await validatePdf(mainDocument)
      if (cancelled) return
      if (error) {
        setPreview({ url: '', message: error })
        return
      }
      objectUrl = URL.createObjectURL(new Blob([mainDocument], { type: 'application/pdf' }))
      setPreview({ url: objectUrl, message: '' })
    }
    createPreview().catch(() => {
      if (!cancelled) setPreview({ url: '', message: 'No se pudo preparar la vista previa del PDF.' })
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mainDocument])

  let counter = { last: '', next: '' }
  let counterError = ''
  if (documentType) {
    try { counter = getCorrelativeStatus(issuer.acronym, documentType, documentYear) }
    catch { counterError = 'No se pudo leer el correlativo local. No env?es el documento hasta revisar el almacenamiento del navegador.' }
  }

  const unlockAfterEdit = () => {
    if (lock.current && !uncertainSubmission) {
      lock.current = false
      token.current = createToken()
      setSubmitted(false)
      setResultDocumentId('')
      setEmissionDate('')
      setSuccessWarning('')
      setSuccessWarning('')
    }
  }

  const choosePdf = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    unlockAfterEdit()
    const error = await validatePdf(file)
    if (error) {
      setMainDocument(null)
      setFormError(error)
      return
    }
    setMainDocument(file)
    setFormError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (lock.current || !event.currentTarget.reportValidity()) return
    const values = new FormData(event.currentTarget)
    const required = ['documentType', 'priority', 'subject', 'description']
    if (required.some((name) => !String(values.get(name) || '').trim()) || !selectedDependency?.available || !counter.next || !mainDocument) {
      setFormError(counterError || 'Completa los campos obligatorios y selecciona el PDF principal.')
      return
    }
    lock.current = true
    setSubmitting(true)
    setFormError('')
    let result
    try {
      result = await onSubmit({
        submissionToken: token.current,
        destinationId: selectedDependency.id,
        destination: 'Dirección DSA',
        organizationalUnitId: recipientUnit.id,
        organizationalUnit: recipientUnit.name,
        recipientPositionId: directionPosition.id,
        recipientName: directionPosition.recipientName,
        recipientPosition: directionPosition.title,
        recipientFunctionsDescription: directionPosition.functionsDescription,
        documentType,
        originalConsecutive: counter.next,
        documentYear,
        issuingAcronym: issuer.acronym,
        sender: issuer.name,
        senderPosition: issuer.position,
        originatingDependency: issuer.office,
        subject: String(values.get('subject')).trim(),
        priority: values.get('priority'),
        description: String(values.get('description')).trim(),
        attachmentName: mainDocument.name,
        attachmentSize: mainDocument.size,
        attachmentType: 'application/pdf',
        mainDocument: { name: mainDocument.name, format: 'PDF', mimeType: 'application/pdf', size: mainDocument.size },
        mainDocumentFile: mainDocument,
      })
    } catch {
      result = { ok: false, error: 'No se pudo completar el envío a Alfresco.' }
    }
    setSubmitting(false)
    if (!result?.ok) {
      if (result?.uncertain) setUncertainSubmission(true)
      else lock.current = false
      setFormError(result?.error || 'Alfresco no confirmó la creación del documento.')
      return
    }
    setResultDocumentId(result.document.id)
    setEmissionDate(result.document.emissionDate || '')
    setSuccessWarning(result.warning || '')
    setSubmitted(true)
  }

  const options = recipientDependencies.map((dependency) => ({ id: dependency.id, label: dependency.name, disabled: !dependency.available }))
  const numberPreview = documentType && counter.next
    ? documentType.toUpperCase() + ' N.° ' + counter.next + '-' + documentYear + '-' + issuer.acronym
    : 'Selecciona el tipo documental para obtener la vista previa'

  return (
    <section aria-labelledby="document-form-title" className="document-form-page">
      <p className="breadcrumb">{panelLabel}</p>
      <h1 id="document-form-title">Nuevo documento</h1>
      <form className="document-form" noValidate onChange={unlockAfterEdit} onSubmit={handleSubmit}>
        <fieldset className="form-section"><legend>I. Destinatario</legend><div className="form-grid form-grid--recipient">
          <SearchableSelect label="Dependencia destinataria" onChange={setDependencyId} options={options} placeholder="Buscar dependencia" required value={dependencyId} />
          <label className="form-field"><span>Unidad organizacional</span><input readOnly value={dependencyId === 'dsa' ? recipientUnit.name : ''} /></label>
          <label className="form-field"><span>Puesto destinatario</span><input readOnly value={dependencyId === 'dsa' ? directionPosition.title : ''} /></label>
          <aside className="position-description" aria-live="polite"><h2>Destinatario seleccionado</h2><p><strong>{dependencyId === 'dsa' ? directionPosition.recipientName : 'Selecciona DSA'}</strong></p><p>{dependencyId === 'dsa' ? directionPosition.title : 'Dirección DSA'}</p>{dependencyId === 'dsa' && <div className="position-functions"><strong>Funciones del puesto</strong><p>{directionPosition.functionsDescription}</p></div>}</aside>
        </div></fieldset>
        <fieldset className="form-section"><legend>II. Identificación documental</legend><div className="form-grid">
          <label className="form-field"><span>Tipo documental <b aria-hidden="true">*</b></span><select name="documentType" onChange={(event) => setDocumentType(event.target.value)} required value={documentType}><option value="">Selecciona un tipo</option>{documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label className="form-field"><span>Último correlativo del tipo documental</span><input readOnly value={counter.last} /></label>
          <label className="form-field"><span>Correlativo a emitir <b aria-hidden="true">*</b></span><input readOnly required value={counter.next} /></label>
          <label className="form-field"><span>Año documental</span><input readOnly value={documentYear} /></label>
          <label className="form-field"><span>Sigla de oficina emisora</span><input readOnly value={issuer.acronym} /></label>
          <label className="form-field form-field--full"><span>Vista previa del número documental</span><output className="document-number-preview">{numberPreview}</output></label>
        </div>{counterError && <p className="form-message form-message--error" role="alert">{counterError}</p>}</fieldset>
        <fieldset className="form-section"><legend>III. Información del remitente</legend><div className="form-grid">
          <label className="form-field"><span>Remitente</span><input readOnly value={issuer.name} /></label>
          <label className="form-field"><span>Cargo</span><input readOnly value={issuer.position} /></label>
          <label className="form-field form-field--full"><span>Oficina de origen</span><input readOnly value={issuer.office} /></label>
        </div></fieldset>
        <fieldset className="form-section"><legend>IV. Información del documento</legend><div className="form-grid">
          <label className="form-field form-field--full"><span>Asunto <b aria-hidden="true">*</b></span><input autoComplete="off" maxLength="180" name="subject" required /></label>
          <div className="form-field"><span>Fecha de emisión</span><output className="read-only-value">{emissionDate ? new Date(emissionDate).toLocaleString('es-PE') : 'Se asignará al confirmar el envío.'}</output></div>
          <label className="form-field"><span>Prioridad <b aria-hidden="true">*</b></span><select name="priority" required><option value="">Selecciona una prioridad</option>{documentPriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
          <label className="form-field form-field--full"><span>Descripción <b aria-hidden="true">*</b></span><textarea maxLength="2000" name="description" required rows="4" /></label>
        </div></fieldset>
        <fieldset className="form-section"><legend>Documento principal</legend><div className="file-section">
          <input accept="application/pdf,.pdf" hidden onChange={choosePdf} ref={inputRef} type="file" />
          <button className="button-secondary" onClick={() => inputRef.current?.click()} type="button">{mainDocument ? 'Sustituir documento' : 'Subir documento'}</button>
          <p className="file-section__note">El PDF se enviará a la carpeta de pruebas de Alfresco.</p>
          {mainDocument && <div className="selected-file"><strong>{mainDocument.name}</strong><span>PDF · {sizeLabel(mainDocument.size)}</span></div>}
          <div aria-live="polite" className="main-document-preview">{preview.url ? <iframe aria-label={'Vista previa de ' + mainDocument.name} referrerPolicy="no-referrer" sandbox="" src={preview.url} title={'Vista previa de ' + mainDocument.name} /> : <p>{preview.message}</p>}</div>
          {preview.url && <a href={preview.url} rel="noopener noreferrer" target="_blank">Abrir PDF en otra pestaña</a>}
        </div></fieldset>
        <fieldset className="form-section"><legend>Documentos adjuntos</legend><div className="file-section"><p className="file-section__note">La carga de anexos no está habilitada para esta prueba.</p></div></fieldset>
        {formError && <p className="form-message form-message--error" role="alert">{formError}</p>}
        {submitted && <p className="form-message" role="status">Documento enviado correctamente. ID Alfresco: {resultDocumentId}</p>}
        {successWarning && <p className="form-message form-message--error" role="status">{successWarning}</p>}
        {uncertainSubmission && <p className="form-message" role="status">Verifica el resultado en Alfresco antes de volver a intentar.</p>}
        <div className="form-actions"><button className="button-primary" disabled={submitting || submitted || uncertainSubmission || Boolean(counterError)} type="submit">{submitting ? 'Enviando a Alfresco...' : submitted ? 'Envío confirmado' : 'Enviar documento'}</button></div>
      </form>
    </section>
  )
}
