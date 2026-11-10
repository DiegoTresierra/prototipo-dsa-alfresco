import { useState } from 'react'
import { PanelPage } from '../components/PanelPage'
import { DocumentList } from '../components/DocumentList'
import { PdfPreview } from '../components/PdfPreview'

/* eslint-disable react/prop-types */
export function DirectorPage({ title, description, allowAlfresco = false, allowAlfrescoTestInbox = false, inboxMode = 'dependency', inbox }) {
  const [selectedDocument, setSelectedDocument] = useState(null)
  const isTestInbox = inboxMode === 'test'

  if (!allowAlfresco && !allowAlfrescoTestInbox) {
    return <PanelPage description={description} title={title}><p className="form-message" role="status">La consulta requiere una sesión con permisos de lectura autorizados para Alfresco.</p></PanelPage>
  }

  const emptyMessage = inbox.error
    ? 'La lista no está disponible hasta resolver el error de conexión.'
    : inbox.loading
      ? 'Consultando documentos en Alfresco…'
      : isTestInbox
        ? 'No se encontraron archivos PDF en la carpeta compartida de pruebas DEV.'
        : inbox.unclassifiedCount > 0
        ? 'Hay archivos en la carpeta de pruebas, pero Alfresco no proporciona el destinatario para clasificarlos por dependencia. No se muestran como recibidos.'
        : 'No hay documentos identificados para esta dependencia.'

  return (
    <>
      <div className="inbox-toolbar">
        <div>
          {inbox.lastUpdated && <p className="table-secondary">Actualizado: {new Date(inbox.lastUpdated).toLocaleString('es-PE')}</p>}
        </div>
        <button className="button-secondary" disabled={inbox.loading || inbox.refreshing} onClick={inbox.refresh} type="button">
          {inbox.refreshing ? 'Actualizando…' : 'Actualizar bandeja'}
        </button>
      </div>
      {inbox.error && <p className="form-message form-message--error" role="alert">{inbox.error}</p>}
      <DocumentList
        description={isTestInbox
          ? 'Listado técnico de PDF recuperados de la carpeta compartida DEV. Los archivos no se atribuyen a DTI, DSA ni a otra dependencia.'
          : 'Documentos de Alfresco cuyo destinatario coincide con esta dependencia.'}
        documents={inbox.documents}
        emptyMessage={emptyMessage}
        onSelectDocument={setSelectedDocument}
        selectedDocumentId={selectedDocument?.id}
        showAlfrescoDetails
        title={title}
      />
      {selectedDocument && (
        <section aria-labelledby="document-preview-title" className="document-preview">
          <div className="document-preview__header">
            <div>
              <p className="breadcrumb">Vista previa</p>
              <h2 id="document-preview-title">{selectedDocument.attachmentName}</h2>
            </div>
            <button className="button-secondary" onClick={() => setSelectedDocument(null)} type="button">Cerrar vista previa</button>
          </div>
          <PdfPreview declaredMimeType={selectedDocument.mimeType} fileName={selectedDocument.attachmentName} nodeId={selectedDocument.id} />
        </section>
      )}
    </>
  )
}
