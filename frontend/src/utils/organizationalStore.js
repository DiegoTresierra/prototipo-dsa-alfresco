import { organizationalOffices } from '../data/organizationalAssignments'

function storageKey(scopeId) {
  return `uac-demo-organization-${scopeId}`
}

export function loadOrganizationalData(dependencyId, scopeId = dependencyId) {
  try {
    const saved = scopeId ? localStorage.getItem(storageKey(scopeId)) : null
    if (saved !== null) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed.offices) && Array.isArray(parsed.people)) return parsed
    }
  } catch {
    // Se utiliza la estructura organizacional de muestra si localStorage no está disponible.
  }

  return {
    offices: organizationalOffices.filter((office) => office.dependencyId === dependencyId).map(({ id, name, parentOfficeId }) => ({ id, name, parentOfficeId })),
    people: [],
  }
}

export function saveOrganizationalData(scopeId, data) {
  if (!scopeId) return
  try {
    localStorage.setItem(storageKey(scopeId), JSON.stringify(data))
  } catch {
    // Los cambios se conservan en el estado React hasta finalizar la sesión.
  }
}
