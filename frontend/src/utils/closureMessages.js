export function closureReasonMessage(code) {
  const messages = { OBLIGATIONS_PENDING: 'Hay obligaciones pendientes de atención.', CANCELLATION_EVIDENCE_MISSING: 'Falta acreditar la autorización de una anulación.',
    NO_CLASSIFIED_OBLIGATIONS: 'No hay obligaciones ni clasificación suficiente para decidir el cierre.', RECONCILIATION_REQUIRED: 'Existe una operación pendiente de conciliación.',
    KNOWLEDGE_CLASSIFICATION_UNVERIFIED: 'Falta verificar la clasificación de conocimiento.', PROPOSAL_EVIDENCE_INCOMPLETE: 'No se pudo verificar una propuesta relacionada.',
    PROJECTION_MISMATCH: 'Las responsabilidades registradas presentan una inconsistencia.', KNOWLEDGE_CONFIRMATIONS_PENDING: 'Faltan confirmaciones de conocimiento.',
    CLOSURE_RESULT_UNCERTAIN: 'El resultado es incierto: se requiere conciliación.', DISPATCH_INVALID_ASSIGNMENTS: 'No se pudo validar el registro de asignaciones.',
    CLOSURE_STALE_EVALUATION: 'Las asignaciones cambiaron; vuelve a evaluar.' }
  return messages[code] || `Requisito pendiente de verificar (${code}).`
}
