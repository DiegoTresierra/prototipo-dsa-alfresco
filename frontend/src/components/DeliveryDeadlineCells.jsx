import { deliveryDeadline, formatDeliveryDeadline } from '../utils/deliveryDeadline'

/* eslint-disable react/prop-types */
function DeadlineStatusIcon({ status }) {
  if (status === 'EN_PLAZO' || status === 'POR_VENCER') return <svg aria-label={status === 'POR_VENCER' ? 'Por vencer' : 'Dentro del plazo'} className="delivery-deadline-icon delivery-deadline-icon--within" height="18" role="img" viewBox="0 0 18 18" width="18"><title>{status === 'POR_VENCER' ? 'Por vencer' : 'Dentro del plazo'}</title><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="6.5" cy="7" r=".8" fill="currentColor" /><circle cx="11.5" cy="7" r=".8" fill="currentColor" /><path d="M5.7 10.2c.8 1.4 1.9 2.1 3.3 2.1s2.5-.7 3.3-2.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>
  if (status === 'VENCIDO') return <svg aria-label="Plazo vencido" className="delivery-deadline-icon delivery-deadline-icon--overdue" height="18" role="img" viewBox="0 0 18 18" width="18"><title>Plazo vencido</title><path d="M4 16V2m1 1h9l-2.1 2.5L14 8H5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /><path d="M5.5 3.7h7.2L11 5.5l1.7 1.8H5.5z" fill="currentColor" /></svg>
  return <span aria-label="Sin indicador de plazo" className="delivery-deadline-empty">—</span>
}

export function DeliveryDeadlineDateCell({ assignment }) {
  const deadline = deliveryDeadline(assignment)
  return <td>{deadline.dueAt ? <time dateTime={deadline.dueAt}>{formatDeliveryDeadline(deadline.dueAt)}</time> : 'No definida'}</td>
}

export function DeliveryDeadlineStatusCell({ assignment }) {
  const deadline = deliveryDeadline(assignment)
  const labels = { EN_PLAZO: 'Dentro del plazo', POR_VENCER: 'Por vencer', VENCIDO: 'Plazo vencido', ATENDIDO: 'Atendido', SIN_PLAZO_REGISTRADO: 'Sin plazo registrado' }
  const label = labels[deadline.status] || 'Estado no disponible'
  return <td className="delivery-deadline-status"><span title={label}><DeadlineStatusIcon status={deadline.status} /></span></td>
}

export function DeliveryDeadlineCells({ assignment }) {
  return <><DeliveryDeadlineDateCell assignment={assignment} /><DeliveryDeadlineStatusCell assignment={assignment} /></>
}
