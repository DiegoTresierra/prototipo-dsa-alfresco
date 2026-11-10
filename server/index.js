import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import process from 'node:process'
import { OAuth2Client } from 'google-auth-library'
import { loadEnv } from 'vite'

const fileEnv = loadEnv('development', process.cwd(), 'GOOGLE_')
const getConfig = (name, fallback = '') => process.env[name] || fileEnv[name] || fallback
const clientId = getConfig('GOOGLE_CLIENT_ID')
const allowedHostedDomain = getConfig('GOOGLE_ALLOWED_HOSTED_DOMAIN').toLowerCase()
const appOrigin = getConfig('APP_ORIGIN', 'http://localhost:5173').replace(/\/$/, '')
const host = getConfig('AUTH_HOST', '127.0.0.1')
const port = Number(getConfig('AUTH_PORT', '8787'))
const sessionLifetimeSeconds = 8 * 60 * 60
const cookieSecure = appOrigin.startsWith('https://')
const googleClient = new OAuth2Client(clientId || undefined)
const sessions = new Map()
const pendingNonces = new Map()

const sessionCookieName = 'uac_google_session'
const nonceCookieName = 'uac_google_nonce'

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((cookie) => cookie.trim()).filter(Boolean).map((cookie) => {
    const separator = cookie.indexOf('=')
    return separator < 0 ? [cookie, ''] : [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))]
  }))
}

function cookie(name, value, maxAge, { httpOnly = true } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/api/auth; Max-Age=${maxAge}; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${cookieSecure ? '; Secure' : ''}`
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 16_384) throw new Error('Request body too large')
  }
  return JSON.parse(body || '{}')
}

function requestHasAllowedOrigin(request) {
  return request.headers.origin === appOrigin
}

function removeExpiredData() {
  const now = Date.now()
  for (const [sessionId, session] of sessions) if (session.expiresAt <= now) sessions.delete(sessionId)
  for (const [nonce, expiresAt] of pendingNonces) if (expiresAt <= now) pendingNonces.delete(nonce)
}

async function handleRequest(request, response) {
  removeExpiredData()
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const cookies = parseCookies(request.headers.cookie)

  if (request.method === 'GET' && requestUrl.pathname === '/api/auth/config') {
    return sendJson(response, 200, { enabled: Boolean(clientId), clientId: clientId || '' })
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/auth/google/nonce') {
    if (!clientId) return sendJson(response, 503, { error: 'Google no está configurado en este entorno.' })
    const nonce = randomBytes(32).toString('base64url')
    pendingNonces.set(nonce, Date.now() + 5 * 60 * 1000)
    return sendJson(response, 200, { nonce }, { 'Set-Cookie': cookie(nonceCookieName, nonce, 300) })
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/auth/google') {
    if (!requestHasAllowedOrigin(request)) return sendJson(response, 403, { error: 'Origen de solicitud no permitido.' })
    if (!clientId) return sendJson(response, 503, { error: 'Google no está configurado en este entorno.' })

    let body
    try {
      body = await readJson(request)
    } catch {
      return sendJson(response, 400, { error: 'La solicitud de autenticación no es válida.' })
    }

    const nonce = cookies[nonceCookieName]
    if (!nonce || !pendingNonces.has(nonce)) {
      return sendJson(response, 403, { error: 'No se pudo validar la solicitud de autenticación.' })
    }

    try {
      const ticket = await googleClient.verifyIdToken({ idToken: body.credential, audience: clientId })
      const payload = ticket.getPayload()
      if (!payload || payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
        return sendJson(response, 401, { error: 'Google no confirmó la identidad.' })
      }
      if (payload.nonce !== nonce || !payload.sub || !payload.email || payload.email_verified !== true) {
        return sendJson(response, 401, { error: 'La cuenta de Google no pudo verificarse.' })
      }
      if (allowedHostedDomain && String(payload.hd || '').toLowerCase() !== allowedHostedDomain) {
        return sendJson(response, 403, { error: 'La cuenta no pertenece al dominio Google Workspace permitido.' })
      }

      pendingNonces.delete(nonce)
      const previousSessionId = cookies[sessionCookieName]
      if (previousSessionId) sessions.delete(previousSessionId)
      const sessionId = randomBytes(32).toString('base64url')
      const expiresAt = Date.now() + sessionLifetimeSeconds * 1000
      sessions.set(sessionId, {
        expiresAt,
        user: { id: payload.sub, name: payload.name || payload.email, email: payload.email },
      })
      return sendJson(response, 200, { authenticated: true }, {
        'Set-Cookie': [
          cookie(sessionCookieName, sessionId, sessionLifetimeSeconds),
          cookie(nonceCookieName, '', 0),
        ],
      })
    } catch {
      return sendJson(response, 401, { error: 'Google rechazó la verificación de identidad.' })
    }
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/auth/session') {
    const session = sessions.get(cookies[sessionCookieName])
    if (!session || session.expiresAt <= Date.now()) {
      return sendJson(response, 401, { authenticated: false })
    }
    return sendJson(response, 200, {
      authenticated: true,
      mode: 'google_identity_only',
      user: { ...session.user, role: null, availableRoles: [], dependencyId: null, dependencyName: null, office: null, acronym: null },
    })
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
    if (!requestHasAllowedOrigin(request)) return sendJson(response, 403, { error: 'Origen de solicitud no permitido.' })
    const sessionId = cookies[sessionCookieName]
    if (sessionId) sessions.delete(sessionId)
    return sendJson(response, 200, { authenticated: false }, {
      'Set-Cookie': cookie(sessionCookieName, '', 0),
    })
  }

  return sendJson(response, 404, { error: 'Ruta no encontrada.' })
}

if (process.env.NODE_ENV === 'production') {
  throw new Error('Este servidor de sesión en memoria es solo para desarrollo; producción requiere una sesión persistente administrada y aprobada.')
}

createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { error: 'No se pudo completar la solicitud de autenticación.' })
    else response.destroy()
  })
}).listen(port, host, () => {
  process.stdout.write(`Servidor local de identidad Google disponible en http://${host}:${port}\n`)
  if (!clientId) process.stdout.write('Google no está habilitado: configura GOOGLE_CLIENT_ID en el entorno local.\n')
})
