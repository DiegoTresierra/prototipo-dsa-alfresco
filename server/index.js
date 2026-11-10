import express from 'express'
import crypto from 'node:crypto'
import * as cookie from 'cookie'
import { Issuer, generators } from 'openid-client'
import { Buffer } from 'node:buffer'
import { config } from './config.js'
import { authenticateBasic, authenticateBearer, buildAlfrescoUrl } from './alfrescoClient.js'
import { createOidcTransaction, createSession, consumeOidcTransaction, deleteSession, getSession } from './sessionStore.js'
import { resolveRole } from './roleResolver.js'

const app = express()
const SESSION_COOKIE = 'gd_session'
const OIDC_COOKIE = 'gd_oidc_transaction'
let keycloakClientPromise

app.use(express.json({ limit: '1mb' }))

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
  }
}

function setCookie(response, name, value, options) {
  response.append('Set-Cookie', cookie.serialize(name, value, options))
}

function clearCookie(response, name, options) {
  setCookie(response, name, '', { ...options, maxAge: 0 })
}

function signedSessionId(id) {
  const signature = crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url')
  return `${id}.${signature}`
}

function sessionIdFromRequest(request) {
  const value = request.headers.cookie?.match(/(?:^|;\s*)gd_session=([^;]+)/)?.[1]
  if (!value) return null
  const [id, signature] = value.split('.')
  if (!id || !signature) return null
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  return id
}

function publicSession(session) {
  return {
    authenticated: true,
    provider: session.provider,
    user: session.user,
    alfresco: session.alfresco,
    groups: session.groups,
    roleId: session.roleId,
    authorizationStatus: session.authorizationStatus,
    capabilities: session.capabilities,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  }
}

async function getKeycloakClient() {
  if (!keycloakClientPromise) {
    keycloakClientPromise = Issuer.discover(config.keycloak.issuer).then((issuer) => new issuer.Client({
      client_id: config.keycloak.clientId,
      client_secret: config.keycloak.clientSecret,
      redirect_uris: [config.keycloak.redirectUri],
      response_types: ['code'],
    }))
  }
  return keycloakClientPromise
}

async function createAlfrescoSession(provider, authentication, user) {
  const role = resolveRole(authentication.groups, config.roleMappings)
  return createSession({
    provider,
    user,
    alfresco: authentication.identity,
    groups: authentication.groups,
    roleId: role.roleId,
    authorizationStatus: role.status,
    capabilities: role.roleId ? ['documents:read'] : [],
    authorization: authentication.authorization,
    ticket: authentication.ticket,
    accessToken: authentication.accessToken,
    refreshToken: authentication.refreshToken,
    tokenExpiresAt: authentication.tokenExpiresAt,
  })
}

function sessionFromRequest(request) {
  return getSession(sessionIdFromRequest(request))
}

async function refreshSessionIfNeeded(session) {
  if (session.provider !== 'keycloak-oidc' || !session.refreshToken || !session.tokenExpiresAt || session.tokenExpiresAt > Math.floor(Date.now() / 1000) + 60) return
  const client = await getKeycloakClient()
  const tokens = await client.refresh(session.refreshToken)
  session.accessToken = tokens.access_token
  session.refreshToken = tokens.refresh_token || session.refreshToken
  session.tokenExpiresAt = tokens.expires_at
  session.authorization = `Bearer ${tokens.access_token}`
}

async function requireSession(request, response, next) {
  const session = sessionFromRequest(request)
  if (!session) return response.status(401).json({ error: 'SESSION_REQUIRED' })
  try {
    await refreshSessionIfNeeded(session)
    request.session = session
    return next()
  } catch {
    deleteSession(session.id)
    clearCookie(response, SESSION_COOKIE, cookieOptions())
    return response.status(401).json({ error: 'SESSION_EXPIRED' })
  }
}

function requireCsrf(request, response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next()
  if (request.get('x-csrf-token') !== request.session.csrfToken) {
    return response.status(403).json({ error: 'CSRF_VALIDATION_FAILED' })
  }
  return next()
}

app.get('/api/auth/login', async (request, response) => {
  try {
    const client = await getKeycloakClient()
    const codeVerifier = generators.codeVerifier()
    const transaction = {
      state: generators.state(),
      nonce: generators.nonce(),
      codeVerifier,
    }
    const stateId = createOidcTransaction(transaction)
    setCookie(response, OIDC_COOKIE, stateId, cookieOptions(10 * 60))
    return response.redirect(client.authorizationUrl({
      scope: 'openid profile email',
      response_mode: 'query',
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: generators.codeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    }))
  } catch {
    return response.status(503).json({ error: 'SSO_UNAVAILABLE' })
  }
})

app.get('/api/auth/callback', async (request, response) => {
  try {
    const transactionId = request.headers.cookie?.match(/(?:^|;\s*)gd_oidc_transaction=([^;]+)/)?.[1]
    const transaction = consumeOidcTransaction(transactionId)
    if (!transaction || request.query.state !== transaction.state) return response.status(400).send('Invalid authentication transaction.')
    const client = await getKeycloakClient()
    const tokens = await client.callback(config.keycloak.redirectUri, request.query, {
      state: transaction.state,
      nonce: transaction.nonce,
      code_verifier: transaction.codeVerifier,
    })
    const user = await client.userinfo(tokens.access_token)
    const authentication = config.ssoAuthMode === 'bearer'
      ? await authenticateBearer(config.alfrescoTarget, tokens.access_token)
      : null
    if (!authentication) return response.status(503).send('Alfresco SSO integration is not configured.')
    const session = await createAlfrescoSession('keycloak-oidc', {
      ...authentication,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: tokens.expires_at,
    }, user)
    clearCookie(response, OIDC_COOKIE, cookieOptions())
    setCookie(response, SESSION_COOKIE, signedSessionId(session.id), cookieOptions())
    return response.redirect('/')
  } catch (error) {
    return response.status(error.status === 401 || error.status === 403 ? error.status : 502).send('No se pudo vincular la identidad institucional con Alfresco.')
  }
})

app.post(['/api/auth/basic', '/api/auth/login'], async (request, response) => {
  if (!config.basicAuthEnabled) return response.status(404).json({ error: 'BASIC_AUTH_DISABLED' })
  const username = String(request.body?.username || '').trim()
  const password = String(request.body?.password || '')
  if (!username || !password) return response.status(400).json({ error: 'CREDENTIALS_REQUIRED' })
  try {
    const authentication = await authenticateBasic(config.alfrescoTarget, username, password)
    const session = await createAlfrescoSession('alfresco-basic', authentication, {
      id: authentication.identity.id,
      name: authentication.identity.displayName || authentication.identity.id,
      username: authentication.identity.id,
    })
    setCookie(response, SESSION_COOKIE, signedSessionId(session.id), cookieOptions())
    return response.json(publicSession(session))
  } catch (error) {
    const unavailable = !error.status || error.status >= 500
    return response.status(unavailable ? 503 : 401).json({ error: unavailable ? 'ALFRESCO_UNAVAILABLE' : 'INVALID_CREDENTIALS' })
  }
})

app.get('/api/auth/me', (request, response) => {
  const session = sessionFromRequest(request)
  if (!session) return response.status(401).json({ authenticated: false })
  return response.json(publicSession(session))
})

app.get('/api/auth/status', async (request, response) => {
  try {
    const client = await getKeycloakClient()
    return response.json({ keycloak: { issuer: client.issuer.metadata.issuer, reachable: true }, basicAuthEnabled: config.basicAuthEnabled })
  } catch {
    return response.json({ keycloak: { reachable: false }, basicAuthEnabled: config.basicAuthEnabled })
  }
})

app.post('/api/auth/logout', requireSession, requireCsrf, (request, response) => {
  deleteSession(request.session.id)
  clearCookie(response, SESSION_COOKIE, cookieOptions())
  return response.status(204).end()
})

app.use('/api/alfresco', requireSession, requireCsrf, async (request, response) => {
  try {
    if (request.session.authorizationStatus !== 'active') return response.status(403).json({ error: 'ROLE_NOT_CONFIGURED' })
    const requestPath = request.path
    const url = buildAlfrescoUrl(config.alfrescoTarget, requestPath, request.url.split('?')[1] ? `?${request.url.split('?')[1]}` : '')
    const upstream = await fetch(url, { method: request.method, headers: { Accept: request.get('accept') || 'application/json', Authorization: request.session.authorization } })
    const body = await upstream.arrayBuffer()
    response.status(upstream.status)
    const contentType = upstream.headers.get('content-type')
    if (contentType) response.set('content-type', contentType)
    return response.send(Buffer.from(body))
  } catch (error) {
    return response.status(error.status || 502).json({ error: 'ALFRESCO_PROXY_ERROR' })
  }
})

app.listen(config.port, () => {
  console.log(`Authentication backend listening on port ${config.port}`)
})
