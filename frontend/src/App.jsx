import { useEffect, useRef, useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'
import { loadAlfrescoConfirmedDocuments, loadStoredDocuments, recordAlfrescoConfirmedDocument } from './utils/documentStore'
import { getAuthStatus, getSession, logout } from './auth'
import { LoginPage } from './components/LoginPage'
import { loadNotifications, saveNotifications } from './utils/notificationStore'
import { uploadPdfToFolder } from './api/alfresco'
import { useAlfrescoInbox } from './hooks/useAlfrescoInbox'
import { getDashboardRoleId } from './auth/authorization'
import { DocumentForm } from './components/DocumentForm'
import { recipientDependencies } from './data/emisorCatalog'
import { derivePersonCode, getIssuerCode } from './utils/issuerIdentifier'

/* eslint-disable react/prop-types */
function getInitialDocuments() {
  try { return loadStoredDocuments() } catch { return [] }
}

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

function getInboxFolderId(dependencyId) {
  if (dependencyId === 'dti') return import.meta.env.VITE_ALFRESCO_DTI_INBOX_NODE_ID || import.meta.env.VITE_ALFRESCO_INBOX_NODE_ID || ''
  if (dependencyId === 'dsa') return import.meta.env.VITE_ALFRESCO_DSA_INBOX_NODE_ID || import.meta.env.VITE_ALFRESCO_INBOX_NODE_ID || ''
  return ''
}

function ApplicationShell({ session, onLogout }) {
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [notifications, setNotifications] = useState(() => loadNotifications())
  const [documents] = useState(getInitialDocuments)
  const [alfrescoDocuments, setAlfrescoDocuments] = useState(getInitialAlfrescoDocuments)
  const uploadInFlight = useRef(false)
  const role = roleDefinitions[getDashboardRoleId(session)]
  const canReadAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:read')
  const canWriteAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:write')
  const dependency = dependencyProfile(session.dependency)
  const unit = session.unit || session.user?.unit || session.functionalIdentity?.unit || null
  const userName = session.user?.name || session.alfresco?.displayName || session.alfresco?.id
  const personCode = session.user?.documentCode || derivePersonCode(userName)
  const currentOffice = {
    acronym: dependency.acronym,
    office: dependency.name || role.label,
    name: session.user?.name || session.alfresco?.displayName || session.alfresco?.id,
    position: session.user?.position || role.label,
    dependencyId: dependency.id,
    roleId: session.roleId,
    unitAcronym: unit?.acronym || unit?.code || '',
    unitName: unit?.name || '',
    personCode,
    issuerCode: getIssuerCode({ roleId: session.roleId, dependencyAcronym: dependency.acronym, unitAcronym: unit?.acronym || unit?.code, personCode }),
  }
  const visibleMenu = role.menu.filter((item) => !item.devOnly || import.meta.env.DEV)
  const activeItem = visibleMenu.find((item) => item.id === activePanel) || visibleMenu[0]
  const inbox = useAlfrescoInbox({
    active: activePanel === 'para-conocimiento' || activePanel === 'documentos-recibidos' || activePanel === 'bandeja-pruebas-alfresco',
    allowed: canReadAlfresco,
    folderId: getInboxFolderId(currentOffice.dependencyId),
    dependencyId: currentOffice.dependencyId,
    mode: activePanel === 'bandeja-pruebas-alfresco' ? 'test' : 'dependency',
  })

  const handleNavigate = (panelId) => {
    if (!visibleMenu.some((item) => item.id === panelId)) return
    setActivePanel(panelId)
    setIsSidebarOpen(false)
  }

  const handleNotificationUpdate = (updatedNotifications) => {
    setNotifications(updatedNotifications)
    saveNotifications(updatedNotifications)
  }

  const handleDocumentSubmit = async (documentData) => {
    if (!canWriteAlfresco) return { ok: false, error: 'La función autenticada no tiene permiso para cargar documentos.' }
    if (uploadInFlight.current) return { ok: false, error: 'Ya hay un envío en curso.' }
    uploadInFlight.current = true
    try {
      const emissionDate = new Date().toISOString()
      const destinationFolderId = getInboxFolderId(documentData.destinationId || currentOffice.dependencyId)
      if (!destinationFolderId) return { ok: false, error: 'No existe una carpeta Alfresco configurada para la dependencia destinataria.' }
      const entry = await uploadPdfToFolder(destinationFolderId, documentData.mainDocumentFile, {
        title: documentData.subject,
        description: documentData.description,
      }, session.csrfToken)
      const metadata = { ...documentData }
      delete metadata.mainDocumentFile
      const result = recordAlfrescoConfirmedDocument({ ...metadata, emissionDate }, entry)
      setAlfrescoDocuments(result.documents)
      window.dispatchEvent(new Event('uac:alfresco-document-created'))
      return { ok: true, document: result.document }
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
          ? <DocumentForm allowAlfrescoUpload={canWriteAlfresco && Boolean(currentOffice.issuerCode)} onSubmit={handleDocumentSubmit} panelLabel={`Panel ${role.label} · ${currentOffice.acronym}`} user={currentOffice} />
          : <ActivePage activePanel={activePanel} alfrescoDocuments={alfrescoDocuments} allowAlfresco={canReadAlfresco} allowAlfrescoTestInbox={canReadAlfresco && import.meta.env.DEV} allowAlfrescoUpload={canWriteAlfresco} description={activeItem.description} documents={documents} inbox={inbox} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} />}</main>
      </div>
    </div>
  )
}

function App() {
  const [session, setSession] = useState(undefined)
  const [authStatus, setAuthStatus] = useState(undefined)
  const [sessionError, setSessionError] = useState('')

  useEffect(() => {
    Promise.all([getSession(), getAuthStatus()])
      .then(([nextSession, nextStatus]) => { setSession(nextSession); setAuthStatus(nextStatus) })
      .catch((error) => setSessionError(error.message))
  }, [])

  if (sessionError) return <main className="login-page"><p className="form-message form-message--error">{sessionError}</p></main>
  if (session === undefined || authStatus === undefined) return <main className="login-page"><p>Comprobando sesión...</p></main>
  if (session === null) return <LoginPage basicAuthEnabled={authStatus.basicAuthEnabled} onAuthenticated={setSession} />
  const dashboardRoleId = getDashboardRoleId(session)
  if (!dashboardRoleId || !roleDefinitions[dashboardRoleId] || !rolePages[dashboardRoleId]) {
    return <main className="login-page"><section className="login-card"><p className="breadcrumb">Gestión Documental UAC</p><h1>Acceso pendiente de configuración</h1><p className="form-message">La identidad fue reconocida por Alfresco, pero no tiene una función documental configurada.</p><button className="button-primary" onClick={() => logout(session).then(() => setSession(null))} type="button">Cerrar sesión</button></section></main>
  }
  return <ApplicationShell key={session.alfresco?.id} onLogout={() => logout(session).then(() => setSession(null))} session={session} />
}

export default App
