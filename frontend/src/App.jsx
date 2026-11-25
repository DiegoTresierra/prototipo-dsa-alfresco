import { emitOfficialDocument, getAuthorizedDocument } from './api/alfresco'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'
import { CONFIRMED_STORAGE_KEY, loadAlfrescoConfirmedDocuments, recordAlfrescoConfirmedDocument } from './utils/documentStore'
import { getAuthStatus, getSession, logout } from './auth'
import { LoginPage } from './components/LoginPage'
import { dispatchDocument, getDirectorOfficeInboxes, listDispatches, listDispatchRecipients, uploadPdfToDirectorInbox, uploadPdfToFolder, linkAssignmentResponse } from './api/alfresco'
import { useAlfrescoInbox } from './hooks/useAlfrescoInbox'
import { DirectorPage } from './pages/DirectorPage'
import { JefeUnidadPage } from './pages/JefeUnidadPage'
import { EspecialistaPage } from './pages/EspecialistaPage'
import { useAssignmentInbox } from './hooks/useAssignmentInbox'
import { useEmittedInbox } from './hooks/useEmittedInbox'
import { ClosureInbox } from './components/ClosureInbox'
import { getDashboardRoleId } from './auth/authorization'
import { DocumentForm } from './components/DocumentForm'
import { loadPersonalAttention, personalAttentionKey, personalAttentionDocuments } from './utils/documentViews'
import { NotificationsPage } from './pages/NotificationsPage'
import { persistedDocumentNotifications, documentNotificationStorageKey, loadDocumentNotificationState, saveDocumentNotificationState } from './utils/documentNotifications'

/* eslint-disable react/prop-types */
function getInitialAlfrescoDocuments() {
  try { return loadAlfrescoConfirmedDocuments() } catch { return [] }
}

function dependencyProfile(dependency) {
  const dependencyId = String(dependency || '').toLowerCase()
  return {
    id: dependencyId,
    name: dependency || '',
    acronym: String(dependency || '').toUpperCase(),
  }
}

function clearLegacySimulationData() {
  try {
    // Obsolete browser summaries are not operational repository records.
    window.localStorage.removeItem(CONFIRMED_STORAGE_KEY)
    window.localStorage.removeItem('gestion-documental-dsa.simulated-documents.v1')
    window.localStorage.removeItem('uac-document-management-demo-notifications-v1')
    const organizationKeys = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith('uac-demo-organization-')) organizationKeys.push(key)
    }
    organizationKeys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // The application continues if browser storage is disabled.
  }
}

function ApplicationShell({ session, onLogout }) {
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const notificationStorageKey = documentNotificationStorageKey(session.alfresco?.id || session.user?.id, session.dependency)
  const [notificationData, setNotificationData] = useState(() => loadDocumentNotificationState(window.localStorage, notificationStorageKey))
  const [officeInboxFolders, setOfficeInboxFolders] = useState(null)
  const [officeInboxError, setOfficeInboxError] = useState('')
  const [dispatchDirectory, setDispatchDirectory] = useState({ recipients: [] })
  const [dispatchDirectoryRefresh, setDispatchDirectoryRefresh] = useState(0)
  const { recipients } = dispatchDirectory
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [recipientsError, setRecipientsError] = useState('')
  const [dispatchRecords, setDispatchRecords] = useState([])
  const [dispatchError, setDispatchError] = useState('')
  const [responseContext, setResponseContext] = useState(null)
  const [responseNotice, setResponseNotice] = useState('')
  const assignmentRequestVersion = useRef(0)
  const loadAssignments = useCallback(async () => {
    const version = ++assignmentRequestVersion.current
    try {
      const records = await listDispatches()
      if (version === assignmentRequestVersion.current) {
        setDispatchRecords(records)
        setDispatchError('')
      }
      return records
    } catch (error) {
      if (version === assignmentRequestVersion.current) setDispatchError(error.message)
      throw error
    }
  }, [])
  const [alfrescoDocuments, setAlfrescoDocuments] = useState(getInitialAlfrescoDocuments)
  const attentionStorageKey = personalAttentionKey(session.alfresco?.id || session.user?.id || '', session.dependency || '')
  const [attentionIds, setAttentionIds] = useState(() => {
    try { return loadPersonalAttention(window.localStorage, attentionStorageKey) } catch { return [] }
  })
  const [attentionError, setAttentionError] = useState('')
  useEffect(() => {
    const syncBrowserSelections = (event) => {
      if (event.key === CONFIRMED_STORAGE_KEY || event.key === null) setAlfrescoDocuments(getInitialAlfrescoDocuments())
      if (event.key === notificationStorageKey || event.key === null) setNotificationData(loadDocumentNotificationState(window.localStorage, notificationStorageKey))
      if (event.key === attentionStorageKey || event.key === null) {
        try {
          setAttentionIds(loadPersonalAttention(window.localStorage, attentionStorageKey))
          setAttentionError('')
        } catch {
          setAttentionIds([])
          setAttentionError('No se pudo leer la selección personal guardada en este navegador.')
        }
      }
    }
    window.addEventListener('storage', syncBrowserSelections)
    return () => window.removeEventListener('storage', syncBrowserSelections)
  }, [attentionStorageKey, notificationStorageKey])
  const uploadInFlight = useRef(false)
  useEffect(() => {
    saveDocumentNotificationState(window.localStorage, notificationStorageKey, notificationData)
  }, [notificationData, notificationStorageKey])
  const role = roleDefinitions[getDashboardRoleId(session)]
  const canReadAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:read')
  const canWriteAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:write')
  const dependency = dependencyProfile(session.dependency)
  const unit = session.unitVerified === true ? session.unit : null
  const currentUserName = session.user?.name || session.alfresco?.displayName || session.alfresco?.id
  const currentOffice = {
    acronym: dependency.acronym,
    office: dependency.name || role.label,
    name: currentUserName,
    position: session.user?.position || role.label,
    userId: session.alfresco?.id || session.user?.id || '',
    dependencyId: dependency.id,
    roleId: session.roleId,
    distributionDependencies: session.distributionDependencies || [],
    officialWritesEnabled: session.officialWritesEnabled === true,
    unitAcronym: unit?.acronym || unit?.code || '',
    unitName: unit?.name || '',
    issuerCode: session.institutionalDocumentCode || '',
  }
  const isDirector = String(session.functionalRole || '').toLowerCase() === 'direccion'
  const isUnitHead = session.functionalRole === 'jefe-unidad'
  const isSpecialist = session.functionalRole === 'especialista'
  const isAssignmentUser = isUnitHead || isSpecialist
  const recipientRoles = session.dispatchWritesEnabled === true ? session.dispatchRecipientRoles || [] : []
  const canDispatchInternal = canWriteAlfresco && recipientRoles.length > 0
  useEffect(() => {
    if (!canReadAlfresco || isAssignmentUser || !session.dependency) return undefined
    let active = true
    getDirectorOfficeInboxes()
      .then((folders) => { if (active) { setOfficeInboxFolders(folders); setOfficeInboxError('') } })
      .catch((error) => { if (active) setOfficeInboxError(error.message) })
    return () => { active = false }
  }, [canReadAlfresco, isAssignmentUser, isDirector, session.dependency])
  useEffect(() => {
    if (!canDispatchInternal) return undefined
    let active = true
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      setRecipientsLoading(true)
      try {
        const result = await listDispatchRecipients()
          if (active) { setDispatchDirectory(result); setRecipientsError('') }
      } catch (error) {
          if (active) {
            setDispatchDirectory((current) => ({ ...current, recipients: [], units: [], hierarchyRevision: '' }))
            setRecipientsError(error.message)
          }
      } finally {
        inFlight = false
        if (active) setRecipientsLoading(false)
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    load()
    window.addEventListener('focus', onVisible)
    const timer = window.setInterval(onVisible, 60_000)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onVisible) }
  }, [canDispatchInternal, session.dependency, session.functionalRole, dispatchDirectoryRefresh])
  const visibleMenu = role.menu.filter((item) => !item.devOnly || import.meta.env.DEV)
  const activeItem = visibleMenu.find((item) => item.id === activePanel) || visibleMenu[0]
  const inboxFolderIds = isDirector || isUnitHead
    ? activePanel === 'para-conocimiento'
      ? [officeInboxFolders?.porConocimiento]
      : [officeInboxFolders?.porAtender, officeInboxFolders?.porConocimiento]
    : [session.userInboxNodeId || '']
  const inboxFolderKinds = isDirector || isUnitHead ? ['por-atender', 'por-conocimiento'] : ['personal']
  const institutionalInbox = useAlfrescoInbox({
    active: canReadAlfresco && !isAssignmentUser && ((!isDirector && !isUnitHead) || Boolean(officeInboxFolders)),
    allowed: canReadAlfresco && !isAssignmentUser,
    folderIds: inboxFolderIds,
    folderKinds: inboxFolderKinds,
    loadAssignments,
    refreshKey: activePanel,
  })
  const assignmentInbox = useAssignmentInbox({ active: isAssignmentUser, allowed: canReadAlfresco, refreshKey: activePanel })
  const emittedInbox = useEmittedInbox({ active: isDirector || isUnitHead || isSpecialist, allowed: canReadAlfresco, refreshKey: activePanel, scopeKey: `${currentOffice.userId}:${session.dependency}` })
  const inbox = isAssignmentUser ? assignmentInbox : institutionalInbox
  const receivedDocuments = inbox.documents
  const visibleNotifications = canReadAlfresco && !inbox.loading && !inbox.refreshing && !inbox.error && inbox.lastUpdated
    ? persistedDocumentNotifications(inbox.documents,
      isAssignmentUser ? inbox.dispatchRecords : dispatchRecords,
      currentOffice.userId, notificationData.notifications) : []
  const inboxDocumentsForPanel = activePanel === 'para-conocimiento'
    ? receivedDocuments.filter((document) => document.inboxKinds?.includes('por-conocimiento'))
    : receivedDocuments
  const visibleInbox = {
    ...inbox,
    documents: activePanel === 'para-atencion' ? personalAttentionDocuments(inboxDocumentsForPanel, attentionIds) : inboxDocumentsForPanel,
    error: (isAssignmentUser ? '' : dispatchError) || inbox.error || (isAssignmentUser ? '' : officeInboxError),
  }
  const selectPersonalAttention = (documentId, selected) => {
    if (!canReadAlfresco || !receivedDocuments.some((document) => document.id === documentId)) return
    const next = selected ? [...new Set([...attentionIds, documentId])] : attentionIds.filter((id) => id !== documentId)
    try {
      window.localStorage.setItem(attentionStorageKey, JSON.stringify(next))
      setAttentionIds(next)
      setAttentionError('')
    } catch {
      setAttentionError('No se pudo guardar tu selección en este navegador. El documento conserva su selección anterior.')
    }
  }

  const handleNavigate = (panelId) => {
    if (!visibleMenu.some((item) => item.id === panelId)) return
    setActivePanel(panelId)
    setResponseContext(null)
    setSelectedDocumentId('')
    setIsSidebarOpen(false)
  }

  const handleViewNotification = async (notification) => {
    try { await getAuthorizedDocument(notification.documentId) }
    catch { setResponseNotice('No se pudo verificar el acceso actual al documento. Actualiza la bandeja.'); return }
    setNotificationData((current) => ({
      ...current,
      notifications: current.notifications.some(entry => entry.id === notification.id)
        ? current.notifications.map(entry => entry.id === notification.id ? { ...entry, isRead: true } : entry)
        : [...current.notifications, { id: notification.id, type: notification.type, documentId: notification.documentId,
          detectedAt: notification.detectedAt, isRead: true }],
    }))
    setSelectedDocumentId(notification.documentId)
    setActivePanel('documentos-recibidos')
    setIsSidebarOpen(false)
  }

  const handleViewAllNotifications = () => {
    setSelectedDocumentId('')
    setActivePanel('notificaciones')
    setIsSidebarOpen(false)
  }

  const handleDispatch = async (documentId, recipientUserIds, instruction, priority, requestKey, originAssignmentId = null, destination) => {
    try {
      const dispatch = await dispatchDocument(documentId, recipientUserIds, instruction, priority, requestKey, session.csrfToken, originAssignmentId, destination)
      assignmentRequestVersion.current++ // Do not let an older in-flight GET erase this verified success.
      setDispatchRecords((current) => [dispatch, ...current.filter((record) => record.id !== dispatch.id)])
      window.dispatchEvent(new Event('uac:alfresco-document-created'))
      return dispatch
    } catch (error) {
      if (destination && ['DISPATCH_HIERARCHY_REVISION_CONFLICT', 'DISPATCH_UNIT_NOT_ALLOWED', 'DISPATCH_UNIT_RECIPIENT_NOT_ALLOWED'].includes(error.code)) {
        setDispatchDirectoryRefresh((current) => current + 1)
      }
      throw error
    }
  }

  const handleAttentionChanged = (result) => {
    assignmentRequestVersion.current++
    if (result?.dispatch && result.persistence === 'alfresco') setDispatchRecords((current) => [
      { ...result.dispatch, persistence: 'alfresco' }, ...current.filter((record) => record.id !== result.dispatch.id),
    ])
    window.dispatchEvent(new Event('uac:alfresco-document-created'))
  }
  const handleEmitResponse = (context) => {
    if (!session.canIssueInstitutionalResponse) return
    setResponseContext({ ...context, requestKey: globalThis.crypto.randomUUID() })
    setResponseNotice('')
    setActivePanel('nuevo-documento')
  }

  const handleDocumentSubmit = async (documentData) => {
    if (!canWriteAlfresco) return { ok: false, error: 'La función autenticada no tiene permiso para cargar documentos.' }
    if (uploadInFlight.current) return { ok: false, error: 'Ya hay un envío en curso.' }
    uploadInFlight.current = true
    try {
      if (!documentData.officialEmission && !documentData.recipientUserId) return { ok: false, error: 'Completa el destinatario antes de enviar.' }
      let entry
      if (documentData.officialEmission || isDirector) {
        const delivery = documentData.existingNodeId ? await uploadPdfToDirectorInbox(documentData.mainDocumentFile, {
          title: documentData.subject,
          description: documentData.description,
          recipientDependencyId: documentData.recipientDependencyId,
          receiptCategory: documentData.receiptCategory,
          existingNodeId: documentData.existingNodeId || '',
        }, session.csrfToken) : await emitOfficialDocument(documentData.mainDocumentFile, {
          requestKey: documentData.submissionToken,
          title: documentData.subject, description: documentData.description,
          documentType: documentData.documentType, documentPeriod: documentData.documentPeriod, priority: documentData.priority,
          recipientDependency: documentData.recipientDependencyId,
          receiptCategory: documentData.receiptCategory,
        }, session.csrfToken)
        entry = delivery.emittedEntry
      } else {
        entry = await uploadPdfToFolder(documentData.recipientInboxNodeId, documentData.mainDocumentFile, {
          title: documentData.subject,
          description: documentData.description,
          documentType: documentData.documentType,
          recipientDependency: documentData.recipientDependencyId,
          recipientFunctionalRole: documentData.recipientRole,
        }, session.csrfToken, documentData.recipientUserId)
      }
      if (documentData.existingNodeId && !documentData.documentType) {
        window.dispatchEvent(new Event('uac:alfresco-document-created'))
        return { ok: true, document: { id: entry.id, emissionDate: entry.properties?.['gd:fechaDocumento'] || '' }, warning: 'Distribución recuperada. El correlativo local no se ha reconstruido.' }
      }
      const { document } = recordAlfrescoConfirmedDocument({}, entry)
      const warning = isDirector ? 'Prioridad documental y periodo academico no tienen propiedades verificadas; no se registran como metadatos oficiales.' : ''
      setAlfrescoDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)])
      if (responseContext) {
        try {
          const linked = await linkAssignmentResponse({ ...responseContext, responseDocumentId: entry.id }, session.csrfToken)
          handleAttentionChanged(linked)
          setResponseNotice('Respuesta emitida y vinculada. La asignación sigue pendiente hasta que marques su atención.')
        } catch (error) {
          setResponseNotice(`El documento ${entry.id} ya fue emitido. No vuelvas a emitirlo. ${error.message} Puedes seleccionarlo desde la asignación original para revisar o recuperar el vínculo.`)
        }
        setSelectedDocumentId(responseContext.documentId)
        setActivePanel('documentos-recibidos')
        setResponseContext(null)
      }
      window.dispatchEvent(new Event('uac:alfresco-document-created'))
      return { ok: true, document, warning }
    } catch (error) {
      return { ok: false, error: error?.message || 'No se pudo completar el envío a Alfresco.', uncertain: Boolean(error?.uncertain), emittedNodeId: error?.emittedNodeId || documentData.existingNodeId || '' }
    } finally {
      uploadInFlight.current = false
    }
  }

  const ActivePage = rolePages[getDashboardRoleId(session)]
  const attentionProps = { userId: currentOffice.userId, csrfToken: session.csrfToken,
    canAttend: session.canAttendAssignments === true, canLinkResponse: session.canLinkOfficialResponse === true, canIssueResponse: session.canIssueInstitutionalResponse === true,
    onAttentionChanged: handleAttentionChanged, onEmitResponse: handleEmitResponse }
  return (
    <div className="app-shell">
      <Sidebar activePanel={activePanel} collapsed={isSidebarCollapsed} isOpen={isSidebarOpen} items={visibleMenu} office={currentOffice} roleLabel={role.label} onNavigate={handleNavigate} onClose={() => setIsSidebarOpen(false)} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} onLogout={onLogout} />
      <div className="app-content">
        <TopBar
          officeName={currentOffice.office}
          onMenuClick={() => setIsSidebarOpen(true)}
          notifications={visibleNotifications}
          notificationLoading={inbox.loading || inbox.refreshing}
          notificationError={inbox.error || officeInboxError}
          onNotificationRefresh={inbox.refresh}
          onViewNotification={handleViewNotification}
          onViewAllNotifications={handleViewAllNotifications}
          pendingNotificationMessage={canReadAlfresco ? 'Las tareas pendientes requieren un estado verificable del BFF.' : ''}
        />
        <main className="main-content">{responseNotice && <p className="form-message" role="status">{responseNotice}</p>}{activePanel === 'notificaciones'
          ? <NotificationsPage notifications={visibleNotifications} onViewDocument={handleViewNotification} />
          : activePanel === 'aprobar-cierres'
          ? <ClosureInbox allowed={isDirector && canReadAlfresco} csrfToken={session.csrfToken} scopeKey={`${currentOffice.userId}:${session.dependency}`} />
          : activePanel === 'documentos-enviados' && !isDirector
          ? <DirectorPage key={activePanel} title="Emitidos" mode="sent" allowAlfresco={canReadAlfresco} inbox={emittedInbox} userId={currentOffice.userId} csrfToken={session.csrfToken} canLinkExisting={session.canLinkOfficialResponse === true} showClosure={false} />
          : activePanel === 'nuevo-documento'
          ? <>{responseContext && <p className="form-message">Respuesta al documento {responseContext.documentId}. Emitir no marca la asignación como atendida.</p>}<DocumentForm allowAlfrescoUpload={canWriteAlfresco} csrfToken={session.csrfToken} onSubmit={handleDocumentSubmit} panelLabel={`Panel ${role.label} · ${currentOffice.acronym}`} user={currentOffice} /></>
          : isUnitHead && ['documentos-recibidos', 'derivaciones-enviadas'].includes(activePanel)
            ? <JefeUnidadPage key={activePanel} allowAlfresco={canReadAlfresco} description={activeItem.description} inbox={visibleInbox} title={activeItem.label} userId={currentOffice.userId} mode={activePanel === 'derivaciones-enviadas' ? 'sent' : 'received'} recipientRoles={recipientRoles} recipients={recipients} recipientsLoading={recipientsLoading} recipientsError={recipientsError} onDispatch={handleDispatch} {...attentionProps} />
          : isSpecialist && ['documentos-recibidos', 'mis-asignaciones'].includes(activePanel)
            ? <EspecialistaPage key={activePanel} activePanel={activePanel} allowAlfresco={canReadAlfresco} description={activeItem.description} inbox={visibleInbox} title={activeItem.label} userId={currentOffice.userId} {...attentionProps} />
          : activePanel === 'documentos-recibidos' || activePanel === 'para-conocimiento' || activePanel === 'para-atencion'
            ? <DirectorPage key={activePanel} allowAlfresco={canReadAlfresco} dispatchDirectory={dispatchDirectory} canDispatch={isDirector && canDispatchInternal && activePanel === 'documentos-recibidos'} description={activeItem.description} dispatchRecords={dispatchRecords} inbox={visibleInbox} title={activeItem.label} mode={activePanel === 'para-atencion' ? 'attention' : 'received'} attentionIds={attentionIds} onDispatch={handleDispatch} onPersonalAttentionChange={selectPersonalAttention} recipients={recipients} recipientRoles={recipientRoles} recipientsError={recipientsError} recipientsLoading={recipientsLoading} assignmentError={attentionError} openDocumentId={selectedDocumentId} onDocumentPreviewClose={() => setSelectedDocumentId('')} {...attentionProps} />
          : <ActivePage dispatchRecords={dispatchRecords} dispatchError={dispatchError} canLinkExisting={session.canLinkOfficialResponse === true} activePanel={activePanel} emittedInbox={emittedInbox} csrfToken={session.csrfToken} alfrescoDocuments={alfrescoDocuments} allowAlfresco={canReadAlfresco} allowAlfrescoUpload={canWriteAlfresco} description={activeItem.description} documents={alfrescoDocuments} inbox={{ ...inbox, documents: receivedDocuments }} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} />}</main>
      </div>
    </div>
  )
}

function App() {
  const [session, setSession] = useState(undefined)
  const [authStatus, setAuthStatus] = useState(undefined)
  const [sessionError, setSessionError] = useState('')

  useEffect(() => {
    clearLegacySimulationData()
    Promise.all([getSession(), getAuthStatus()])
      .then(([nextSession, nextStatus]) => { setSession(nextSession); setAuthStatus(nextStatus) })
      .catch((error) => setSessionError(error.message))
  }, [])

  if (sessionError) return <main className="login-page"><p className="form-message form-message--error">{sessionError}</p></main>
  if (session === undefined || authStatus === undefined) return <main className="login-page"><p>Comprobando sesión...</p></main>
  if (session === null) return <LoginPage basicAuthEnabled={authStatus.basicAuthEnabled} onAuthenticated={setSession} />
  const dashboardRoleId = getDashboardRoleId(session)
  if (!dashboardRoleId || !roleDefinitions[dashboardRoleId] || !rolePages[dashboardRoleId]) {
    const accessMessage = session.authorizationStatus === 'ambiguous'
      ? 'Tu cuenta coincide con más de una función o dependencia. Solicita revisar sus grupos institucionales.'
      : session.authorizationStatus === 'incomplete'
        ? 'Alfresco validó tu cuenta, pero no encontró una combinación configurada de dependencia y función.'
        : 'La función fue reconocida, pero no hay una interfaz habilitada para ella.'
    return <main className="login-page"><section className="login-card"><p className="breadcrumb">Gestión Documental</p><h1>Acceso pendiente de configuración</h1><p className="form-message">{accessMessage}</p><div className="access-diagnostics"><p>Estado de rol: <strong>{session.authorizationStatus || 'no disponible'}</strong></p><p>Rol asignado: <strong>{session.roleId || 'sin rol'}</strong></p><p>Dependencia: <strong>{session.dependency || 'sin asignar'}</strong></p><p>Funcion: <strong>{session.functionalRole || session.functionalIdentity?.functionalRole || 'sin asignar'}</strong></p></div><button className="button-primary" onClick={() => logout(session).then(() => setSession(null))} type="button">Cerrar sesión</button></section></main>
  }
  return <ApplicationShell key={`${session.alfresco?.id}:${session.dependency}`} onLogout={() => logout(session).then(() => setSession(null))} session={session} />
}

export default App
