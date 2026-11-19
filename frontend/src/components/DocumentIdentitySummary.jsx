/* eslint-disable react/prop-types */
export function DocumentIdentitySummary({ identity = {}, dispatch }) {
  return <div className="dispatch-summary">
    <p><b>Emisor documental original:</b> {identity.originalDependency || 'No registrado'}</p>
    {identity.formalSender && <p>Remitente formal: {identity.formalSender}</p>}
    <p>Creado en Alfresco por: {identity.createdByUserId || 'No registrado'}</p>
    {Boolean(identity.emittedFolderEvidence?.length) && <p>Ubicación verificada en Emitidos: {identity.emittedFolderEvidence.join(', ')}. Esta ubicación no sustituye al origen documental registrado.</p>}
    {dispatch && <p><b>Despachado por:</b> {dispatch.senderUserId} · {dispatch.senderDependency?.toUpperCase()}</p>}
  </div>
}
