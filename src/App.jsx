import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'
import { loadAlfrescoConfirmedDocuments, loadStoredDocuments, recordAlfrescoConfirmedDocument } from './utils/documentStore'
import { uploadPdfToFolder } from './api/alfresco'
import { createDemoSession } from './auth/session'
import { LoginPage } from './components/LoginPage'
import { loadNotifications, saveNotifications } from './utils/notificationStore'
import { useAlfrescoInbox } from './hooks/useAlfrescoInbox'

/* eslint-disable react/prop-types */
function getInitialDocuments() {
  try {
    return loadStoredDocuments()
  } catch {
    return []
  }
}

function getInitialAlfrescoDocuments() {
  try {
    return loadAlfrescoConfirmedDocuments()
  } catch {
    return []
  }
}

function ApplicationShell({ session, onLogout }) {
  const canReadAlfresco = session.mode === 'authenticated' && session.permissions?.alfrescoRead === true
  const canWriteAlfresco = session.mode === 'authenticated' && session.permissions?.alfrescoWrite === true
  const [selectedRole, setSelectedRole] = useState(session.activeRole || session.user.role)
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [notifications, setNotifications] = useState(() => session.mode === 'demo' ? loadNotifications() : [])
  const [documents] = useState(getInitialDocuments)
  const [alfrescoDocuments, setAlfrescoDocuments] = useState(() => canReadAlfresco ? getInitialAlfrescoDocuments() : [])
  const uploadInFlight = useRef(false)
  const currentRole = roleDefinitions[selectedRole]
  const currentOffice = session.user
  const ActivePage = rolePages[selectedRole]
  const inboxFolderId = import.meta.env.VITE_ALFRESCO_INBOX_NODE_ID
  const isAlfrescoTestPanel = selectedRole === 'director' && activePanel === 'bandeja-pruebas-alfresco'
  const inboxMode = isAlfrescoTestPanel ? 'test' : 'dependency'
  const visibleMenu = currentRole.menu.filter((item) => !item.devOnly || import.meta.env.DEV)
  const inbox = useAlfrescoInbox({
    active: activePanel === 'para-conocimiento' || isAlfrescoTestPanel,
    allowed: canReadAlfresco || (import.meta.env.DEV && isAlfrescoTestPanel),
    folderId: inboxFolderId,
    dependencyId: session.user.dependencyId,
    mode: inboxMode,
  })
  const activeItem = visibleMenu.find((item) => item.id === activePanel) || visibleMenu[0]
  const availableRoles = session.mode === 'demo'
    ? roleDefinitions
    : Object.fromEntries(Object.entries(roleDefinitions).filter(([roleId]) => session.user.availableRoles.includes(roleId)))

  const handleRoleChange = (roleId) => {
    if (!Object.hasOwn(availableRoles, roleId)) return
    setSelectedRole(roleId)
    setActivePanel('inicio')
    setIsSidebarOpen(false)
  }

  const handleNavigate = (panelId) => {
    if (!visibleMenu.some((item) => item.id === panelId)) return
    setActivePanel(panelId)
    setIsSidebarOpen(false)
  }

  const handleNotificationUpdate = (updatedNotifications) => {
    setNotifications(updatedNotifications)
    if (session.mode === 'demo') saveNotifications(updatedNotifications)
  }

  const handleDocumentSubmit = async (documentData) => {
    if (!canWriteAlfresco) return { ok: false, error: 'El modo de demostración no permite enviar documentos a Alfresco.' }
    if (uploadInFlight.current) return { ok: false, error: 'Ya hay un envío en curso.' }
    uploadInFlight.current = true
    try {
      const emissionDate = new Date().toISOString()
      const entry = await uploadPdfToFolder(
        import.meta.env.VITE_ALFRESCO_INBOX_NODE_ID,
        documentData.mainDocumentFile,
        { title: documentData.subject, description: documentData.description },
      )
      if (!entry?.id) return { ok: false, error: 'Alfresco no confirmó la creación del documento.', uncertain: true }

      const metadata = { ...documentData }
      delete metadata.mainDocumentFile
      const confirmedData = { ...metadata, emissionDate }
      let confirmedDocuments
      let savedDocument
      let localWarning = ''
      try {
        const result = recordAlfrescoConfirmedDocument(confirmedData, entry)
        confirmedDocuments = result.documents
        savedDocument = result.document
      } catch {
        savedDocument = {
          ...confirmedData,
          id: entry.id,
          source: 'alfresco',
          status: 'Confirmado por Alfresco',
          createdAt: entry.createdAt || emissionDate,
        }
        confirmedDocuments = [savedDocument, ...alfrescoDocuments.filter((document) => document.id !== entry.id)]
        localWarning = 'Alfresco confirmó el envío, pero no se pudo actualizar el registro local del correlativo.'
      }

      setAlfrescoDocuments(confirmedDocuments)
      window.dispatchEvent(new Event('uac:alfresco-document-created'))
      return { ok: true, document: savedDocument, warning: localWarning }
    } catch (error) {
      return { ok: false, error: error?.message || 'No se pudo completar el envío a Alfresco.', uncertain: Boolean(error?.uncertain) }
    } finally {
      uploadInFlight.current = false
    }
  }

  return (
    <div className="app-shell">
      <Sidebar activePanel={activePanel} collapsed={isSidebarCollapsed} isOpen={isSidebarOpen} items={visibleMenu} onNavigate={handleNavigate} onClose={() => setIsSidebarOpen(false)} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} office={currentOffice} roleId={selectedRole} roles={availableRoles} onRoleChange={handleRoleChange} onLogout={onLogout} />
      <div className="app-content">
        <TopBar
          officeName={currentOffice.office}
          onMenuClick={() => setIsSidebarOpen(true)}
          notifications={notifications}
          onNotificationUpdate={handleNotificationUpdate}
          notificationMessage={canReadAlfresco ? 'Alfresco no expone un estado persistente de atención; el contador de pendientes no está disponible.' : ''}
        />
        <main className="main-content"><ActivePage activePanel={activePanel} alfrescoDocuments={alfrescoDocuments} allowAlfresco={canReadAlfresco} allowAlfrescoTestInbox={import.meta.env.DEV && isAlfrescoTestPanel} allowAlfrescoUpload={canWriteAlfresco} description={activeItem.description} documents={documents} inbox={inbox} inboxMode={inboxMode} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} /></main>
      </div>
    </div>
  )
}

function GoogleIdentityPage({ session, onLogout }) {
  return (
    <main className="google-identity-page">
      <section className="google-identity-card" aria-labelledby="google-identity-title">
        <p className="google-identity-card__eyebrow">Universidad Andina del Cusco</p>
        <h1 id="google-identity-title">Identidad de Google verificada</h1>
        <p>{session.user.name}</p>
        <p>{session.user.email}</p>
        <p className="google-identity-card__notice">Esta verificación no consulta una base de usuarios ni asigna un rol, dependencia o acceso a documentos.</p>
        <button className="login-button" onClick={onLogout} type="button">Cerrar sesión</button>
      </section>
    </main>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [sessionChecked, setSessionChecked] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result?.authenticated && result.mode === 'google_identity_only') setSession(result)
      })
      .catch(() => {})
      .finally(() => { if (active) setSessionChecked(true) })
    return () => { active = false }
  }, [])

  const handleGoogleLogin = useCallback(async () => {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' })
    const result = await response.json()
    if (!response.ok || !result.authenticated || result.mode !== 'google_identity_only') {
      throw new Error('No se pudo recuperar la identidad verificada.')
    }
    setSession(result)
  }, [])

  const handleLogout = useCallback(async () => {
    if (session?.mode === 'google_identity_only') {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    }
    setSession(null)
  }, [session?.mode])

  if (!session) {
    if (!sessionChecked) return null
    return <LoginPage onDemoLogin={(profileKey) => setSession(createDemoSession(profileKey))} onGoogleLogin={handleGoogleLogin} />
  }

  if (session.mode === 'google_identity_only') return <GoogleIdentityPage onLogout={handleLogout} session={session} />

  return <ApplicationShell key={session.user.id} onLogout={handleLogout} session={session} />
}

export default App
