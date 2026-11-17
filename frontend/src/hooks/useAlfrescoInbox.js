import { useCallback, useEffect, useRef, useState } from 'react'
import { listNodeChildren } from '../api/alfresco'
import { refreshInboxSources } from '../utils/refreshInbox'

const initialState = { documents: [], loading: false, refreshing: false, error: '', lastUpdated: null }

function isPdfCandidate(document) {
  const mimeType = String(document.mimeType || '').toLowerCase()
  const hasPdfName = String(document.attachmentName || '').toLowerCase().endsWith('.pdf')
  return hasPdfName && (!mimeType || mimeType === 'application/pdf' || mimeType === 'application/octet-stream')
}

function getSafeLoadError(error) {
  const statusFromMessage = String(error?.message || '').match(/(?:HTTP_|estado\s+)(\d{3})/i)
  const status = error?.status || Number(statusFromMessage?.[1])
  if (error?.message === 'ALFRESCO_FOLDER_NOT_CONFIGURED') return 'No está configurada la carpeta personal de recepción en Alfresco para esta cuenta.'
  if (error?.message === 'ALFRESCO_API_PREFIX_NOT_CONFIGURED') return 'No está configurada la ruta de la API Core de Alfresco.'
  if (error?.message === 'ALFRESCO_INVALID_LIST_RESPONSE') return 'Alfresco respondió, pero el formato de la lista de documentos no es válido.'
  if (status === 401) return 'Alfresco rechazó la autenticación configurada para el entorno DEV.'
  if (status === 403) return 'La cuenta autenticada no tiene permiso de lectura en su bandeja personal.'
  if (status === 404) return 'Alfresco no encontró la bandeja personal configurada.'
  if (status >= 500) return 'Alfresco DEV presentó un error al consultar la carpeta.'
  return 'No se pudo conectar con Alfresco DEV. Revisa el proxy local y la configuración de la API.'
}

export function useAlfrescoInbox({ active, allowed, folderId, folderIds = folderId ? [folderId] : [], folderKinds = [], loadAssignments, refreshKey }) {
  const [state, setState] = useState(initialState)
  const refreshRef = useRef(null)
  const folderKey = JSON.stringify(folderIds
    .map((id, index) => ({ id, kind: folderKinds[index] || 'personal' }))
    .filter((folder) => folder.id))
  const previousPage = useRef({ refreshKey, folderKey })

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let pending = false
    let timer

    if (!allowed) {
      setState(initialState)
      return undefined
    }

    const load = async (force = false) => {
      if (inFlight) { if (force) pending = true; return }
      inFlight = true
      setState((current) => ({ ...current, loading: !current.lastUpdated, refreshing: Boolean(current.lastUpdated), error: '' }))
      try {
        const currentFolders = JSON.parse(folderKey)
        if (currentFolders.length === 0) throw new Error('ALFRESCO_FOLDER_NOT_CONFIGURED')
        const folderResults = await refreshInboxSources(() => Promise.all(currentFolders.map(async (folder) => ({
          kind: folder.kind,
          documents: await listNodeChildren(folder.id, { where: '(isFile=true)', allPages: true }),
        }))), loadAssignments)
        if (cancelled) return
        const documentsById = new Map()
        for (const result of folderResults) {
          for (const document of result.documents.filter(isPdfCandidate)) {
            const existing = documentsById.get(document.id)
            if (existing) {
              if (!existing.inboxKinds.includes(result.kind)) existing.inboxKinds.push(result.kind)
            } else {
              documentsById.set(document.id, { ...document, inboxKinds: [result.kind] })
            }
          }
        }
        const documents = [...documentsById.values()]
        setState({ documents, loading: false, refreshing: false, error: '', lastUpdated: new Date().toISOString() })
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({ ...current, loading: false, refreshing: false, error: getSafeLoadError(error) }))
        }
      } finally {
        inFlight = false
        if (pending && !cancelled) { pending = false; load() }
      }
    }

    refreshRef.current = (force = true) => load(force)
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
    const refreshAfterSend = () => load(true)
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
  }, [active, allowed, folderKey, loadAssignments])
  useEffect(() => {
    if (previousPage.current.refreshKey !== refreshKey && previousPage.current.folderKey === folderKey) refreshRef.current?.(false)
    previousPage.current = { refreshKey, folderKey }
  }, [refreshKey, folderKey])

  const refresh = useCallback(() => refreshRef.current?.(), [])
  return { ...state, refresh }
}
