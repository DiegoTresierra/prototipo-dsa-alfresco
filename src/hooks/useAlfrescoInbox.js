import { useCallback, useEffect, useRef, useState } from 'react'
import { listNodeChildren } from '../api/alfresco'

const initialState = { documents: [], unclassifiedCount: 0, loading: false, refreshing: false, error: '', lastUpdated: null }

function isPdfCandidate(document) {
  const mimeType = String(document.mimeType || '').toLowerCase()
  const hasPdfName = String(document.attachmentName || '').toLowerCase().endsWith('.pdf')
  return hasPdfName && (!mimeType || mimeType === 'application/pdf' || mimeType === 'application/octet-stream')
}

function getSafeLoadError(error) {
  const statusFromMessage = String(error?.message || '').match(/(?:HTTP_|estado\s+)(\d{3})/i)
  const status = error?.status || Number(statusFromMessage?.[1])
  if (error?.message === 'ALFRESCO_FOLDER_NOT_CONFIGURED') return 'No está configurada la carpeta de pruebas de Alfresco.'
  if (error?.message === 'ALFRESCO_API_PREFIX_NOT_CONFIGURED') return 'No está configurada la ruta de la API Core de Alfresco.'
  if (error?.message === 'ALFRESCO_INVALID_LIST_RESPONSE') return 'Alfresco respondió, pero el formato de la lista de documentos no es válido.'
  if (status === 401) return 'Alfresco rechazó la autenticación configurada para el entorno DEV.'
  if (status === 403) return 'La cuenta de conexión no tiene permiso de lectura en la carpeta de pruebas.'
  if (status === 404) return 'Alfresco no encontró la carpeta de pruebas o la ruta de consulta.'
  if (status >= 500) return 'Alfresco DEV presentó un error al consultar la carpeta.'
  return 'No se pudo conectar con Alfresco DEV. Revisa el proxy local y la configuración de la API.'
}

export function useAlfrescoInbox({ active, allowed, folderId, dependencyId, mode = 'dependency' }) {
  const [state, setState] = useState(initialState)
  const refreshRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let timer

    if (!allowed) {
      setState(initialState)
      return undefined
    }

    const load = async () => {
      if (inFlight) return
      inFlight = true
      setState((current) => ({ ...current, loading: !current.lastUpdated, refreshing: Boolean(current.lastUpdated), error: '' }))
      try {
        if (!folderId) throw new Error('ALFRESCO_FOLDER_NOT_CONFIGURED')
        const result = await listNodeChildren(folderId, { where: '(isFile=true)' })
        if (cancelled) return
        const documents = mode === 'test'
          ? result.filter(isPdfCandidate)
          : result.filter((document) => document.destinationId === dependencyId)
        const unclassifiedCount = mode === 'test' ? 0 : result.filter((document) => !document.destinationId).length
        setState({ documents, unclassifiedCount, loading: false, refreshing: false, error: '', lastUpdated: new Date().toISOString() })
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({ ...current, loading: false, refreshing: false, error: getSafeLoadError(error) }))
        }
      } finally {
        inFlight = false
      }
    }

    refreshRef.current = load
    if (active) load()

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await load()
        if (!cancelled) schedule()
      }, 60_000)
    }
    const refreshOnReturn = () => {
      if (active && document.visibilityState === 'visible') load()
    }
    const refreshAfterSend = () => load()
    if (active) schedule()
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
    window.addEventListener('uac:alfresco-document-created', refreshAfterSend)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
      window.removeEventListener('uac:alfresco-document-created', refreshAfterSend)
      refreshRef.current = null
    }
  }, [active, allowed, dependencyId, folderId, mode])

  const refresh = useCallback(() => refreshRef.current?.(), [])
  return { ...state, refresh }
}
