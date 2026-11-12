function normalizeCodePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('es')
    .replace(/[^A-Z0-9]+/g, '')
}

export function derivePersonCode(name) {
  const words = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().split(/\s+/).filter(Boolean)
  return words.map((word) => word[0]).join('').toLocaleUpperCase('es')
}

export function getIssuerCode({ roleId, dependencyAcronym, unitAcronym, personCode }) {
  const dependencyCode = normalizeCodePart(dependencyAcronym)
  if (!dependencyCode) return ''
  if (['director', 'director-dti', 'director-dsa'].includes(roleId)) return dependencyCode
  const unitCode = normalizeCodePart(unitAcronym)
  if (!unitCode) return ''
  if (roleId?.startsWith('jefe-unidad')) return `${dependencyCode}-${unitCode}`
  const issuerPersonCode = normalizeCodePart(personCode)
  return issuerPersonCode ? `${dependencyCode}-${unitCode}-${issuerPersonCode}` : ''
}
