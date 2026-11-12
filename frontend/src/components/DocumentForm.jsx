import { useRef, useState } from 'react'
import { documentPriorities, documentTypes, organizationalUnits, recipientDependencies } from '../data/emisorCatalog'
import { simulatedUser } from '../data/simulatedSession'
import { getCorrelativeStatus } from '../utils/documentStore'
import { PdfPreview } from './PdfPreview'
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
export function DocumentForm({ onSubmit, user = simulatedUser, allowAlfrescoUpload = false, panelLabel = 'Panel de Dirección DTI' }) {
  const issuer = user
  const [dependencyId, setDependencyId] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [selectedPositionId, setSelectedPositionId] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [documentPeriod, setDocumentPeriod] = useState('')
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uncertainSubmission, setUncertainSubmission] = useState(false)
  const [resultDocumentId, setResultDocumentId] = useState('')
  const [emissionDate, setEmissionDate] = useState('')
  const [successWarning, setSuccessWarning] = useState('')
  const [mainDocument, setMainDocument] = useState(null)
  const lock = useRef(false)
  const token = useRef(createToken())
  const inputRef = useRef(null)
  const documentYear = String(new Date().getFullYear())
  const academicPeriods = [`${documentYear} - I`, `${documentYear} - II`]
  const recipientUnits = organizationalUnits.filter((unit) => unit.dependencyId === dependencyId)
  const recipientUnit = recipientUnits.find((unit) => unit.id === selectedUnitId)
  const recipientPositions = recipientUnit?.positions || []
  const directionPosition = recipientPositions.find((position) => position.id === selectedPositionId)
  const selectedDependency = recipientDependencies.find((dependency) => dependency.id === dependencyId)

  let counter = { last: '', next: '' }
  let counterError = ''
  if (documentType) {
    try { counter = getCorrelativeStatus(issuer.issuerCode, documentType, documentYear) }
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
    if (!allowAlfrescoUpload) {
      setFormError('El modo de demostraci\u00f3n no permite enviar documentos a Alfresco.')
      return
    }
    if (lock.current || !event.currentTarget.reportValidity()) return
    const values = new FormData(event.currentTarget)
    const required = ['documentType', 'documentPeriod', 'priority', 'subject', 'description']
    if (required.some((name) => !String(values.get(name) || '').trim()) || !issuer.issuerCode || !selectedDependency?.available || !recipientUnit || !directionPosition || !counter.next || !mainDocument) {
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
        destination: selectedDependency.name,
        organizationalUnitId: recipientUnit.id,
        organizationalUnit: recipientUnit.name,
        recipientPositionId: directionPosition.id,
        recipientName: directionPosition.recipientName,
        recipientPosition: directionPosition.title,
        recipientFunctionsDescription: directionPosition.functionsDescription,
        documentType,
        documentPeriod,
        originalConsecutive: counter.next,
        documentYear,
        issuingAcronym: issuer.acronym,
        issuerCode: issuer.issuerCode,
        issuerUnitAcronym: issuer.unitAcronym,
        issuerPersonCode: issuer.personCode,
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
  const numberPreview = documentType && counter.next && issuer.issuerCode
    ? documentType.toUpperCase() + ' N.° ' + counter.next + '-' + documentYear + '-' + issuer.issuerCode
    : documentType && !issuer.issuerCode
      ? 'Pendiente de asignación del código del emisor'
    : 'Selecciona el tipo documental para obtener la vista previa'

  return (
    <section aria-labelledby="document-form-title" className="document-form-page">
      <p className="breadcrumb">{panelLabel}</p>
      <h1 id="document-form-title">Nuevo documento</h1>
      <form className="document-form" noValidate onChange={unlockAfterEdit} onSubmit={handleSubmit}>
        <fieldset className="form-section"><legend>I. Destinatario</legend><div className="form-grid form-grid--recipient">
          <SearchableSelect label="Dependencia destinataria" onChange={(value) => { setDependencyId(value); setSelectedUnitId(''); setSelectedPositionId('') }} options={options} placeholder="Buscar dependencia" required value={dependencyId} />
          <label className="form-field"><span>Unidad organizacional <b aria-hidden="true">*</b></span><select disabled={!dependencyId} onChange={(event) => { setSelectedUnitId(event.target.value); setSelectedPositionId('') }} required value={selectedUnitId}><option value="">Selecciona una unidad</option>{recipientUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label className="form-field"><span>Puesto destinatario <b aria-hidden="true">*</b></span><select disabled={!selectedUnitId} onChange={(event) => setSelectedPositionId(event.target.value)} required value={selectedPositionId}><option value="">Selecciona un puesto</option>{recipientPositions.map((position) => <option disabled={!position.available} key={position.id} value={position.id}>{position.title}</option>)}</select></label>
          <aside className="position-description" aria-live="polite"><h2>Destinatario seleccionado</h2><p><strong>{directionPosition?.recipientName || selectedDependency?.name || 'Selecciona una dependencia'}</strong></p><p>{directionPosition?.title || ''}</p>{directionPosition && <div className="position-functions"><strong>Funciones del puesto</strong><p>{directionPosition.functionsDescription}</p></div>}</aside>
        </div></fieldset>
        <fieldset className="form-section"><legend>II. Identificación documental</legend><div className="form-grid">
          <label className="form-field"><span>Tipo documental <b aria-hidden="true">*</b></span><select name="documentType" onChange={(event) => setDocumentType(event.target.value)} required value={documentType}><option value="">Selecciona un tipo</option>{documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label className="form-field"><span>Periodo <b aria-hidden="true">*</b></span><select name="documentPeriod" onChange={(event) => setDocumentPeriod(event.target.value)} required value={documentPeriod}><option value="">Selecciona un periodo</option>{academicPeriods.map((period) => <option key={period} value={period}>{period}</option>)}</select></label>
          <label className="form-field"><span>Último correlativo del tipo documental</span><input readOnly value={counter.last} /></label>
          <label className="form-field"><span>Correlativo a emitir <b aria-hidden="true">*</b></span><input readOnly required value={counter.next} /></label>
          <label className="form-field"><span>Año documental</span><input readOnly value={documentYear} /></label>
          <label className="form-field"><span>Sigla de oficina emisora</span><input readOnly value={issuer.acronym} /></label>
          <label className="form-field"><span>Código del emisor</span><input readOnly value={issuer.issuerCode || ''} /></label>
          <label className="form-field form-field--full"><span>Vista previa del número documental</span><output className="document-number-preview">{numberPreview}</output></label>
        </div>{counterError && <p className="form-message form-message--error" role="alert">{counterError}</p>}</fieldset>
        <fieldset className="form-section"><legend>III. Información del remitente</legend><div className="form-grid">
          <label className="form-field"><span>Remitente</span><input readOnly value={issuer.name} /></label>
          <label className="form-field"><span>Cargo</span><input readOnly value={issuer.position} /></label>
          <label className="form-field form-field--full"><span>Oficina de origen</span><input readOnly value={issuer.office} /></label>
          <label className="form-field form-field--full"><span>Unidad de origen</span><input readOnly value={issuer.unitName || ''} /></label>
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
          <p className="file-section__note">{allowAlfrescoUpload ? 'El PDF se enviar\u00e1 a la carpeta de pruebas de Alfresco.' : 'La vista previa est\u00e1 disponible en demostraci\u00f3n; el env\u00edo a Alfresco requiere sesi\u00f3n institucional.'}</p>
          {mainDocument && <div className="selected-file"><strong>{mainDocument.name}</strong><span>PDF · {sizeLabel(mainDocument.size)}</span></div>}
          <div className="main-document-preview">
            <PdfPreview blob={mainDocument} declaredMimeType={mainDocument?.type} emptyMessage="Selecciona un PDF para ver la vista previa." fileName={mainDocument?.name || 'documento.pdf'} />
          </div>
        </div></fieldset>
        <fieldset className="form-section"><legend>Documentos adjuntos</legend><div className="file-section"><p className="file-section__note">La carga de anexos no está habilitada para esta prueba.</p></div></fieldset>
        {formError && <p className="form-message form-message--error" role="alert">{formError}</p>}
        {submitted && <p className="form-message" role="status">Documento enviado correctamente. ID Alfresco: {resultDocumentId}</p>}
        {successWarning && <p className="form-message form-message--error" role="status">{successWarning}</p>}
        {uncertainSubmission && <p className="form-message" role="status">Verifica el resultado en Alfresco antes de volver a intentar.</p>}
        <div className="form-actions"><button className="button-primary" disabled={!allowAlfrescoUpload || submitting || submitted || uncertainSubmission || Boolean(counterError)} type="submit">{submitting ? 'Enviando a Alfresco...' : submitted ? 'Envío confirmado' : 'Enviar documento'}</button></div>
      </form>
    </section>
  )
}
