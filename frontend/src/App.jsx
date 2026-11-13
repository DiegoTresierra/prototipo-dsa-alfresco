import { useEffect, useRef, useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'
import { loadAlfrescoConfirmedDocuments, recordAlfrescoConfirmedDocument } from './utils/documentStore'
import { getAuthStatus, getSession, logout } from './auth'
import { LoginPage } from './components/LoginPage'
import { getDirectorOfficeInboxes, uploadPdfToDirectorInbox, uploadPdfToFolder } from './api/alfresco'
import { useAlfrescoInbox } from './hooks/useAlfrescoInbox'
import { DirectorPage } from './pages/DirectorPage'
import { getDashboardRoleId } from './auth/authorization'
import { DocumentForm } from './components/DocumentForm'
import { recipientDependencies } from './data/emisorCatalog'
import { derivePersonCode, getIssuerCode } from './utils/issuerIdentifier'

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
  const [notifications, setNotifications] = useState([])
  const [officeInboxFolders, setOfficeInboxFolders] = useState(null)
  const [officeInboxError, setOfficeInboxError] = useState('')
  const [alfrescoDocuments, setAlfrescoDocuments] = useState(getInitialAlfrescoDocuments)
  const uploadInFlight = useRef(false)
  const deliveryKey = useRef('')
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
    if (!isDirector) return undefined
    let active = true
    getDirectorOfficeInboxes()
      .then((folders) => { if (active) { setOfficeInboxFolders(folders); setOfficeInboxError('') } })
      .catch((error) => { if (active) setOfficeInboxError(error.message) })
    return () => { active = false }
  }, [isDirector, session.dependency])
  const visibleMenu = role.menu.filter((item) => !item.devOnly || import.meta.env.DEV)
  const activeItem = visibleMenu.find((item) => item.id === activePanel) || visibleMenu[0]
  const inboxFolderIds = isDirector
    ? activePanel === 'para-conocimiento'
      ? [officeInboxFolders?.porConocimiento]
      : activePanel === 'para-atencion'
        ? [officeInboxFolders?.porAtender]
        : [officeInboxFolders?.porAtender, officeInboxFolders?.porConocimiento]
    : [session.userInboxNodeId || '']
  const inbox = useAlfrescoInbox({
    active: activePanel === 'inicio' || activePanel === 'para-conocimiento' || activePanel === 'para-atencion' || activePanel === 'documentos-recibidos',
    allowed: canReadAlfresco,
    folderIds: inboxFolderIds,
  })

  const handleNavigate = (panelId) => {
    if (!visibleMenu.some((item) => item.id === panelId)) return
    setActivePanel(panelId)
    setIsSidebarOpen(false)
  }

  const handleNotificationUpdate = (updatedNotifications) => {
    setNotifications(updatedNotifications)
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
        if (!deliveryKey.current) deliveryKey.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const delivery = await uploadPdfToDirectorInbox(documentData.mainDocumentFile, {
          title: documentData.subject,
          description: documentData.description,
          recipientDependencyId: documentData.recipientDependencyId,
          receiptCategory: documentData.receiptCategory,
          deliveryKey: deliveryKey.current,
          metadata: {
            number: documentData.documentNumber,
            documentDate: documentData.documentDate,
            originDependency: currentOffice.dependencyId.toUpperCase(),
            destinationDependency: documentData.recipientDependencyId.toUpperCase(),
            sender: currentOffice.name,
            recipient: documentData.recipientName,
            documentType: documentData.documentType,
            state: documentData.receiptCategory.replaceAll('-', '_').toUpperCase(),
            currentResponsible: documentData.recipientName,
            currentResponsibleDependency: documentData.recipientDependencyId.toUpperCase(),
          },
        }, session.csrfToken)
        entry = delivery.emittedEntry
        receivedNodeId = delivery.receivedEntry.id
      } else {
        entry = await uploadPdfToFolder(documentData.recipientInboxNodeId, documentData.mainDocumentFile, {
          title: documentData.subject,
          description: documentData.description,
        }, session.csrfToken, documentData.recipientUserId)
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
        }
        nextDocuments = [document, ...alfrescoDocuments]
        warning = 'Alfresco creó el documento, pero no se pudo guardar su resumen en este navegador.'
      }
      setAlfrescoDocuments(nextDocuments)
      window.dispatchEvent(new Event('uac:alfresco-document-created'))
      deliveryKey.current = ''
      return { ok: true, document, warning }
    } catch (error) {
      return { ok: false, error: error?.message || 'No se pudo completar el envío a Alfresco.', uncertain: Boolean(error?.uncertain) }
    } finally {
      uploadInFlight.current = false
    }
  }

  const ActivePage = rolePages[getDashboardRoleId(session)]
  return (
    <div className="app-shell">
      <Sidebar activePanel={activePanel} collapsed={isSidebarCollapsed} isOpen={isSidebarOpen} items={visibleMenu} office={currentOffice} roleLabel={role.label} onNavigate={handleNavigate} onClose={() => setIsSidebarOpen(false)} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} onLogout={onLogout} />
      <div className="app-content">
        <TopBar officeName={currentOffice.office} onMenuClick={() => setIsSidebarOpen(true)} notifications={notifications} onNotificationUpdate={handleNotificationUpdate} notificationMessage={canReadAlfresco ? 'Alfresco no expone un estado persistente de atención.' : ''} />
        <main className="main-content">{activePanel === 'nuevo-documento'
          ? <DocumentForm allowAlfrescoUpload={canWriteAlfresco} onSubmit={handleDocumentSubmit} panelLabel={`Panel ${role.label} · ${currentOffice.acronym}`} user={currentOffice} />
          : activePanel === 'documentos-recibidos' || activePanel === 'para-conocimiento' || activePanel === 'para-atencion'
            ? <DirectorPage allowAlfresco={canReadAlfresco} description={activeItem.description} inbox={{ ...inbox, error: inbox.error || officeInboxError }} title={activeItem.label} />
          : <ActivePage activePanel={activePanel} alfrescoDocuments={alfrescoDocuments} allowAlfresco={canReadAlfresco} allowAlfrescoUpload={canWriteAlfresco} description={activeItem.description} documents={alfrescoDocuments} inbox={inbox} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} />}</main>
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
  return <ApplicationShell key={session.alfresco?.id} onLogout={() => logout(session).then(() => setSession(null))} session={session} />
}

export default App
