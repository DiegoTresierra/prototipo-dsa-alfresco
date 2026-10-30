import { useEffect, useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { DocumentList } from '../components/DocumentList'
import { listNodeChildren } from '../api/alfresco'

/* eslint-disable react/prop-types */
export function DirectorPage({ title, description, activePanel }) {
  const [apiDocuments, setApiDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (activePanel !== 'para-conocimiento') return

    let cancelled = false
    const loadDocuments = async () => {
      setLoading(true)
      setError('')
      try {
        const folderId = import.meta.env.VITE_ALFRESCO_INBOX_NODE_ID
        if (!folderId) throw new Error('Falta configurar VITE_ALFRESCO_INBOX_NODE_ID.')
        const result = await listNodeChildren(folderId, { where: '(isFile=true)' })
        if (!cancelled) setApiDocuments(result)
      } catch (loadError) {
        if (!cancelled) setError(loadError.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDocuments()
    return () => { cancelled = true }
  }, [activePanel])

  if (activePanel === 'para-conocimiento') {
    return (
      <>
        {loading && <p className="form-message" role="status">Consultando documentos en Alfresco...</p>}
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <DocumentList description="Archivos reales disponibles en la carpeta de Alfresco configurada." documents={apiDocuments} showAlfrescoDetails title={title} />
      </>
    )
  }

  return <PanelPage description={description} title={title} />
}
