import test from 'node:test'
import assert from 'node:assert/strict'
import { numberingScope, reserveDocumentNumber } from './numberingStore.js'

test('Lima numbering cycle starts January 2 and ends January 1', () => {
  assert.equal(numberingScope('DTI-UNIT', new Date('2027-01-02T04:59:59Z')).cycle, 2026)
  assert.equal(numberingScope('DTI-UNIT', new Date('2027-01-02T05:00:00Z')).cycle, 2027)
  assert.equal(numberingScope('DSA', new Date('2026-01-01T12:00:00Z')).cycle, 2025)
  assert.deepEqual(numberingScope('DTI-UNIT-SIGN', new Date('2026-11-18T12:00:00Z')), {
    documentCode: 'DTI-UNIT-SIGN', cycle: 2026, startsOn: '2026-01-02', endsOn: '2027-01-01',
  })
  assert.throws(() => numberingScope(''), /NUMBERING_SCOPE_REQUIRED/)
})

test('official allocation fails closed without writing the legacy JSON', () => {
  assert.throws(() => reserveDocumentNumber({ documentCode: 'DTI', cycle: 2026 }),
    { message: 'NUMBERING_ATOMIC_RESERVATION_REQUIRED', status: 503 })
})
