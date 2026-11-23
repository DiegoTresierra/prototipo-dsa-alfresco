import test from 'node:test'
import assert from 'node:assert/strict'
import { createHierarchyAuditReadService } from './hierarchyAuditReadService.js'

const fixtureEvent = {
  id: 'event-1', fechaEvento: '2026-11-22T10:30:00.000Z', operationType: 'reasignacion-especialista',
  faseEvento: 'PARCIAL', accionEvento: 'OPERACION_PARCIAL', actorEvento: 'director-dsa',
  idUnidadEvento: 'unit-dsa', idUsuarioEvento: 'staff-dsa', idOperacionEvento: 'private-operation',
  nodeType: 'gdo:eventoJerarquia', parentId: 'private-container', codigoErrorEvento: 'PRIVATE_ERROR',
  datosAntesEvento: JSON.stringify({ sourceUnitId: 'unit-source', status: 'ACTIVA', token: 'should-not-leak' }),
  datosDespuesEvento: JSON.stringify({ destinationUnitId: 'unit-destination', kind: 'reasignacion-especialista', userId: 'staff-dsa', internal: 'hidden' }),
}

test('lists sanitized audit events using the session dependency and validated server filters', async () => {
  let query
  const service = createHierarchyAuditReadService({
    async listEvents(input) {
      query = input
      return { events: [fixtureEvent], pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1, hasMoreItems: false } }
    },
  })
  const result = await service.list({ dependency: 'DSA', query: { operationType: 'reasignacion-especialista', phase: 'PARCIAL', from: '2026-11-22', to: '2026-11-22' } })
  assert.equal(query.dependency, 'DSA')
  assert.equal(query.pageSize, 25)
  assert.equal(query.operationType, 'reasignacion-especialista')
  assert.equal(query.to, '2026-11-22T23:59:59.999Z')
  assert.deepEqual(result.events[0], {
    id: 'event-1', occurredAt: fixtureEvent.fechaEvento, operationType: 'reasignacion-especialista',
    phase: 'PARCIAL', actor: 'director-dsa', unitId: 'unit-dsa',
    unitName: null, unitCode: null, userId: 'staff-dsa', beforeData: { sourceUnitId: 'unit-source', status: 'ACTIVA' },
    afterData: { kind: 'reasignacion-especialista', destinationUnitId: 'unit-destination', userId: 'staff-dsa' },
  })
  assert.equal(JSON.stringify(result).includes('private-operation'), false)
  assert.equal(JSON.stringify(result).includes('PRIVATE_ERROR'), false)
  assert.equal(JSON.stringify(result).includes('private-container'), false)
  assert.equal(JSON.stringify(result).includes('token'), false)
})

test('rejects invalid page bounds, filters and date ranges before reading Alfresco', async () => {
  let calls = 0
  const service = createHierarchyAuditReadService({ async listEvents() { calls++; return { events: [], pagination: {} } } })
  for (const query of [
    { page: '0' }, { pageSize: '101' }, { phase: 'INVENTADA' }, { operationType: 'otra' },
    { from: '2026-02-30' }, { from: '2026-11-23', to: '2026-11-22' }, { page: ['1', '2'] },
  ]) await assert.rejects(service.list({ dependency: 'DSA', query }), { status: 400 })
  await assert.rejects(service.list({ dependency: '', query: {} }), { status: 403 })
  assert.equal(calls, 0)
})

test('does not replace repository communication errors with empty history', async () => {
  const service = createHierarchyAuditReadService({ async listEvents() { throw Object.assign(new Error('REST unavailable'), { status: 503 }) } })
  await assert.rejects(service.list({ dependency: 'DSA' }), /REST unavailable/)
})
