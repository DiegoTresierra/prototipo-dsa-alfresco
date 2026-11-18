import { useCallback, useEffect, useRef, useState } from 'react'
import { getAssignmentInbox } from '../api/alfresco'

const initialState = { documents: [], dispatchRecords: [], sentDispatches: [], documentErrors: [], loading: false, refreshing: false, error: '', lastUpdated: null }

export function useAssignmentInbox({ active, allowed, refreshKey, loadInbox = getAssignmentInbox, scopeKey = '' }) {
  const [state, setState] = useState(initialState)
  const refreshRef = useRef(null)
  const previousPage = useRef(refreshKey)
  const previousScope = useRef(scopeKey)
  useEffect(() => {
    if (previousScope.current !== scopeKey) { setState(initialState); previousScope.current = scopeKey }
    if (!active || !allowed) return undefined
    let cancelled = false
    let inFlight = false
    let pending = false
    const load = async (force = false) => {
      if (inFlight) { if (force) pending = true; return }
      inFlight = true
      setState((current) => ({ ...current, loading: !current.lastUpdated, refreshing: Boolean(current.lastUpdated), error: '' }))
      try {
        const snapshot = await loadInbox()
        if (!cancelled) setState({ ...snapshot, loading: false, refreshing: false, error: '', lastUpdated: new Date().toISOString() })
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, refreshing: false, error: error.message }))
      } finally {
        inFlight = false
        if (pending && !cancelled) { pending = false; load() }
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    refreshRef.current = (force = true) => load(force)
    load()
    const timer = window.setInterval(onVisible, 60_000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    const afterWrite = () => load(true)
    window.addEventListener('uac:alfresco-document-created', afterWrite)
    return () => {
      cancelled = true
      refreshRef.current = null
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('uac:alfresco-document-created', afterWrite)
    }
  }, [active, allowed, loadInbox, scopeKey])
  useEffect(() => {
    if (previousPage.current !== refreshKey) refreshRef.current?.(false)
    previousPage.current = refreshKey
  }, [refreshKey])
  const refresh = useCallback(() => refreshRef.current?.(), [])
  return { ...(previousScope.current === scopeKey ? state : initialState), refresh }
}
