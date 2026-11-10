export async function getSession() {
  const response = await fetch('/api/auth/me', { credentials: 'include' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('No se pudo recuperar la sesión.')
  return response.json()
}

export async function getAuthStatus() {
  const response = await fetch('/api/auth/status', { credentials: 'include' })
  if (!response.ok) throw new Error('El backend de autenticación no está disponible.')
  return response.json()
}

export async function loginBasic(username, password) {
  const response = await fetch('/api/auth/basic', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    if (body.error === 'ALFRESCO_UNAVAILABLE') throw new Error('El servicio Alfresco DEV no está disponible.')
    if (body.error === 'ALFRESCO_FORBIDDEN') throw new Error('Alfresco rechazó el acceso de esta cuenta.')
    if (body.error === 'ALFRESCO_AUTHENTICATION_ERROR') throw new Error('Alfresco rechazó la solicitud de autenticación.')
    throw new Error('Las credenciales de Alfresco DEV no son correctas.')
  }
  return response.json()
}

export async function logout(session) {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': session.csrfToken },
  })
  if (!response.ok) throw new Error('No se pudo cerrar la sesión.')
}
