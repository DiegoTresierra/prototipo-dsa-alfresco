export const NEAR_DEADLINE_REMAINING_RATIO = 0.2
export const DEADLINE_PRIORITIES = Object.freeze({ Normal: 'NORMAL', Alta: 'ALTA', Urgente: 'URGENTE' })
const durationMs = Object.freeze({ DIAS: 24 * 60 * 60 * 1000, HORAS: 60 * 60 * 1000 })

export function isValidDeadlineSnapshot(snapshot, priority) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      Object.keys(snapshot).some(key => !['priority', 'value', 'unit', 'startedAt', 'dueAt', 'initialDurationMs', 'configRevision', 'configSource'].includes(key)) ||
      snapshot.priority !== DEADLINE_PRIORITIES[priority] || !Number.isSafeInteger(snapshot.value) || snapshot.value <= 0 ||
      !durationMs[snapshot.unit] || !Number.isFinite(Date.parse(snapshot.startedAt)) || !Number.isFinite(Date.parse(snapshot.dueAt)) ||
      !Number.isSafeInteger(snapshot.initialDurationMs) || snapshot.initialDurationMs !== snapshot.value * durationMs[snapshot.unit] ||
      Date.parse(snapshot.dueAt) !== Date.parse(snapshot.startedAt) + snapshot.initialDurationMs ||
      snapshot.configRevision !== null && typeof snapshot.configRevision !== 'string' || !['DEFAULT', 'ALFRESCO'].includes(snapshot.configSource)) return false
  return true
}

export function createDeadlineSnapshot({ priority, startedAt, settings }) {
  const normalizedPriority = DEADLINE_PRIORITIES[priority]
  const configured = settings?.values?.find((entry) => entry.priority === normalizedPriority)
  if (!normalizedPriority || !configured || !Number.isSafeInteger(configured.value) || configured.value <= 0 ||
      !durationMs[configured.unit] || !Number.isFinite(Date.parse(startedAt))) {
    throw Object.assign(new Error('ASSIGNMENT_DEADLINE_CONFIGURATION_INVALID'), { status: 503 })
  }
  const initialDurationMs = configured.value * durationMs[configured.unit]
  return {
    priority: normalizedPriority,
    value: configured.value,
    unit: configured.unit,
    startedAt,
    dueAt: new Date(Date.parse(startedAt) + initialDurationMs).toISOString(),
    initialDurationMs,
    configRevision: settings.revision || null,
    configSource: settings.source || 'DEFAULT',
  }
}

export function evaluateAssignmentDeadline(assignment, now = Date.now()) {
  const snapshot = assignment?.deadlineSnapshot
  if (!snapshot || !Number.isFinite(Date.parse(snapshot.dueAt)) || !Number.isSafeInteger(snapshot.initialDurationMs)) {
    return { status: 'SIN_PLAZO_REGISTRADO', dueAt: null, remainingMs: null, initialDurationMs: null }
  }
  const remainingMs = Date.parse(snapshot.dueAt) - (now instanceof Date ? now.getTime() : now)
  if (assignment.status === 'ATENDIDO') {
    return { status: 'ATENDIDO', dueAt: snapshot.dueAt, remainingMs: Math.max(0, remainingMs), initialDurationMs: snapshot.initialDurationMs }
  }
  if (remainingMs <= 0) return { status: 'VENCIDO', dueAt: snapshot.dueAt, remainingMs, initialDurationMs: snapshot.initialDurationMs }
  if (remainingMs <= snapshot.initialDurationMs * NEAR_DEADLINE_REMAINING_RATIO) {
    return { status: 'POR_VENCER', dueAt: snapshot.dueAt, remainingMs, initialDurationMs: snapshot.initialDurationMs }
  }
  return { status: 'EN_PLAZO', dueAt: snapshot.dueAt, remainingMs, initialDurationMs: snapshot.initialDurationMs }
}

export function withAssignmentDeadlines(dispatch, now = Date.now()) {
  return { ...dispatch, recipients: (dispatch.recipients || []).map((assignment) => ({
    ...assignment,
    deadline: evaluateAssignmentDeadline(assignment, now),
  })) }
}
