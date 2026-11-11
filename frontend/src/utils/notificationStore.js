import { simulatedNotifications } from '../data/simulatedNotifications'

const storageKey = 'uac-document-management-demo-notifications-v1'

export function loadNotifications() {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved !== null) {
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? parsed : [...simulatedNotifications]
    }
  } catch {
    // El prototipo continúa con notificaciones de muestra si el almacenamiento no está disponible.
  }
  return [...simulatedNotifications]
}

export function saveNotifications(notifications) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(notifications))
  } catch {
    // El estado permanece disponible en React durante la sesión actual.
  }
}
