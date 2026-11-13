import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from './config.js'
import { reserveDocumentNumber } from './numberingStore.js'

test('reserves persistent correlatives by dependency, unit, type and year', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-numbering-'))
  const previousPath = config.numberingStorePath
  config.numberingStorePath = path.join(directory, 'document-numbers.json')
  try {
    const first = reserveDocumentNumber({ dependency: 'DSA', unit: { code: 'DSA-01' }, documentType: 'OFICIO', period: '2026 - I' })
    const second = reserveDocumentNumber({ dependency: 'DSA', unit: { code: 'DSA-01' }, documentType: 'OFICIO', period: '2026 - I' })
    const otherUnit = reserveDocumentNumber({ dependency: 'DSA', unit: { code: 'DSA-02' }, documentType: 'OFICIO', period: '2026 - I' })
    assert.equal(first.originalConsecutive, '0001')
    assert.equal(second.originalConsecutive, '0002')
    assert.equal(otherUnit.originalConsecutive, '0001')
  } finally {
    config.numberingStorePath = previousPath
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
