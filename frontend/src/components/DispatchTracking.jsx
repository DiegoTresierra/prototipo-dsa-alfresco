/* eslint-disable react/prop-types */
import { useState } from 'react'
import { PanelPage } from './PanelPage'
import { formatDocumentDate } from '../utils/documentFormat'
import { dispatchTrackingRows } from '../utils/dispatchTracking'

function AssignmentTable({ rows, openDocument }) {
  return <div className="table-scroll">
    <table className="document-table">
      <thead><tr>
        {openDocument && <th scope="col">Documento</th>}
        <th scope="col">Unidad asignada</th>
        <th scope="col">Responsable</th>
        <th scope="col">Estado del encargo</th>
        <th scope="col">Fecha del despacho</th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        {openDocument && <td><button className="document-link" onClick={() => openDocument(row.documentId)} type="button">{row.documentName}</button></td>}
        <td title={row.unitId || undefined}>{row.unitName}</td>
        <td>{row.responsible}</td>
        <td><span className="status-label">{row.status}</span></td>
        <td>{formatDocumentDate(row.date)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function DispatchAssignmentDetails({ rows }) {
  const active = rows.filter((row) => row.active)
  const history = rows.filter((row) => !row.active)
  return <section className="dispatch-summary" aria-label="Detalle de encargos">
    <h3>Encargos activos</h3>
    {active.length ? <AssignmentTable rows={active} /> : <p>No hay encargos activos.</p>}
    <h3>Historial de encargos</h3>
    {history.length ? <AssignmentTable rows={history} /> : <p>No hay encargos históricos.</p>}
  </section>
}

export function DispatchTracking({ title, description, documents, dispatchRecords, error, loading }) {
  const [selectedId, setSelectedId] = useState('')
  const rows = error ? [] : dispatchTrackingRows(dispatchRecords, documents)
  const selected = rows.filter((row) => row.documentId === selectedId)
  return <PanelPage title={title} description={description}>
    {error ? <p className="form-message form-message--error" role="alert">{error}</p>
      : rows.length ? <AssignmentTable rows={rows} openDocument={setSelectedId} />
        : <p className="empty-state" role="status">{loading ? 'Consultando encargos…' : 'No hay encargos registrados para mostrar.'}</p>}
    {selected.length > 0 && <section className="document-preview" aria-label="Detalle del documento">
      <div className="document-preview__header">
        <h2>{selected[0].documentName}</h2>
        <button className="button-secondary" onClick={() => setSelectedId('')} type="button">Cerrar detalle</button>
      </div>
      <DispatchAssignmentDetails rows={selected} />
    </section>}
  </PanelPage>
}
