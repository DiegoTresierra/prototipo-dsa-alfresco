import { useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'

function App() {
  const [selectedRole, setSelectedRole] = useState('emisor')
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [documents, setDocuments] = useState([])
  const currentRole = roleDefinitions[selectedRole]
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
    const documentRecord = {
      ...documentData,
      id: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      status: 'Enviado (simulación)',
      createdAt: new Date().toISOString(),
    }

    setDocuments((currentDocuments) => [documentRecord, ...currentDocuments])
    setActivePanel('mis-envios')
  }

  return (
    <div className="app-shell">
      <Sidebar activePanel={activePanel} isOpen={isSidebarOpen} items={currentRole.menu} onNavigate={handleNavigate} onClose={() => setIsSidebarOpen(false)} />
      <div className="app-content">
        <TopBar onMenuClick={() => setIsSidebarOpen(true)} roleId={selectedRole} roleLabel={currentRole.label} onRoleChange={handleRoleChange} roles={roleDefinitions} />
        <main className="main-content"><ActivePage activePanel={activePanel} description={activeItem.description} documents={documents} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} /></main>
      </div>
    </div>
  )
}

export default App
