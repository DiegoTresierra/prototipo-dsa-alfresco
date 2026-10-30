import { useRef, useState } from 'react'
import { organizationalUnits } from '../data/emisorCatalog'

const emptySpecialists = []

/* eslint-disable react/prop-types */
export function DocumentForm({ onSubmit }) {
  const [unitId, setUnitId] = useState('')
  const [specialistId, setSpecialistId] = useState('')
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const submissionLocked = useRef(false)
  const currentUnit = organizationalUnits.find((unit) => unit.id === unitId)
  const specialists = currentUnit?.specialists || emptySpecialists
  const selectedSpecialist = specialists.find((specialist) => specialist.id === specialistId)

  const handleUnitChange = (event) => {
    setUnitId(event.target.value)
    setSpecialistId('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (submissionLocked.current) return

    const form = event.currentTarget
    if (!form.reportValidity()) return

    const formData = new FormData(form)
    const file = formData.get('attachment')
    if (!unitId || !selectedSpecialist || !file || file.size === 0) {
      setFormError('Completa los campos obligatorios e incorpora un archivo adjunto.')
      return
    }

    submissionLocked.current = true
    setFormError('')
    setSubmitted(true)
    onSubmit({
      subject: formData.get('subject').trim(),
      description: formData.get('description').trim(),
      sender: formData.get('sender').trim(),
      senderPosition: formData.get('senderPosition').trim(),
      originatingDependency: formData.get('originatingDependency').trim(),
      destination: 'Dirección de Servicios Académicos',
      unitId: currentUnit.id,
      unitName: currentUnit.name,
      specialistId: selectedSpecialist.id,
      specialistName: selectedSpecialist.name,
      specialistPosition: selectedSpecialist.position,
      attachmentName: file.name,
      attachmentSize: file.size,
    })
  }

  const unlockAfterEdit = () => {
    if (submissionLocked.current) {
      submissionLocked.current = false
      setSubmitted(false)
    }
  }

  return (
    <section aria-labelledby="document-form-title" className="document-form-page">
      <p className="breadcrumb">Panel del Emisor</p>
      <h1 id="document-form-title">Nuevo documento</h1>
      <p className="panel-page__intro">Completa la información para registrar un envío de prueba. El registro será temporal y permanecerá solo en esta sesión.</p>
      <form className="document-form" onChange={unlockAfterEdit} onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="form-field form-field--full">
            <span>Dependencia destinataria</span>
            <input readOnly value="Dirección de Servicios Académicos" />
          </label>
          <div className="specialist-selector-grid">
            <label className="form-field">
              <span>Unidad organizacional DSA <b aria-hidden="true">*</b></span>
              <select required value={unitId} onChange={handleUnitChange}>
                <option value="">Selecciona una unidad</option>
                {organizationalUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Especialista responsable <b aria-hidden="true">*</b></span>
              <select required disabled={!currentUnit} value={specialistId} onChange={(event) => setSpecialistId(event.target.value)}>
                <option value="">{currentUnit ? 'Selecciona un especialista' : 'Primero selecciona una unidad'}</option>
                {specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{specialist.name}</option>)}
              </select>
            </label>
            {selectedSpecialist && <aside className="position-description"><strong>{selectedSpecialist.position}</strong><p>{selectedSpecialist.description}</p><small>Información provisional · pendiente de datos oficiales del MOF.</small></aside>}
          </div>
          <label className="form-field">
            <span>Asunto <b aria-hidden="true">*</b></span>
            <input autoComplete="off" maxLength="180" name="subject" onInput={unlockAfterEdit} required />
          </label>
          <label className="form-field">
            <span>Remitente <b aria-hidden="true">*</b></span>
            <input autoComplete="name" maxLength="120" name="sender" onInput={unlockAfterEdit} required />
          </label>
          <label className="form-field">
            <span>Cargo <b aria-hidden="true">*</b></span>
            <input autoComplete="organization-title" maxLength="120" name="senderPosition" onInput={unlockAfterEdit} required />
          </label>
          <label className="form-field">
            <span>Dependencia de origen <b aria-hidden="true">*</b></span>
            <input autoComplete="organization" maxLength="160" name="originatingDependency" onInput={unlockAfterEdit} required />
          </label>
          <label className="form-field form-field--full">
            <span>Descripción <b aria-hidden="true">*</b></span>
            <textarea maxLength="2000" name="description" onInput={unlockAfterEdit} required rows="4" />
          </label>
          <label className="form-field form-field--full">
            <span>Archivo adjunto <b aria-hidden="true">*</b></span>
            <input accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.jpg,.jpeg,.png" name="attachment" onInput={unlockAfterEdit} required type="file" />
            <small>El archivo no se carga a ningún servicio; solo se registra su nombre en esta sesión.</small>
          </label>
        </div>
        {formError && <p className="form-message form-message--error" role="alert">{formError}</p>}
        {submitted && <p className="form-message" role="status">Envío de prueba registrado. No se conectó con Alfresco.</p>}
        <div className="form-actions"><button className="button-primary" disabled={submitted} type="submit">{submitted ? 'Envío registrado' : 'Registrar y enviar'}</button></div>
      </form>
    </section>
  )
}
