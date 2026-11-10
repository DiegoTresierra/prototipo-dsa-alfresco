import { useEffect, useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'
import { loadStoredDocuments, saveSimulatedDocument } from './utils/documentStore'
import { getAuthStatus, getSession, logout } from './auth'
import { LoginPage } from './components/LoginPage'

function getInitialDocuments() {
  try {
    return loadStoredDocuments()
  } catch {
    return []
  }
}

function App() {
  const [session, setSession] = useState(undefined)
  const [sessionError, setSessionError] = useState('')
  const [authStatus, setAuthStatus] = useState(undefined)
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [documents, setDocuments] = useState(getInitialDocuments)
  useEffect(() => {
    Promise.all([getSession(), getAuthStatus()])
      .then(([nextSession, nextStatus]) => {
        setSession(nextSession)
        setAuthStatus(nextStatus)
      })
      .catch((error) => setSessionError(error.message))
  }, [])

  if (sessionError) return <main className="login-page"><p className="form-message form-message--error">{sessionError}</p></main>
  if (session === undefined || authStatus === undefined) return <main className="login-page"><p>Comprobando sesión...</p></main>
  if (session === null) return <LoginPage basicAuthEnabled={authStatus.basicAuthEnabled} onAuthenticated={setSession} />
  if (!session.roleId || !roleDefinitions[session.roleId]) {
    return (
      <main className="login-page">
        <section className="login-card">
          <p className="breadcrumb">Gestión Documental UAC</p>
          <h1>Acceso pendiente de configuración</h1>
          <p className="form-message">La identidad fue reconocida por Alfresco, pero no tiene una función documental configurada.</p>
          <button className="button-primary" onClick={() => logout(session).then(() => setSession(null))} type="button">Cerrar sesión</button>
        </section>
      </main>
    )
  }

  const selectedRole = session.roleId
  const currentRole = roleDefinitions[selectedRole]
  const officeByRole = selectedRole === 'director-dti'
    ? { acronym: 'DTI', office: 'Dirección de Tecnologías de Información' }
    : selectedRole === 'director-dsa'
      ? { acronym: 'DSA', office: 'Dirección de Servicios Académicos' }
      : { acronym: 'UAC', office: 'Gestión Documental' }
  const currentOffice = {
    ...officeByRole,
    id: session.alfresco.id,
    name: session.user?.name || session.alfresco.displayName || session.alfresco.id,
    position: currentRole.label,
  }
  const ActivePage = rolePages[selectedRole]
  const activeItem = currentRole.menu.find((item) => item.id === activePanel) || currentRole.menu[0]

  const handleNavigate = (panelId) => {
    setActivePanel(panelId)
    setIsSidebarOpen(false)
  }

  const handleDocumentSubmit = (documentData) => {
    try {
      const result = saveSimulatedDocument(documentData)
      setDocuments(result.documents)
      setActivePanel(selectedRole.startsWith('director-') ? 'documentos-enviados' : 'mis-envios')
      return { ok: true, document: result.document }
    } catch {
      return { ok: false, error: 'No se pudo registrar el documento en el almacenamiento local.' }
    }
  }

  return (
    <div className="app-shell">
      <Sidebar activePanel={activePanel} isOpen={isSidebarOpen} items={currentRole.menu} onNavigate={handleNavigate} onClose={() => setIsSidebarOpen(false)} officeAcronym={currentOffice.acronym} />
      <div className="app-content">
        <TopBar
          officeAcronym={currentOffice.acronym}
          officeName={currentOffice.office}
          onMenuClick={() => setIsSidebarOpen(true)}
          profileName={currentOffice.name}
          roleLabel={currentRole.label}
          session={session}
          onLogout={() => logout(session).then(() => setSession(null))}
        />
        <main className="main-content"><ActivePage activePanel={activePanel} description={activeItem.description} documents={documents} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} /></main>
      </div>
    </div>
  )
}

export default App
