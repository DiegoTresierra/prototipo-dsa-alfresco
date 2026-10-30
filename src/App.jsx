import { useRef, useState } from 'react'
import './App.css'
import './components/Sidebar.css'
import './components/TopBar.css'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { roleDefinitions } from './config/roles'
import { rolePages } from './pages'
import { loadAlfrescoConfirmedDocuments, loadStoredDocuments, recordAlfrescoConfirmedDocument } from './utils/documentStore'
import { directorProfiles } from './data/simulatedSession'
import { uploadPdfToFolder } from './api/alfresco'

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

function App() {
  const [selectedRole, setSelectedRole] = useState('director-dti')
  const [activePanel, setActivePanel] = useState('inicio')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [documents] = useState(getInitialDocuments)
  const [alfrescoDocuments, setAlfrescoDocuments] = useState(getInitialAlfrescoDocuments)
  const uploadInFlight = useRef(false)
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

  const handleDocumentSubmit = async (documentData) => {
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
      return { ok: true, document: savedDocument, warning: localWarning }
    } catch (error) {
      return { ok: false, error: error?.message || 'No se pudo completar el envío a Alfresco.', uncertain: Boolean(error?.uncertain) }
    } finally {
      uploadInFlight.current = false
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
        <main className="main-content"><ActivePage activePanel={activePanel} alfrescoDocuments={alfrescoDocuments} description={activeItem.description} documents={documents} office={currentOffice} onDocumentSubmit={handleDocumentSubmit} title={activeItem.label} /></main>
      </div>
    </div>
  )
}

export default App
