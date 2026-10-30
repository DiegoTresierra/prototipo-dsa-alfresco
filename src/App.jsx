import { useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'
import { loadStoredDocuments, saveSimulatedDocument } from './utils/documentStore'
import { directorProfiles } from './data/simulatedSession'

function getInitialDocuments() {
  try {
    return loadStoredDocuments()
  } catch {
    return []
  }
}

function App() {
  const [selectedRole, setSelectedRole] = useState('director-dti')
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [documents, setDocuments] = useState(getInitialDocuments)
  const currentRole = roleDefinitions[selectedRole]
  const currentOffice = selectedRole === 'director-dti' ? directorProfiles.DTI : directorProfiles.DSA
  const ActivePage = rolePages[selectedRole]
  const activeItem = currentRole.menu.find((item) => item.id === activePanel) || currentRole.menu[0]

  const handleRoleChange = (roleId) => {
    setSelectedRole(roleId)
    setActivePanel('inicio')
    setIsSidebarOpen(false)
  }

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
          onRoleChange={handleRoleChange}
          profileName={currentOffice.name}
          roleId={selectedRole}
          roleLabel={currentRole.label}
          roles={roleDefinitions}
        />
        <main className="main-content"><ActivePage activePanel={activePanel} description={activeItem.description} documents={documents} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} /></main>
      </div>
    </div>
  )
}

export default App
