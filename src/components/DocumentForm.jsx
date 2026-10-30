import { useRef, useState } from 'react'
import { documentPriorities, documentTypes, organizationalUnits, recipientDependencies } from '../data/emisorCatalog'
import { simulatedUser } from '../data/simulatedSession'
import { getCorrelativeStatus } from '../utils/documentStore'
import { SearchableSelect } from './SearchableSelect'

const createSubmissionToken = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

/* eslint-disable react/prop-types */
export function DocumentForm({ onSubmit }) {
  const [dependencyId, setDependencyId] = useState('dsa')
  const [documentType, setDocumentType] = useState('')
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const submissionLocked = useRef(false)
  const submissionToken = useRef(createSubmissionToken())
  const documentYear = String(new Date().getFullYear())
  const recipientUnit = organizationalUnits.find((unit) => unit.id === 'dsa-direccion')
  const directionPosition = recipientUnit.positions.find((position) => position.id === 'dsa-puesto-direccion')
  const selectedDependency = recipientDependencies.find((dependency) => dependency.id === dependencyId)
  let correlativeStatus = { last: '', next: '' }
  let counterError = ''

  if (documentType) {
    try {
      correlativeStatus = getCorrelativeStatus(simulatedUser.acronym, documentType, documentYear)
    } catch {
      counterError = 'No se pudieron leer los contadores locales. No registres el documento hasta revisar el almacenamiento de este navegador.'
    }
  }

  const unlockAfterEdit = () => {
    if (submissionLocked.current) {
      submissionLocked.current = false
      submissionToken.current = createSubmissionToken()
      setSubmitted(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (submissionLocked.current) return
    const form = event.currentTarget
    if (!form.reportValidity()) return

    const formData = new FormData(form)
    const attachment = formData.get('attachment')
    const requiredValues = ['documentType', 'originalConsecutive', 'documentYear', 'issuingAcronym', 'documentDate', 'priority', 'subject', 'folioCount', 'sender', 'senderPosition', 'originatingDependency', 'description']
    const hasMissingValue = requiredValues.some((name) => !String(formData.get(name) ?? '').trim())
    if (hasMissingValue || !selectedDependency?.available || !correlativeStatus.next || !attachment || attachment.size === 0) {
      setFormError(counterError || 'Completa todos los campos obligatorios y selecciona un archivo adjunto.')
      return
    }

    const result = onSubmit({
      submissionToken: submissionToken.current,
      destinationId: selectedDependency.id,
      destination: 'Dirección DSA',
      organizationalUnitId: recipientUnit.id,
      organizationalUnit: recipientUnit.name,
      recipientPositionId: directionPosition.id,
      recipientName: directionPosition.recipientName,
      recipientPosition: directionPosition.title,
      recipientFunctionsDescription: directionPosition.functionsDescription,
      documentType,
      documentYear,
      issuingAcronym: simulatedUser.acronym,
      sender: simulatedUser.name,
      senderPosition: simulatedUser.position,
      originatingDependency: simulatedUser.office,
      documentDate: formData.get('documentDate'),
      subject: formData.get('subject').trim(),
      reference: formData.get('reference').trim(),
      folioCount: Number(formData.get('folioCount')),
      priority: formData.get('priority'),
      description: formData.get('description').trim(),
      attachmentName: attachment.name,
      attachmentSize: attachment.size,
      attachmentType: attachment.type || 'Tipo no informado por el navegador',
    })

    if (!result?.ok) {
      setFormError(result?.error || 'No se pudo guardar el registro simulado.')
      return
    }

    submissionLocked.current = true
    setFormError('')
    setSubmitted(true)
  }

  const dependencyOptions = recipientDependencies.map((dependency) => ({
    id: dependency.id,
    label: dependency.name,
    disabled: !dependency.available,
  }))
  const documentNumberPreview = documentType && correlativeStatus.next
    ? `${documentType.toLocaleUpperCase('es')} N.° ${correlativeStatus.next}-${documentYear}-${simulatedUser.acronym}`
    : 'Selecciona el tipo documental para obtener la vista previa'

  return (
    <section aria-labelledby="document-form-title" className="document-form-page">
      <p className="breadcrumb">Panel del Emisor</p>
      <h1 id="document-form-title">Nuevo documento</h1>
      <form className="document-form" noValidate onChange={unlockAfterEdit} onSubmit={handleSubmit}>
        <fieldset className="form-section">
          <legend>I. Destinatario</legend>
          <div className="form-grid form-grid--recipient">
            <SearchableSelect label="Dependencia destinataria" onChange={setDependencyId} options={dependencyOptions} placeholder="Buscar dependencia" required value={dependencyId} />
            <label className="form-field">
              <span>Unidad organizacional</span>
              <input readOnly value={dependencyId === 'dsa' ? recipientUnit.name : ''} />
            </label>
            <label className="form-field">
              <span>Puesto destinatario</span>
              <input readOnly value={dependencyId === 'dsa' ? directionPosition.title : ''} />
            </label>
            <aside className="position-description" aria-live="polite">
              <h2>Destinatario seleccionado</h2>
              <p><strong>{dependencyId === 'dsa' ? directionPosition.recipientName : 'Selecciona DSA'}</strong></p>
              <p>{dependencyId === 'dsa' ? directionPosition.title : 'Dirección DSA'}</p>
              {dependencyId === 'dsa' && <div className="position-functions"><strong>Funciones del puesto</strong><p>{directionPosition.functionsDescription}</p></div>}
            </aside>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>II. Identificación documental</legend>
          <div className="form-grid">
            <label className="form-field">
              <span>Tipo documental <b aria-hidden="true">*</b></span>
              <select name="documentType" onChange={(event) => setDocumentType(event.target.value)} required value={documentType}>
                <option value="">Selecciona un tipo</option>
                {documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Último correlativo del tipo documental</span>
              <input name="lastConsecutive" readOnly value={correlativeStatus.last} />
            </label>
            <label className="form-field">
              <span>Correlativo a emitir <b aria-hidden="true">*</b></span>
              <input name="originalConsecutive" readOnly required value={correlativeStatus.next} />
            </label>
            <label className="form-field">
              <span>Año documental</span>
              <input name="documentYear" readOnly value={documentYear} />
            </label>
            <label className="form-field">
              <span>Sigla de oficina emisora</span>
              <input name="issuingAcronym" readOnly value={simulatedUser.acronym} />
            </label>
            <label className="form-field form-field--full">
              <span>Vista previa del número documental</span>
              <output className="document-number-preview">{documentNumberPreview}</output>
            </label>
          </div>
          {counterError && <p className="form-message form-message--error" role="alert">{counterError}</p>}
        </fieldset>

        <fieldset className="form-section">
          <legend>III. Información del remitente</legend>
          <div className="form-grid">
            <label className="form-field">
              <span>Remitente</span>
              <input name="sender" readOnly value={simulatedUser.name} />
            </label>
            <label className="form-field">
              <span>Cargo</span>
              <input name="senderPosition" readOnly value={simulatedUser.position} />
            </label>
            <label className="form-field form-field--full">
              <span>Oficina de origen</span>
              <input name="originatingDependency" readOnly value={simulatedUser.office} />
            </label>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>IV. Información y archivo</legend>
          <div className="form-grid">
            <label className="form-field form-field--full">
              <span>Asunto <b aria-hidden="true">*</b></span>
              <input autoComplete="off" maxLength="180" name="subject" onInput={unlockAfterEdit} required />
            </label>
            <label className="form-field">
              <span>Fecha del documento <b aria-hidden="true">*</b></span>
              <input name="documentDate" onInput={unlockAfterEdit} required type="date" />
            </label>
            <label className="form-field">
              <span>Prioridad <b aria-hidden="true">*</b></span>
              <select name="priority" onInput={unlockAfterEdit} required>
                <option value="">Selecciona una prioridad</option>
                {documentPriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Número de folios <b aria-hidden="true">*</b></span>
              <input inputMode="numeric" min="1" name="folioCount" onInput={unlockAfterEdit} required type="number" />
            </label>
            <label className="form-field">
              <span>Referencia documental <small>(opcional)</small></span>
              <input maxLength="180" name="reference" onInput={unlockAfterEdit} />
            </label>
            <label className="form-field form-field--full">
              <span>Descripción <b aria-hidden="true">*</b></span>
              <textarea maxLength="2000" name="description" onInput={unlockAfterEdit} required rows="4" />
            </label>
            <label className="form-field form-field--full">
              <span>Archivo adjunto <b aria-hidden="true">*</b></span>
              <input accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.jpg,.jpeg,.png" name="attachment" onInput={unlockAfterEdit} required type="file" />
            </label>
          </div>
        </fieldset>

        {formError && <p className="form-message form-message--error" role="alert">{formError}</p>}
        {submitted && <p className="form-message" role="status">Documento registrado correctamente.</p>}
        <div className="form-actions"><button className="button-primary" disabled={submitted || Boolean(counterError)} type="submit">{submitted ? 'Envío registrado' : 'Registrar y enviar'}</button></div>
      </form>
    </section>
  )
}
