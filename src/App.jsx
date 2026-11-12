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
import { DocumentForm } from './components/DocumentForm'
import { loadNotifications, saveNotifications } from './utils/notificationStore'
import { uploadPdfToFolder } from './api/alfresco'
import { useAlfrescoInbox } from './hooks/useAlfrescoInbox'
import { derivePersonCode, getIssuerCode } from './utils/issuerIdentifier'

/* eslint-disable react/prop-types */
function getInitialDocuments() {
  try { return loadStoredDocuments() } catch { return [] }
}

function getInitialAlfrescoDocuments() {
  try { return loadAlfrescoConfirmedDocuments() } catch { return [] }
}

function getDependencyInboxFolderId(dependencyId) {
  if (dependencyId === 'dti') return import.meta.env.VITE_ALFRESCO_DTI_INBOX_NODE_ID || ''
  if (dependencyId === 'dsa') return import.meta.env.VITE_ALFRESCO_DSA_INBOX_NODE_ID || ''
  return ''
}

function getAuthorizationMessage(status) {
  const messages = {
    'no-role-assigned': 'Alfresco verificó la identidad, pero no se encontró un grupo de función configurado. Asigna GD_DIRECCION, GD_JEFE_UNIDAD o GD_ESPECIALISTA.',
    'ambiguous-role': 'La cuenta pertenece a más de un grupo de función. Debe quedar asignada a un solo rol para habilitar el acceso.',
    'no-dependency-assigned': 'No se encontró el grupo de dependencia GD_DTI o GD_DSA para esta cuenta.',
    'ambiguous-dependency': 'La cuenta pertenece a más de un grupo de dependencia. Debe quedar asignada a una sola dependencia.',
  }
  return messages[status] || 'La identidad fue reconocida por Alfresco, pero su función o dependencia no está configurada.'
}

function ApplicationShell({ session, onLogout }) {
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [notifications, setNotifications] = useState(() => loadNotifications())
  const [documents] = useState(getInitialDocuments)
  const [alfrescoDocuments, setAlfrescoDocuments] = useState(getInitialAlfrescoDocuments)
  const uploadInFlight = useRef(false)
  const role = roleDefinitions[session.roleId]
  const canReadAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:read')
  const canWriteAlfresco = session.authorizationStatus === 'active' && session.capabilities?.includes('documents:write')
  const dependency = session.dependency || session.organizationalUnit || null
  const unit = session.unit || session.user?.unit || null
  const userName = session.user?.name || session.alfresco?.displayName || 'Usuario autenticado'
  const personCode = session.user?.documentCode || derivePersonCode(userName)
  const currentOffice = {
    acronym: dependency?.acronym || '',
    office: dependency?.name || dependency?.displayName || 'Dependencia no configurada',
    name: userName,
    position: session.user?.position || session.position || dependency?.position || role.label,
    dependencyId: dependency?.id || '',
    roleId: session.roleId,
    unitAcronym: unit?.acronym || '',
    unitName: unit?.name || '',
    personCode,
    issuerCode: getIssuerCode({ roleId: session.roleId, dependencyAcronym: dependency?.acronym, unitAcronym: unit?.acronym, personCode }),
  }
  const localScopeId = session.alfresco?.id || session.user?.id || ''
  const visibleMenu = role.menu.filter((item) => !item.devOnly || import.meta.env.DEV)
  const activeItem = visibleMenu.find((item) => item.id === activePanel) || visibleMenu[0]
  const inbox = useAlfrescoInbox({
    active: activePanel === 'documentos-recibidos',
    allowed: canReadAlfresco,
    folderId: getDependencyInboxFolderId(currentOffice.dependencyId),
    dependencyId: currentOffice.dependencyId,
    mode: 'dependency',
  })
  const hasDestinationFolders = Boolean(import.meta.env.VITE_ALFRESCO_DTI_INBOX_NODE_ID && import.meta.env.VITE_ALFRESCO_DSA_INBOX_NODE_ID)

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
    if (!currentOffice.acronym || !currentOffice.dependencyId || !currentOffice.issuerCode) return { ok: false, error: 'La sesión no incluye un código de emisor, unidad y dependencia verificados.' }
    const destinationFolderId = getDependencyInboxFolderId(documentData.destinationId)
    if (!destinationFolderId) return { ok: false, error: 'No está configurada una carpeta de recepción para la dependencia destinataria.' }
    if (uploadInFlight.current) return { ok: false, error: 'Ya hay un envío en curso.' }
    uploadInFlight.current = true
    try {
      const emissionDate = new Date().toISOString()
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

  const ActivePage = rolePages[session.roleId]
  return (
    <div className="app-shell">
      <Sidebar activePanel={activePanel} collapsed={isSidebarCollapsed} isOpen={isSidebarOpen} items={visibleMenu} office={currentOffice} roleLabel={role.label} onNavigate={handleNavigate} onClose={() => setIsSidebarOpen(false)} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} onLogout={onLogout} />
      <div className="app-content">
        <TopBar officeName={currentOffice.office} onMenuClick={() => setIsSidebarOpen(true)} notifications={notifications} onNotificationUpdate={handleNotificationUpdate} notificationMessage={canReadAlfresco ? 'Alfresco no expone un estado persistente de atención.' : ''} />
        <main className="main-content">{activePanel === 'nuevo-documento'
          ? <DocumentForm allowAlfrescoUpload={canWriteAlfresco && hasDestinationFolders && Boolean(currentOffice.acronym && currentOffice.dependencyId && currentOffice.issuerCode)} onSubmit={handleDocumentSubmit} panelLabel={`Panel ${role.label} · ${currentOffice.acronym}`} user={currentOffice} />
          : <ActivePage activePanel={activePanel} alfrescoDocuments={alfrescoDocuments} allowAlfresco={canReadAlfresco} allowAlfrescoTestInbox={canReadAlfresco && import.meta.env.DEV} allowAlfrescoUpload={canWriteAlfresco && hasDestinationFolders && Boolean(currentOffice.acronym && currentOffice.dependencyId && currentOffice.issuerCode)} description={activeItem.description} documents={documents} inbox={inbox} localScopeId={localScopeId} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} />}</main>
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
  if (!session.roleId || !roleDefinitions[session.roleId]) {
    return <main className="login-page"><section className="login-card"><p className="breadcrumb">Gestión Documental UAC</p><h1>Acceso pendiente de configuración</h1><p className="form-message">{getAuthorizationMessage(session.authorizationStatus)}</p><button className="button-primary" onClick={() => logout(session).then(() => setSession(null))} type="button">Cerrar sesión</button></section></main>
  }
  return <ApplicationShell key={session.alfresco?.id} onLogout={() => logout(session).then(() => setSession(null))} session={session} />
}

export default App
