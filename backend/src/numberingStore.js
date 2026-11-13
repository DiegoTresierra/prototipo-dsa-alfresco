import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

function readState() {
  try {
    if (!fs.existsSync(config.numberingStorePath)) return {}
    const state = JSON.parse(fs.readFileSync(config.numberingStorePath, 'utf8'))
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  } catch {
    throw new Error('NUMBERING_STORE_UNAVAILABLE')
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(config.numberingStorePath), { recursive: true })
    const temporaryPath = `${config.numberingStorePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(temporaryPath, config.numberingStorePath)
  } catch {
    throw new Error('NUMBERING_STORE_UNAVAILABLE')
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function unitCode(unit) {
  return String(unit?.code || unit?.acronym || '').trim()
}

export function reserveDocumentNumber({ dependency, unit, documentType, period }) {
  const dependencyKey = normalize(dependency)
  const unitValue = unitCode(unit)
  const typeKey = normalize(documentType)
  const periodValue = String(period || '').trim()
  const year = periodValue.match(/^(\d{4})\b/)?.[1] || ''
  if (!dependencyKey || !unitValue || !typeKey || !year) {
    const error = new Error('NUMBERING_SCOPE_REQUIRED')
    error.status = 400
    throw error
  }
  const key = `${dependencyKey}|${unitValue.toLowerCase()}|${typeKey}|${year}`
  const state = readState()
  const next = Number(state[key] || 0) + 1
  state[key] = next
  writeState(state)
  return {
    dependency: dependencyKey,
    unitCode: unitValue,
    documentType: String(documentType).trim(),
    documentYear: year,
    originalConsecutive: String(next).padStart(4, '0'),
  }
}
