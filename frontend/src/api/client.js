const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

export function apiUrl(path) {
  return `${apiBaseUrl}${path}`
}

export function apiFetch(path, options) {
  return fetch(apiUrl(path), options)
}
