import { useCallback, useEffect, useRef, useState } from 'react'
import { getAssignmentInbox } from '../api/alfresco'

const initialState = { documents: [], dispatchRecords: [], sentDispatches: [], documentErrors: [], loading: false, refreshing: false, error: '', lastUpdated: null }

export function useAssignmentInbox({ active, allowed, refreshKey }) {
  const [state, setState] = useState(initialState)
  const refreshRef = useRef(null)
  useEffect(() => {
    if (!active || !allowed) return undefined
    let cancelled = false
    let inFlight = false
    let pending = false
    const load = async () => {
      if (inFlight) { pending = true; return }
      inFlight = true
      setState((current) => ({ ...current, loading: !current.lastUpdated, refreshing: Boolean(current.lastUpdated), error: '' }))
      try {
        const snapshot = await getAssignmentInbox()
        if (!cancelled) setState({ ...snapshot, loading: false, refreshing: false, error: '', lastUpdated: new Date().toISOString() })
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, refreshing: false, error: error.message }))
      } finally {
        inFlight = false
        if (pending && !cancelled) { pending = false; load() }
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    refreshRef.current = load
    load()
    const timer = window.setInterval(onVisible, 60_000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('uac:alfresco-document-created', load)
    return () => {
      cancelled = true
      refreshRef.current = null
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('uac:alfresco-document-created', load)
    }
  }, [active, allowed, refreshKey])
  const refresh = useCallback(() => refreshRef.current?.(), [])
  return { ...state, refresh }
}
