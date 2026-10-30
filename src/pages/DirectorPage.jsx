import { useEffect, useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { DocumentList } from '../components/DocumentList'
import { getNodeContent, listNodeChildren } from '../api/alfresco'

/* eslint-disable react/prop-types */
export function DirectorPage({ title, description, activePanel }) {
  const [apiDocuments, setApiDocuments] = useState([])
  const [selectedDocument, setSelectedDocument] = useState(null)
  const [contentUrl, setContentUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState('')
  const [contentError, setContentError] = useState('')

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
      setSelectedDocument(null)
      setContentUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl)
        return ''
      })
    }
  }, [activePanel])

  useEffect(() => {
    if (!selectedDocument) return

    let cancelled = false
    setContentLoading(true)
    setContentError('')
    setContentUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      return ''
    })

    getNodeContent(selectedDocument.id)
      .then((content) => {
        if (!cancelled) setContentUrl(URL.createObjectURL(content))
      })
      .catch((loadError) => {
        if (!cancelled) setContentError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false)
      })

    return () => { cancelled = true }
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
            {contentUrl && <iframe className="document-preview__frame" src={contentUrl} title={`Vista previa de ${selectedDocument.attachmentName}`} />}
          </section>
        )}
      </>
    )
  }

  return <PanelPage description={description} title={title} />
}
