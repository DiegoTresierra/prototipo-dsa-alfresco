import { useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { DocumentList } from '../components/DocumentList'
import { PdfPreview } from '../components/PdfPreview'

/* eslint-disable react/prop-types */
export function DirectorPage({ title, description, allowAlfresco = false, inbox }) {
  const [selectedDocument, setSelectedDocument] = useState(null)

  if (!allowAlfresco) {
    return <PanelPage description={description} title={title}><p className="form-message" role="status">La consulta requiere una sesion autenticada con permiso de lectura en Alfresco.</p></PanelPage>
  }

  const emptyMessage = inbox.error
    ? 'La lista no esta disponible hasta resolver el error de conexion.'
    : inbox.loading
      ? 'Consultando documentos en Alfresco...'
      : 'No hay documentos en las carpetas de recepción de esta dependencia.'

  return (
    <>
      <div className="inbox-toolbar">
        <div>{inbox.lastUpdated && <p className="table-secondary">Actualizado: {new Date(inbox.lastUpdated).toLocaleString('es-PE')}</p>}</div>
        <button className="button-secondary" disabled={inbox.loading || inbox.refreshing} onClick={inbox.refresh} type="button">
          {inbox.refreshing ? 'Actualizando...' : 'Actualizar bandeja'}
        </button>
      </div>
      {inbox.error && <p className="form-message form-message--error" role="alert">{inbox.error}</p>}
      <DocumentList
        description="Documentos de Alfresco almacenados en las carpetas de recepción de la dependencia."
        documents={inbox.documents}
        emptyMessage={emptyMessage}
        onSelectDocument={setSelectedDocument}
        selectedDocumentId={selectedDocument?.id}
        showAlfrescoDetails
        title={title}
      />
      {selectedDocument && <section aria-labelledby="document-preview-title" className="document-preview">
        <div className="document-preview__header">
          <div><p className="breadcrumb">Vista previa</p><h2 id="document-preview-title">{selectedDocument.attachmentName}</h2></div>
          <button className="button-secondary" onClick={() => setSelectedDocument(null)} type="button">Cerrar vista previa</button>
        </div>
        <PdfPreview declaredMimeType={selectedDocument.mimeType} fileName={selectedDocument.attachmentName} nodeId={selectedDocument.id} />
      </section>}
    </>
  )
}
