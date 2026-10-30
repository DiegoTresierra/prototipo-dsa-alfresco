import { useEffect, useRef, useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { DocumentList } from '../components/DocumentList'
import { getNodeContent, listNodeChildren } from '../api/alfresco'

async function isSafeRasterPreview(blob, document) {
  const extension = document.attachmentName?.split('.').pop()?.toLocaleLowerCase('en')
  const expectedMime = ['jpg', 'jpeg'].includes(extension) ? 'image/jpeg' : extension === 'png' ? 'image/png' : ''
  const declaredMime = String(document.mimeType || '').toLocaleLowerCase('en')
  if (!expectedMime || blob.type.toLocaleLowerCase('en') !== expectedMime || (declaredMime && declaredMime !== expectedMime)) return false

  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  if (expectedMime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
}

/* eslint-disable react/prop-types */
export function DirectorPage({ title, description, activePanel }) {
  const [apiDocuments, setApiDocuments] = useState([])
  const [selectedDocument, setSelectedDocument] = useState(null)
  const [contentUrl, setContentUrl] = useState('')
  const [canPreviewContent, setCanPreviewContent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState('')
  const [contentError, setContentError] = useState('')
  const contentUrlRef = useRef('')

  useEffect(() => {
    if (activePanel !== 'para-conocimiento') return

    let cancelled = false
    let refreshTimer
    const loadDocuments = async (isRefresh = false) => {
      if (!isRefresh) setLoading(true)
      setError('')
      try {
        const folderId = import.meta.env.VITE_ALFRESCO_INBOX_NODE_ID
        if (!folderId) throw new Error('Falta configurar VITE_ALFRESCO_INBOX_NODE_ID.')
        const result = await listNodeChildren(folderId, { where: '(isFile=true)' })
        if (!cancelled) setApiDocuments(result)
      } catch (loadError) {
        if (!cancelled) setError(loadError.message)
      } finally {
        if (!cancelled && !isRefresh) setLoading(false)
      }
    }

    const scheduleRefresh = () => {
      const delay = 5000 + Math.random() * 15000
      refreshTimer = window.setTimeout(async () => {
        await loadDocuments(true)
        if (!cancelled) scheduleRefresh()
      }, delay)
    }

    loadDocuments()
    scheduleRefresh()
    return () => {
      cancelled = true
      window.clearTimeout(refreshTimer)
      if (contentUrlRef.current) URL.revokeObjectURL(contentUrlRef.current)
      contentUrlRef.current = ''
    }
  }, [activePanel])

  useEffect(() => {
    if (!selectedDocument) return

    let cancelled = false
    setContentLoading(true)
    setContentError('')
    if (contentUrlRef.current) URL.revokeObjectURL(contentUrlRef.current)
    contentUrlRef.current = ''
    setContentUrl('')
    setCanPreviewContent(false)

    getNodeContent(selectedDocument.id)
      .then(async (content) => {
        const canPreview = await isSafeRasterPreview(content, selectedDocument)
        if (cancelled) return
        const objectUrl = URL.createObjectURL(content)
        contentUrlRef.current = objectUrl
        setContentUrl(objectUrl)
        setCanPreviewContent(canPreview)
      })
      .catch((loadError) => {
        if (!cancelled) setContentError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false)
      })

    return () => {
      cancelled = true
      if (contentUrlRef.current) URL.revokeObjectURL(contentUrlRef.current)
      contentUrlRef.current = ''
    }
  }, [selectedDocument])

  if (activePanel === 'para-conocimiento') {
    return (
      <>
        {loading && <p className="form-message" role="status">Consultando documentos en Alfresco...</p>}
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <DocumentList description="Archivos reales disponibles en la carpeta de Alfresco configurada." documents={apiDocuments} onSelectDocument={setSelectedDocument} selectedDocumentId={selectedDocument?.id} showAlfrescoDetails title={title} />
        {selectedDocument && (
          <section aria-labelledby="document-preview-title" className="document-preview">
            <div className="document-preview__header">
              <div>
                <p className="breadcrumb">Vista previa</p>
                <h2 id="document-preview-title">{selectedDocument.attachmentName}</h2>
              </div>
              {contentUrl && <a className="button-primary document-preview__download" download={selectedDocument.attachmentName} href={contentUrl}>Descargar</a>}
            </div>
            {contentLoading && <p className="form-message" role="status">Cargando documento...</p>}
            {contentError && <p className="form-message form-message--error" role="alert">{contentError}</p>}
            {contentUrl && canPreviewContent
              ? <img alt={`Vista previa de ${selectedDocument.attachmentName}`} className="document-preview__image" src={contentUrl} />
              : contentUrl && <p className="document-preview__fallback">Por seguridad, este formato no se muestra en línea. Puedes descargar el archivo.</p>}
          </section>
        )}
      </>
    )
  }

  return <PanelPage description={description} title={title} />
}
