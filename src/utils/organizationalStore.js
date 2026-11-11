import { organizationalOffices } from '../data/organizationalAssignments'

function storageKey(dependencyId) {
  return `uac-demo-organization-${dependencyId}`
}

export function loadOrganizationalData(dependencyId) {
  try {
    const saved = localStorage.getItem(storageKey(dependencyId))
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

export function saveOrganizationalData(dependencyId, data) {
  try {
    localStorage.setItem(storageKey(dependencyId), JSON.stringify(data))
  } catch {
    // Los cambios se conservan en el estado React hasta finalizar la sesión.
  }
}
