import { useEffect, useState } from 'react'
import { getNodeContent } from '../api/alfresco'

const acceptedMimeTypes = new Set(['application/pdf', 'application/octet-stream'])

function normalizedMimeType(value) {
  return String(value || '').split(';', 1)[0].trim().toLocaleLowerCase('en')
}

async function validatePdfContent(blob, fileName, declaredMimeType) {
  if (!fileName?.toLocaleLowerCase('en').endsWith('.pdf')) return 'El nombre del archivo no corresponde a un PDF.'

  const mimeTypes = [blob.type, declaredMimeType].map(normalizedMimeType).filter(Boolean)
  if (mimeTypes.some((mimeType) => !acceptedMimeTypes.has(mimeType))) return 'Alfresco o el archivo indican un formato distinto de PDF.'

  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  if (String.fromCharCode(...signature) !== '%PDF-') return 'El contenido recibido no tiene una firma PDF válida.'
  return ''
}

/* eslint-disable react/prop-types */
export function PdfPreview({ blob = null, nodeId = '', fileName = 'documento.pdf', declaredMimeType = '', emptyMessage = 'Selecciona un PDF para ver la vista previa.' }) {
  const sourceKey = nodeId ? `node:${nodeId}` : blob
  const [preview, setPreview] = useState({ sourceKey: null, url: '', loading: false, error: '' })
  const currentPreview = preview.sourceKey === sourceKey ? preview : { url: '', loading: Boolean(sourceKey), error: '' }

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''

    if (!nodeId && !blob) {
      setPreview({ sourceKey: null, url: '', loading: false, error: '' })
      return undefined
    }

    setPreview({ sourceKey, url: '', loading: true, error: '' })

    const preparePreview = async () => {
      const content = nodeId ? await getNodeContent(nodeId) : blob
      const validationError = await validatePdfContent(content, fileName, declaredMimeType)
      if (cancelled) return
      if (validationError) {
        setPreview({ sourceKey, url: '', loading: false, error: validationError })
        return
      }

      const pdfBlob = new Blob([content], { type: 'application/pdf' })
      objectUrl = URL.createObjectURL(pdfBlob)
      setPreview({ sourceKey, url: objectUrl, loading: false, error: '' })
    }

    preparePreview().catch(() => {
      if (!cancelled) setPreview({ sourceKey, url: '', loading: false, error: 'No se pudo cargar o validar el documento PDF.' })
    })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [blob, declaredMimeType, fileName, nodeId, sourceKey])

  return (
    <div className="pdf-preview" aria-live="polite">
      {currentPreview.loading && <p className="pdf-preview__message" role="status">Cargando documento PDF...</p>}
      {currentPreview.error && <p className="pdf-preview__message pdf-preview__message--error" role="alert">{currentPreview.error}</p>}
      {!sourceKey && <p className="pdf-preview__message">{emptyMessage}</p>}
      {currentPreview.url && (
        <>
          <div className="pdf-preview__toolbar">
            <a className="button-secondary" download={fileName} href={currentPreview.url}>Descargar</a>
            <a href={currentPreview.url} rel="noopener noreferrer" target="_blank">Abrir en otra pestaña</a>
          </div>
          <iframe
            className="pdf-preview__frame"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={currentPreview.url}
            title={`Vista previa de ${fileName}`}
          />
          <p className="pdf-preview__message">Si el visor integrado no aparece, usa Descargar o Abrir en otra pestaña.</p>
        </>
      )}
    </div>
  )
}
