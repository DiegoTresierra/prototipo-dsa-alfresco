import { useEffect, useRef, useState } from 'react'
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
import { assignDocumentResponsibility, dispatchDocument, getDirectorOfficeInboxes, listDispatches, listUnitHeads, uploadPdfToDirectorInbox, uploadPdfToFolder } from './api/alfresco'
import { useAlfrescoInbox } from './hooks/useAlfrescoInbox'
import { DirectorPage } from './pages/DirectorPage'
import { JefeUnidadPage } from './pages/JefeUnidadPage'
import { getDashboardRoleId } from './auth/authorization'
import { DocumentForm } from './components/DocumentForm'
import { recipientDependencies } from './data/emisorCatalog'
import { derivePersonCode, getIssuerCode } from './utils/issuerIdentifier'
import { loadPersonalAttention, personalAttentionKey, personalAttentionDocuments, withKnownPriorities } from './utils/documentViews'
import { NotificationsPage } from './pages/NotificationsPage'
import { documentNotificationStorageKey, loadDocumentNotificationState, saveDocumentNotificationState } from './utils/documentNotifications'

/* eslint-disable react/prop-types */
function getInitialAlfrescoDocuments() {
  try { return loadAlfrescoConfirmedDocuments() } catch { return [] }
}

function dependencyProfile(dependency) {
  const dependencyId = String(dependency || '').toLowerCase()
  return recipientDependencies.find((entry) => entry.id === dependencyId) || {
    id: dependencyId,
    name: dependency || '',
    acronym: String(dependency || '').toUpperCase(),
    available: false,
  }
}

function clearLegacySimulationData() {
  try {
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
  const [unitHeads, setUnitHeads] = useState([])
  const [unitHeadsLoading, setUnitHeadsLoading] = useState(false)
  const [unitHeadsError, setUnitHeadsError] = useState('')
  const [dispatchRecords, setDispatchRecords] = useState([])
  const [alfrescoDocuments, setAlfrescoDocuments] = useState(getInitialAlfrescoDocuments)
  const attentionStorageKey = personalAttentionKey(session.alfresco?.id || session.user?.id || '', session.dependency || '')
  const [attentionIds, setAttentionIds] = useState(() => {
    try { return loadPersonalAttention(window.localStorage, attentionStorageKey) } catch { return [] }
  })
  const [attentionError, setAttentionError] = useState('')
  const [assigningDocumentIds, setAssigningDocumentIds] = useState([])
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
  const processedInboxUpdate = useRef(null)
  useEffect(() => {
    saveDocumentNotificationState(window.localStorage, notificationStorageKey, notificationData)
  }, [notificationData, notificationStorageKey])
  const role = roleDefinitions[getDashboardRoleId(session)]
  const canReadAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:read')
  const canWriteAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:write')
  const dependency = dependencyProfile(session.dependency)
  const unit = session.unit || session.user?.unit || session.functionalIdentity?.unit || null
  const currentUserName = session.user?.name || session.alfresco?.displayName || session.alfresco?.id
  const currentOffice = {
    acronym: dependency.acronym,
    office: dependency.name || role.label,
    name: currentUserName,
    position: session.user?.position || role.label,
    userId: session.alfresco?.id || session.user?.id || '',
    dependencyId: dependency.id,
    roleId: session.roleId,
    unitAcronym: unit?.acronym || unit?.code || '',
    unitName: unit?.name || '',
    issuerCode: getIssuerCode({ roleId: session.roleId, dependencyAcronym: dependency.acronym, unitAcronym: unit?.acronym || unit?.code || '', personCode: derivePersonCode(currentUserName) }),
  }
  const isDirector = String(session.functionalRole || '').toLowerCase() === 'direccion'
  useEffect(() => {
    if (!canReadAlfresco || !session.dependency) return undefined
    let active = true
    getDirectorOfficeInboxes()
      .then((folders) => { if (active) { setOfficeInboxFolders(folders); setOfficeInboxError('') } })
      .catch((error) => { if (active) setOfficeInboxError(error.message) })
    return () => { active = false }
  }, [canReadAlfresco, isDirector, session.dependency])
  useEffect(() => {
    let active = true
    listDispatches()
      .then((records) => { if (active) setDispatchRecords(records) })
      .catch(() => { if (active) setDispatchRecords([]) })
    return () => { active = false }
  }, [session.alfresco?.id, session.functionalRole])
  useEffect(() => {
    if (!isDirector) return undefined
    let active = true
    setUnitHeadsLoading(true)
    listUnitHeads()
      .then((heads) => { if (active) { setUnitHeads(heads); setUnitHeadsError('') } })
      .catch((error) => { if (active) setUnitHeadsError(error.message) })
      .finally(() => { if (active) setUnitHeadsLoading(false) })
    return () => { active = false }
  }, [isDirector, session.dependency])
  const visibleMenu = role.menu.filter((item) => !item.devOnly || import.meta.env.DEV)
  const activeItem = visibleMenu.find((item) => item.id === activePanel) || visibleMenu[0]
  const isUnitHead = session.functionalRole === 'jefe-unidad'
  const inboxFolderIds = isDirector || isUnitHead
    ? activePanel === 'para-conocimiento'
      ? [officeInboxFolders?.porConocimiento]
      : [officeInboxFolders?.porAtender, officeInboxFolders?.porConocimiento]
    : [session.userInboxNodeId || '']
  const inboxFolderKinds = isDirector || isUnitHead ? ['por-atender', 'por-conocimiento'] : ['personal']
  const inbox = useAlfrescoInbox({
    active: canReadAlfresco && ((!isDirector && !isUnitHead) || Boolean(officeInboxFolders)),
    allowed: canReadAlfresco,
    folderIds: inboxFolderIds,
    folderKinds: inboxFolderKinds,
  })
  const receivedDocuments = withKnownPriorities(inbox.documents, alfrescoDocuments)
  useEffect(() => {
    if (!canReadAlfresco) return
    if (inbox.loading || inbox.error || !inbox.lastUpdated || processedInboxUpdate.current === inbox.lastUpdated) return

    const currentSnapshot = new Map(inbox.documents.map((document) => [document.id, document]))
    const currentDocumentIds = [...currentSnapshot.keys()]
    processedInboxUpdate.current = inbox.lastUpdated
    const previousIds = new Set(notificationData.knownDocumentIds)
    const arrivingDocuments = notificationData.initialized
      ? [...currentSnapshot.values()].filter((document) => !previousIds.has(document.id))
      : []

    setNotificationData((current) => {
      const knownEvents = new Set(current.notifications.map((notification) => notification.id))
      const newNotifications = arrivingDocuments
        .map((document) => ({
          id: `${document.id}:document-received`,
          type: 'document-received',
          documentId: document.id,
          title: document.subject || document.attachmentName || 'Documento sin título',
          sender: document.sender || '',
          priority: document.priority,
          inboxKinds: document.inboxKinds || ['personal'],
          detectedAt: inbox.lastUpdated,
          isRead: false,
        }))
        .filter((notification) => !knownEvents.has(notification.id))
      return {
        initialized: true,
        knownDocumentIds: [...new Set([...current.knownDocumentIds, ...currentDocumentIds])],
        notifications: [...newNotifications, ...current.notifications],
      }
    })
  }, [canReadAlfresco, inbox.documents, inbox.error, inbox.lastUpdated, inbox.loading, notificationData])
  const inboxDocumentsForPanel = activePanel === 'para-conocimiento'
    ? receivedDocuments.filter((document) => document.inboxKinds?.includes('por-conocimiento'))
    : receivedDocuments
  const visibleInbox = {
    ...inbox,
    documents: activePanel === 'para-atencion' ? personalAttentionDocuments(inboxDocumentsForPanel, attentionIds) : inboxDocumentsForPanel,
    error: inbox.error || officeInboxError,
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

  const handleResponsibleChange = async (documentId, responsibleId) => {
    if (!canReadAlfresco || !receivedDocuments.some((document) => document.id === documentId)) return
    setAssigningDocumentIds((current) => current.includes(documentId) ? current : [...current, documentId])
    setAttentionError('')
    try {
      if (responsibleId === 'self') {
        await assignDocumentResponsibility(documentId, '', session.csrfToken)
        setDispatchRecords((current) => current.filter((dispatch) => dispatch.documentId !== documentId))
        selectPersonalAttention(documentId, true)
      } else if (!responsibleId) {
        await assignDocumentResponsibility(documentId, '', session.csrfToken)
        setDispatchRecords((current) => current.filter((dispatch) => dispatch.documentId !== documentId))
        selectPersonalAttention(documentId, false)
      } else {
        const dispatch = await assignDocumentResponsibility(documentId, responsibleId, session.csrfToken)
        setDispatchRecords((current) => [dispatch, ...current.filter((entry) => entry.documentId !== documentId)])
        selectPersonalAttention(documentId, false)
      }
    } catch (error) {
      setAttentionError(error.message || 'No se pudo actualizar el responsable del documento.')
    } finally {
      setAssigningDocumentIds((current) => current.filter((id) => id !== documentId))
    }
  }

  const handleNavigate = (panelId) => {
    if (!visibleMenu.some((item) => item.id === panelId)) return
    setActivePanel(panelId)
    setSelectedDocumentId('')
    setIsSidebarOpen(false)
  }

  const handleViewNotification = (notification) => {
    setNotificationData((current) => ({
      ...current,
      notifications: current.notifications.map((entry) => entry.id === notification.id ? { ...entry, isRead: true } : entry),
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

  const handleDispatch = async (documentId, recipientUserIds, instruction, priority, requestKey) => {
    const dispatch = await dispatchDocument(documentId, recipientUserIds, instruction, priority, requestKey, session.csrfToken)
    setDispatchRecords((current) => [dispatch, ...current.filter((record) => record.id !== dispatch.id)])
    window.dispatchEvent(new Event('uac:alfresco-document-created'))
    return dispatch
  }

  const handleDocumentSubmit = async (documentData) => {
    if (!canWriteAlfresco) return { ok: false, error: 'La función autenticada no tiene permiso para cargar documentos.' }
    if (uploadInFlight.current) return { ok: false, error: 'Ya hay un envío en curso.' }
    uploadInFlight.current = true
    try {
      const emissionDate = new Date().toISOString()
      if (isDirector ? !documentData.recipientDependencyId : !documentData.recipientUserId) return { ok: false, error: 'Completa el destinatario antes de enviar.' }
      let entry
      let receivedNodeId = ''
      if (isDirector) {
        const delivery = await uploadPdfToDirectorInbox(documentData.mainDocumentFile, {
          title: documentData.subject,
          description: documentData.description,
          recipientDependencyId: documentData.recipientDependencyId,
          receiptCategory: documentData.receiptCategory,
          existingNodeId: documentData.existingNodeId || '',
        }, session.csrfToken)
        entry = delivery.emittedEntry
        receivedNodeId = delivery.receivedEntry.id
      } else {
        entry = await uploadPdfToFolder(documentData.recipientInboxNodeId, documentData.mainDocumentFile, {
          title: documentData.subject,
          description: documentData.description,
        }, session.csrfToken, documentData.recipientUserId)
      }
      if (documentData.existingNodeId && !documentData.documentType) {
        window.dispatchEvent(new Event('uac:alfresco-document-created'))
        return { ok: true, document: { id: entry.id, emissionDate: entry.createdAt }, warning: 'Distribución recuperada. El correlativo local no se ha reconstruido.' }
      }
      const metadata = { ...documentData }
      delete metadata.mainDocumentFile
      if (receivedNodeId) metadata.recipientNodeId = receivedNodeId
      let document
      let nextDocuments
      let warning = ''
      try {
        const result = recordAlfrescoConfirmedDocument({ ...metadata, emissionDate }, entry)
        document = result.document
        nextDocuments = result.documents
      } catch {
        document = {
          id: entry.id,
          source: 'alfresco',
          recipientUserId: metadata.recipientUserId,
          recipientName: metadata.recipientName,
          recipientInboxNodeId: metadata.recipientInboxNodeId,
          recipientNodeId: metadata.recipientNodeId,
          receiptCategory: metadata.receiptCategory,
          senderUserId: entry.createdByUser?.id || '',
          sender: entry.createdByUser?.displayName || entry.createdByUser?.id || '',
          subject: entry.properties?.['cm:title'] || entry.name || '',
          description: entry.properties?.['cm:description'] || '',
          attachmentName: entry.name || metadata.attachmentName,
          attachmentType: entry.content?.mimeType || 'application/pdf',
          attachmentSize: entry.content?.sizeInBytes ?? metadata.attachmentSize,
          status: 'Creado en Alfresco',
          emissionDate: entry.createdAt || emissionDate,
          createdAt: entry.createdAt || emissionDate,
          priority: metadata.priority,
        }
        nextDocuments = [document, ...alfrescoDocuments]
        warning = 'Alfresco creó el documento, pero no se pudo guardar su resumen en este navegador.'
      }
      setAlfrescoDocuments(nextDocuments)
      window.dispatchEvent(new Event('uac:alfresco-document-created'))
      return { ok: true, document, warning }
    } catch (error) {
      return { ok: false, error: error?.message || 'No se pudo completar el envío a Alfresco.', uncertain: Boolean(error?.uncertain), emittedNodeId: error?.emittedNodeId || documentData.existingNodeId || '' }
    } finally {
      uploadInFlight.current = false
    }
  }

  const ActivePage = rolePages[getDashboardRoleId(session)]
  return (
    <div className="app-shell">
      <Sidebar activePanel={activePanel} collapsed={isSidebarCollapsed} isOpen={isSidebarOpen} items={visibleMenu} office={currentOffice} roleLabel={role.label} onNavigate={handleNavigate} onClose={() => setIsSidebarOpen(false)} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} onLogout={onLogout} />
      <div className="app-content">
        <TopBar
          officeName={currentOffice.office}
          onMenuClick={() => setIsSidebarOpen(true)}
          notifications={canReadAlfresco ? notificationData.notifications : []}
          notificationLoading={inbox.loading || inbox.refreshing}
          notificationError={inbox.error || officeInboxError}
          onNotificationRefresh={inbox.refresh}
          onViewNotification={handleViewNotification}
          onViewAllNotifications={handleViewAllNotifications}
          pendingNotificationMessage={canReadAlfresco ? 'Las tareas pendientes requieren un estado verificable del BFF.' : ''}
        />
        <main className="main-content">{activePanel === 'notificaciones'
          ? <NotificationsPage notifications={canReadAlfresco ? notificationData.notifications : []} onViewDocument={handleViewNotification} />
          : activePanel === 'nuevo-documento'
          ? <DocumentForm allowAlfrescoUpload={canWriteAlfresco} csrfToken={session.csrfToken} onSubmit={handleDocumentSubmit} panelLabel={`Panel ${role.label} · ${currentOffice.acronym}`} user={currentOffice} />
          : activePanel === 'documentos-recibidos' && isUnitHead
            ? <JefeUnidadPage allowAlfresco={canReadAlfresco} description={activeItem.description} dispatchRecords={dispatchRecords} inbox={visibleInbox} title={activeItem.label} unit={unit} userId={session.alfresco?.id || session.user?.id || ''} />
          : activePanel === 'documentos-recibidos' || activePanel === 'para-conocimiento' || activePanel === 'para-atencion'
            ? <DirectorPage key={activePanel} allowAlfresco={canReadAlfresco} canDispatch={isDirector && activePanel === 'documentos-recibidos'} canAssignResponsibility={isDirector} description={activeItem.description} dispatchRecords={dispatchRecords} inbox={visibleInbox} title={activeItem.label} mode={activePanel === 'para-atencion' ? 'attention' : 'received'} attentionIds={attentionIds} onDispatch={handleDispatch} onPersonalAttentionChange={selectPersonalAttention} onResponsibleChange={handleResponsibleChange} assigningDocumentIds={assigningDocumentIds} unitHeads={unitHeads} unitHeadsError={unitHeadsError} unitHeadsLoading={unitHeadsLoading} assignmentError={attentionError} openDocumentId={selectedDocumentId} onDocumentPreviewClose={() => setSelectedDocumentId('')} />
          : <ActivePage activePanel={activePanel} alfrescoDocuments={alfrescoDocuments} allowAlfresco={canReadAlfresco} allowAlfrescoUpload={canWriteAlfresco} description={activeItem.description} documents={alfrescoDocuments} inbox={{ ...inbox, documents: receivedDocuments }} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} />}</main>
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
    return <main className="login-page"><section className="login-card"><p className="breadcrumb">Gestión Documental UAC</p><h1>Acceso pendiente de configuración</h1><p className="form-message">{accessMessage}</p><div className="access-diagnostics"><p>Estado de rol: <strong>{session.authorizationStatus || 'no disponible'}</strong></p><p>Rol asignado: <strong>{session.roleId || 'sin rol'}</strong></p><p>Dependencia: <strong>{session.dependency || 'sin asignar'}</strong></p><p>Funcion: <strong>{session.functionalRole || session.functionalIdentity?.functionalRole || 'sin asignar'}</strong></p></div><button className="button-primary" onClick={() => logout(session).then(() => setSession(null))} type="button">Cerrar sesión</button></section></main>
  }
  return <ApplicationShell key={`${session.alfresco?.id}:${session.dependency}`} onLogout={() => logout(session).then(() => setSession(null))} session={session} />
}

export default App
