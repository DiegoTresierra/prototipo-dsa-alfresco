import express from 'express'
import { buildRecipientPermissions } from './documentDelivery.js'
import { getDistributionAuthorization, invalidateDistributionAuthorization } from './distributionService.js'
import crypto from 'node:crypto'
import * as cookie from 'cookie'
import { Issuer, generators } from 'openid-client'
import { Buffer } from 'node:buffer'
import { config } from './config.js'
import { authenticateBasic, authenticateBearer, buildAlfrescoUrl, getAlfrescoGroupMembers } from './alfrescoClient.js'
import { createDispatch, findDispatch, listDispatchesForUser, updateDispatch } from './dispatchStore.js'
import { canDispatch, dispatchIdentity, validateDispatchRequest } from './dispatchPolicy.js'
import { reserveDocumentNumber } from './numberingStore.js'
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
  response.append('Set-Cookie', cookie.stringifySetCookie({ name, value, ...options }))
}

function clearCookie(response, name, options) {
  setCookie(response, name, '', { ...options, maxAge: 0 })
}

function logAuthDiagnostic(phase, category) {
  if (config.alfrescoDiagnostics) {
    console.info(`[auth] phase=${phase} category=${category}`)
  }
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
    dependency: session.dependency,
    unit: session.unit,
    userInboxNodeId: session.userInboxNodeId,
    functionalRole: session.functionalRole,
    functionalIdentity: session.functionalIdentity,
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
  const role = resolveRole(authentication.groups, config.groupMappings, authentication.identity.id)
  const userId = authentication.identity.id
  return createSession({
    provider,
    user,
    alfresco: authentication.identity,
    groups: authentication.groups,
    roleId: role.roleId,
    dependency: role.dependency,
    functionalRole: role.functionalRole,
    functionalIdentity: role,
    authorizationStatus: role.authorizationStatus,
    unit: config.userUnitAssignments?.[userId] || null,
    userInboxNodeId: config.userInboxNodeIds?.[userId] || '',
    capabilities: role.roleId ? ['documents:read', 'documents:write'] : [],
    authorization: authentication.authorization,
    ticket: authentication.ticket,
    accessToken: authentication.accessToken,
    refreshToken: authentication.refreshToken,
    tokenExpiresAt: authentication.tokenExpiresAt,
  })
}

async function getConfiguredRecipients(session, { requireInbox = true } = {}) {
  const dependencyGroups = Object.entries(config.groupMappings.dependencies || {})
  const functionGroups = Object.entries(config.groupMappings.functions || {})
  const memberships = new Map()
  const groupIds = (configuredGroups) => Array.isArray(configuredGroups) ? configuredGroups : [configuredGroups]
  const groups = [...new Set([...dependencyGroups, ...functionGroups].flatMap(([, configuredGroups]) => groupIds(configuredGroups)).filter(Boolean))]

  await Promise.all(groups.map(async (groupId) => {
    const members = await getAlfrescoGroupMembers(config.alfrescoTarget, groupId, session.authorization)
    memberships.set(groupId, new Map(members.map((member) => [member.id, member])))
  }))

  const candidates = new Map()
  for (const [dependency, configuredDependencyGroups] of dependencyGroups) {
    const dependencyMembers = new Map(groupIds(configuredDependencyGroups).flatMap((groupId) => [...(memberships.get(groupId) || new Map())]))
    for (const [functionalRole, configuredRoleGroups] of functionGroups) {
      for (const [userId, member] of dependencyMembers) {
        if (!groupIds(configuredRoleGroups).some((groupId) => memberships.get(groupId)?.has(userId))) continue
        const candidate = candidates.get(userId) || { member, dependencies: new Set(), functionalRoles: new Set() }
        candidate.dependencies.add(dependency)
        candidate.functionalRoles.add(functionalRole)
        candidates.set(userId, candidate)
      }
    }
  }

  const recipients = []
  for (const [userId, candidate] of candidates) {
    if (candidate.dependencies.size !== 1 || candidate.functionalRoles.size !== 1) continue
    const functionalRole = [...candidate.functionalRoles][0]
    const inboxNodeId = config.userInboxNodeIds?.[userId]
    if (requireInbox && (typeof inboxNodeId !== 'string' || !inboxNodeId.trim())) continue
    recipients.push({
      id: userId,
      displayName: candidate.member.displayName || userId,
      dependency: [...candidate.dependencies][0].toLowerCase(),
      functionalRole,
      unit: config.userUnitAssignments?.[userId] || null,
      inboxNodeId: inboxNodeId || '',
    })
  }

  return recipients.sort((left, right) => left.displayName.localeCompare(right.displayName, 'es'))
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
    logAuthDiagnostic('basic-authentication', 'started')
    const authentication = await authenticateBasic(config.alfrescoTarget, username, password)
    logAuthDiagnostic('basic-authentication', 'alfresco-identity-verified')
    const session = await createAlfrescoSession('alfresco-basic', authentication, {
      id: authentication.identity.id,
      name: authentication.identity.displayName || authentication.identity.id,
      username: authentication.identity.id,
    })
    logAuthDiagnostic('basic-authentication', 'session-created')
    setCookie(response, SESSION_COOKIE, signedSessionId(session.id), cookieOptions())
    logAuthDiagnostic('basic-authentication', 'cookie-created')
    return response.json(publicSession(session))
  } catch (error) {
    logAuthDiagnostic('basic-authentication', `failed-${error.category || 'internal'}`)
    if (error.category === 'authorization' && error.status === 401) {
      return response.status(401).json({ error: 'INVALID_CREDENTIALS' })
    }
    if (error.category === 'authorization' && error.status === 403) {
      return response.status(403).json({ error: 'ALFRESCO_FORBIDDEN' })
    }
    if (error.category === 'network' || error.category === 'upstream') {
      return response.status(503).json({ error: 'ALFRESCO_UNAVAILABLE' })
    }
    return response.status(502).json({ error: 'ALFRESCO_AUTHENTICATION_ERROR' })
  }
})

app.get('/api/auth/me', (request, response) => {
  const session = sessionFromRequest(request)
  if (!session) return response.status(401).json({ authenticated: false })
  return response.json(publicSession(session))
})

app.get('/api/directory/recipients', requireSession, async (request, response) => {
  if (request.session.authorizationStatus !== 'active') return response.status(403).json({ error: 'ROLE_NOT_CONFIGURED' })
  const documentMatch = request.path.match(/^\/api\/-default-\/public\/alfresco\/versions\/1\/nodes\/([^/]+)(?:\/content)?$/)
  if (request.method === 'GET' && documentMatch && !isAssignedDocument(request.session, decodeURIComponent(documentMatch[1]))) {
    return response.status(403).json({ error: 'DOCUMENT_ASSIGNMENT_REQUIRED' })
  }
  if (!Object.keys(config.groupMappings.dependencies || {}).length || !Object.keys(config.groupMappings.functions || {}).length) {
    return response.status(503).json({ error: 'GROUP_MAPPINGS_REQUIRED' })
  }
  if (Object.keys(config.userInboxNodeIds || {}).length === 0) {
    return response.status(503).json({ error: 'USER_INBOX_MAPPING_REQUIRED' })
  }
  try {
    const recipients = await getConfiguredRecipients(request.session, { requireInbox: false })
    return response.json({ recipients })
  } catch {
    return response.status(502).json({ error: 'RECIPIENT_DIRECTORY_UNAVAILABLE' })
  }
})

app.get('/api/directory/office-inboxes', requireSession, (request, response) => {
  const dependency = request.session.dependency
  if (request.session.authorizationStatus !== 'active' || !dependency || !request.session.capabilities?.includes('documents:read')) {
    return response.status(403).json({ error: 'DOCUMENT_READ_REQUIRED' })
  }
  const folders = config.officeInboxNodeIds?.[dependency]
  if (!folders?.porAtender || !folders?.porConocimiento) {
    return response.status(503).json({ error: 'OFFICE_INBOX_MAPPING_REQUIRED' })
  }
  return response.json({ folders: { porAtender: folders.porAtender, porConocimiento: folders.porConocimiento } })
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

async function requestBody(request, maxBytes = 25 * 1024 * 1024) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const contentType = request.get('content-type') || ''
  if (contentType.includes('application/json')) return JSON.stringify(request.body || {})
  const chunks = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      const error = new Error('Request body exceeds the permitted size.')
      error.status = 413
      throw error
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

const activeDeliveries = new Set()
function requireDeliveryLock(request, response, next) {
  const key = request.body?.requestKey || request.body?.nodeId || request.session.id
  if (activeDeliveries.has(key)) return response.status(409).json({ error: 'DELIVERY_IN_PROGRESS' })
  activeDeliveries.add(key)
  let released = false
  const release = () => {
    if (!released) { released = true; activeDeliveries.delete(key) }
  }
  response.once('finish', release)
  // Keep the lock until processing finishes, even if the client disconnects.
  request.deliveryRelease = release
  next()
}

  app.get('/api/directory/unit-heads', requireSession, async (request, response) => {
    if (!canDispatch(request.session)) return response.status(403).json({ error: 'DIRECTOR_DISPATCH_REQUIRED' })
    try {
      const recipients = await getConfiguredRecipients(request.session, { requireInbox: false })
      return response.json({
        recipients: recipients.filter((recipient) =>
          recipient.functionalRole === 'jefe-unidad' &&
          recipient.dependency === String(request.session.dependency || '').toLowerCase()),
      })
    } catch {
      return response.status(502).json({ error: 'UNIT_HEAD_DIRECTORY_UNAVAILABLE' })
    }
  })

  app.get('/api/documents/dispatches', requireSession, (request, response) => {
    const userId = request.session.alfresco?.id || request.session.user?.id
    if (!userId || request.session.authorizationStatus !== 'active') return response.status(403).json({ error: 'ROLE_NOT_CONFIGURED' })
    try {
      return response.json({ dispatches: listDispatchesForUser(userId, request.session.functionalRole, request.session.unit) })
    } catch {
      return response.status(503).json({ error: 'DISPATCH_STORE_UNAVAILABLE' })
    }
  })

  app.post('/api/documents/numbers', requireSession, requireCsrf, requireDeliveryLock, (request, response) => {
    try {
      if (request.session.authorizationStatus !== 'active' || !request.session.capabilities?.includes('documents:write')) {
        return response.status(403).json({ error: 'DOCUMENT_WRITE_NOT_ALLOWED' })
      }
      if (request.session.functionalRole === 'jefe-unidad' && !request.session.unit?.code && !request.session.unit?.acronym) {
        return response.status(503).json({ error: 'UNIT_CODE_NOT_CONFIGURED' })
      }
      const number = reserveDocumentNumber({
        dependency: request.session.dependency,
        unit: request.session.unit || { code: request.session.dependency },
        documentType: request.body?.documentType,
        period: request.body?.documentPeriod,
      })
      return response.status(201).json({ number })
    } catch (error) {
      return response.status(error.status || 503).json({ error: error.message || 'NUMBERING_STORE_UNAVAILABLE' })
    } finally {
      request.deliveryRelease()
    }
  })

  function dispatchError(response, status, error, dispatch) {
    return response.status(status).json({
      error,
      ...(dispatch?.id ? { dispatchId: dispatch.id } : {}),
      ...(dispatch?.documentId ? { documentId: dispatch.documentId } : {}),
    })
  }

  async function sourceDocumentBelongsToDependency(session, documentId) {
    const allowedFolders = new Set(Object.values(config.officeInboxNodeIds?.[String(session.dependency || '').toUpperCase()] || {}).filter(Boolean))
    const url = buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(documentId)}`, '?include=path')
    const result = await fetch(url, { headers: { Accept: 'application/json', Authorization: session.authorization } })
    const payload = await result.json().catch(() => null)
    const entry = payload?.entry
    if (!result.ok || !entry?.isFile || entry?.content?.mimeType !== 'application/pdf') return false
    if (allowedFolders.has(entry.parentId)) return true
    const parentsUrl = buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(documentId)}/parents`, '?include=association&maxItems=100')
    const parentsResponse = await fetch(parentsUrl, { headers: { Accept: 'application/json', Authorization: session.authorization } })
    const parents = await parentsResponse.json().catch(() => null)
    return parentsResponse.ok && parents?.list?.entries?.some(({ entry: parent }) => allowedFolders.has(parent?.id))
  }

  app.post('/api/documents/dispatch', requireSession, requireCsrf, requireDeliveryLock, async (request, response) => {
    let dispatch
    try {
      const userId = request.session.alfresco?.id || request.session.user?.id
      const recipients = await getConfiguredRecipients(request.session, { requireInbox: false })
      const input = validateDispatchRequest(request.body, request.session, recipients)
      const identity = dispatchIdentity(request.session, input.requestKey)
      const existing = findDispatch(userId, input.requestKey)
      if (existing) {
        const requestedRecipients = input.recipients.map((recipient) => recipient.id).sort().join(',')
        const storedRecipients = existing.recipients.map((recipient) => recipient.userId).sort().join(',')
        if (existing.documentId !== input.documentId || storedRecipients !== requestedRecipients) {
          return dispatchError(response, 409, 'DISPATCH_REQUEST_CONFLICT', existing)
        }
        if (existing.status === 'ASIGNADO' || existing.status === 'DESPACHADO') return response.status(200).json({ dispatch: existing })
      }
      if (identity.startsWith(':')) return dispatchError(response, 403, 'SESSION_IDENTITY_REQUIRED')
      if (!await sourceDocumentBelongsToDependency(request.session, input.documentId)) {
        return dispatchError(response, 403, 'DISPATCH_DOCUMENT_NOT_ALLOWED')
      }

      dispatch = existing || createDispatch({
        ...input,
        senderUserId: userId,
      })
      for (const recipient of input.recipients) {
        if (dispatch.recipients.find((entry) => entry.userId === recipient.id)?.status === 'ASIGNADO') continue
        dispatch = updateDispatch(dispatch.id, (current) => ({
          ...current,
          recipients: current.recipients.map((entry) => entry.userId === recipient.id ? { ...entry, status: 'ASIGNADO', assignedAt: new Date().toISOString() } : entry),
        }))
      }
      dispatch = updateDispatch(dispatch.id, (current) => ({ ...current, status: 'ASIGNADO', completedAt: new Date().toISOString() }))
      return response.status(201).json({ dispatch })
    } catch (error) {
      if (error.code === 'DISTRIBUTION_SERVICE_NOT_CONFIGURED' || error.code === 'DISTRIBUTION_SERVICE_AUTH_FAILED') {
        return dispatchError(response, 503, error.code, dispatch)
      }
      if (dispatch?.id) {
        const updated = updateDispatch(dispatch.id, (current) => ({
          ...current,
          status: 'PARCIAL',
          error: error.code || 'DISPATCH_FAILED',
        }))
        return dispatchError(response, error.status === 403 ? 403 : 502, error.code || 'DISPATCH_FAILED', updated)
      }
      return dispatchError(response, error.status || 502, error.message || 'DISPATCH_FAILED')
    } finally {
      request.deliveryRelease()
    }
  })
app.post(['/api/documents/send-to-director', '/api/documents/retry-director-delivery'], requireSession, requireCsrf, requireDeliveryLock, async (request, response) => {
  const retry = request.path.endsWith('/retry-director-delivery')
  let createdNodeId = ''
  const session = request.session
  if (session.authorizationStatus !== 'active' || session.functionalRole !== 'direccion' || !session.capabilities?.includes('documents:write')) {
    return response.status(403).json({ error: 'DIRECTOR_DOCUMENT_WRITE_REQUIRED' })
  }

  const recipientDependency = String(request.get('x-uac-recipient-dependency') || '').toUpperCase()
  const receiptCategory = request.get('x-uac-receipt-category')
  if (!recipientDependency || !['por-atender', 'por-conocimiento'].includes(receiptCategory)) {
    return response.status(400).json({ error: 'INVALID_DIRECTOR_DELIVERY' })
  }
  if (recipientDependency === String(session.dependency || '').toUpperCase() || !config.groupMappings.dependencies?.[recipientDependency]) {
    return response.status(403).json({ error: 'DIRECTOR_RECIPIENT_NOT_ALLOWED' })
  }

  const folderKey = receiptCategory === 'por-atender' ? 'porAtender' : 'porConocimiento'
  const emittedNodeId = config.officeInboxNodeIds?.[String(session.dependency || '').toUpperCase()]?.emitidos
  const receivedNodeId = config.officeInboxNodeIds?.[recipientDependency]?.[folderKey]
  const recipientGroupId = config.officeGroupIds?.[recipientDependency]
  if (!emittedNodeId || !receivedNodeId) return response.status(503).json({ error: 'OFFICE_INBOX_MAPPING_REQUIRED' })
  if (!recipientGroupId) return response.status(503).json({ error: 'OFFICE_GROUP_MAPPING_REQUIRED' })

  let body
  try {
    body = retry ? undefined : await requestBody(request)
  } catch (error) {
    return response.status(error.status || 413).json({ error: 'PDF_UPLOAD_TOO_LARGE' })
  }
  if (!retry && !isPdfMultipart(request, body)) return response.status(415).json({ error: 'PDF_UPLOAD_REQUIRED' })
  if (retry && (typeof request.body?.nodeId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(request.body.nodeId))) return response.status(400).json({ error: 'INVALID_DIRECTOR_DELIVERY' })

  try {
    // Fail before creating a PDF if the configured distribution account cannot authenticate.
    const distributionHeaders = { Accept: 'application/json', Authorization: await getDistributionAuthorization() }
    const upstreamHeaders = {
      Accept: 'application/json',
      Authorization: session.authorization,
    }
    let emittedEntry
    if (retry) {
      const existing = await fetch(buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(request.body.nodeId)}`), { headers: upstreamHeaders })
      const payload = await existing.json().catch(() => null)
      emittedEntry = payload?.entry
      if (!existing.ok || !emittedEntry || emittedEntry.parentId !== emittedNodeId || emittedEntry.createdByUser?.id !== session.alfresco.id || emittedEntry.isFile !== true || emittedEntry.content?.mimeType !== 'application/pdf') return response.status(403).json({ error: 'DIRECTOR_RETRY_NOT_ALLOWED' })
    } else {
      const emittedUrl = buildAlfrescoUrl(
        config.alfrescoTarget,
        `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(emittedNodeId)}/children`,
        '?autoRename=false',
      )
      const emittedResponse = await fetch(emittedUrl, {
        method: 'POST',
        headers: {
          ...upstreamHeaders,
          'Content-Type': request.get('content-type'),
        },
        body,
      })
      const emittedPayload = await emittedResponse.arrayBuffer()
      let emittedResult = null
      try { emittedResult = JSON.parse(Buffer.from(emittedPayload).toString('utf8')) } catch { /* return a safe error below */ }
      emittedEntry = emittedResult?.entry
      if (!emittedResponse.ok || !emittedEntry?.id) {
        if (emittedResponse.status === 403) return response.status(403).json({ error: 'DIRECTOR_EMITIDOS_WRITE_FORBIDDEN' })
        if (emittedResponse.status === 404) return response.status(404).json({ error: 'DIRECTOR_EMITIDOS_FOLDER_NOT_FOUND' })
        return response.status(emittedResponse.status || 502).json({ error: 'DIRECTOR_EMITIDOS_UPLOAD_FAILED' })
      }

    }
    createdNodeId = emittedEntry.id
    const nodeUrl = buildAlfrescoUrl(
      config.alfrescoTarget,
      `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(emittedEntry.id)}`,
      '?include=permissions',
    )
    let permissionResponse
    let currentNode
    try {
      permissionResponse = await fetch(nodeUrl, { headers: upstreamHeaders })
      currentNode = await permissionResponse.json()
    } catch {
      return response.status(502).json({ error: 'DIRECTOR_NODE_PERMISSION_PARTIAL', emittedNodeId: emittedEntry.id })
    }
    const currentPermissions = currentNode?.entry?.permissions
    if (!permissionResponse.ok) {
      const error = permissionResponse.status === 403
        ? 'DIRECTOR_NODE_PERMISSION_READ_FORBIDDEN'
        : 'DIRECTOR_NODE_PERMISSION_PARTIAL'
      return response.status(permissionResponse.status === 403 ? 403 : 502).json({ error, emittedNodeId: emittedEntry.id })
    }
    let nextPermissions
    try {
      nextPermissions = buildRecipientPermissions(currentPermissions, recipientGroupId)
    } catch (error) {
      return response.status(error.code === 'DIRECTOR_NODE_PERMISSION_CONFLICT' ? 403 : 502).json({ error: error.code, emittedNodeId: emittedEntry.id })
    }

    if (nextPermissions) {
      let updatePermissionsResponse
      try {
        updatePermissionsResponse = await fetch(nodeUrl, {
          method: 'PUT',
          headers: { ...upstreamHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions: nextPermissions }),
        })
      } catch {
        return response.status(502).json({ error: 'DIRECTOR_NODE_PERMISSION_PARTIAL', emittedNodeId: emittedEntry.id })
      }
      if (!updatePermissionsResponse.ok) {
        console.warn('[delivery] permission-update node=%s status=%s', emittedEntry.id, updatePermissionsResponse.status)
        const error = updatePermissionsResponse.status === 403
          ? 'DIRECTOR_NODE_PERMISSION_WRITE_FORBIDDEN'
          : 'DIRECTOR_NODE_PERMISSION_PARTIAL'
        return response.status(updatePermissionsResponse.status === 403 ? 403 : 502).json({ error, emittedNodeId: emittedEntry.id })
      }
    }

    // Confirm the stored ACL rather than treating a successful PUT as proof.
    const verifiedResponse = await fetch(nodeUrl, { headers: upstreamHeaders })
    const verifiedNode = await verifiedResponse.json().catch(() => null)
    if (!verifiedResponse.ok || verifiedNode?.entry?.id !== emittedEntry.id || buildRecipientPermissions(verifiedNode?.entry?.permissions, recipientGroupId) !== null) {
      return response.status(502).json({ error: 'DIRECTOR_NODE_PERMISSION_PARTIAL', emittedNodeId: emittedEntry.id })
    }

    // The service may only associate this verified original node into a server-mapped inbox.
    // Reading here also checks that the service can access the original PDF.
    const serviceRead = await fetch(buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(emittedEntry.id)}`), { headers: distributionHeaders })
    if (serviceRead.status === 401) invalidateDistributionAuthorization()
    const serviceNode = await serviceRead.json().catch(() => null)
    if (!serviceRead.ok || serviceNode?.entry?.id !== emittedEntry.id || serviceNode.entry.parentId !== emittedNodeId || serviceNode.entry.isFile !== true || serviceNode.entry.content?.mimeType !== 'application/pdf') {
      return response.status(502).json({ error: 'DISTRIBUTION_SERVICE_DOCUMENT_ACCESS_FAILED', emittedNodeId: emittedEntry.id })
    }
    const associationUrl = buildAlfrescoUrl(
      config.alfrescoTarget,
      `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(receivedNodeId)}/secondary-children`,
    )
    let associationResponse
    try {
      associationResponse = await fetch(associationUrl, {
        method: 'POST',
        headers: {
          ...distributionHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ childId: emittedEntry.id, assocType: 'cm:contains' }),
      })
    } catch {
      return response.status(502).json({ error: 'DIRECTOR_MULTIFILING_PARTIAL', emittedNodeId: emittedEntry.id })
    }
    const associationPayload = await associationResponse.arrayBuffer()
    if (associationResponse.status === 401) invalidateDistributionAuthorization()
    let associationResult = null
    try { associationResult = JSON.parse(Buffer.from(associationPayload).toString('utf8')) } catch { /* association is not confirmed */ }
    const associationConfirmed = associationResponse.ok && associationResult?.entry?.childId === emittedEntry.id
    if (!associationConfirmed) {
      const error = associationResponse.status === 403
        ? 'DIRECTOR_MULTIFILING_PERMISSION_REQUIRED'
        : associationResponse.status === 409
          ? 'DIRECTOR_MULTIFILING_ALREADY_EXISTS'
          : 'DIRECTOR_MULTIFILING_PARTIAL'
      if (error === 'DIRECTOR_MULTIFILING_ALREADY_EXISTS') {
        let skipCount = 0
        while (true) {
          const check = await fetch(buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(emittedEntry.id)}/parents`, `?include=association&maxItems=100&skipCount=${skipCount}`), { headers: distributionHeaders })
          const parents = await check.json().catch(() => null)
          if (!check.ok || !Array.isArray(parents?.list?.entries)) break
          if (parents.list.entries.some(({ entry }) => entry?.id === receivedNodeId && entry.association?.assocType === 'cm:contains' && entry.association?.isPrimary === false)) return response.status(201).json({ emittedEntry, receivedEntry: emittedEntry })
          if (!parents.list.pagination?.hasMoreItems || !parents.list.entries.length) break
          skipCount += parents.list.entries.length
        }
      }
      return response.status(error === 'DIRECTOR_MULTIFILING_PERMISSION_REQUIRED' ? 403 : 502).json({ error: error === 'DIRECTOR_MULTIFILING_ALREADY_EXISTS' ? 'DIRECTOR_MULTIFILING_PARTIAL' : error, emittedNodeId: emittedEntry.id })
    }

    // Alfresco returns the same node from both folders; the receiver must be able to read it
    // through an explicit node ACL because secondary parents do not confer permissions.
    return response.status(201).json({ emittedEntry, receivedEntry: emittedEntry })
  } catch (error) {
    if (['DISTRIBUTION_SERVICE_NOT_CONFIGURED', 'DISTRIBUTION_SERVICE_AUTH_FAILED'].includes(error.code)) return response.status(503).json({ error: error.code })
    return response.status(502).json({ error: createdNodeId ? 'DIRECTOR_NODE_PERMISSION_PARTIAL' : 'ALFRESCO_PROXY_ERROR', ...(createdNodeId ? { emittedNodeId: createdNodeId } : {}) })
  } finally {
    request.deliveryRelease()
  }
})

function isAllowedAlfrescoRequest(request) {
  const path = request.path
  const isNodeRequest = /^\/api\/-default-\/public\/alfresco\/versions\/1\/nodes\/[^/]+(?:\/children|\/content)?$/.test(path)
  const isGroupMembersRequest = /^\/api\/-default-\/public\/alfresco\/versions\/1\/groups\/[^/]+\/members$/.test(path)
  const isSearchRequest = path === '/api/-default-/public/search/versions/1/search'
  if (request.method === 'GET' && isNodeRequest) {
    const folderMatch = path.match(/^\/api\/-default-\/public\/alfresco\/versions\/1\/nodes\/([^/]+)\/children$/)
    if (folderMatch && request.session.functionalRole === 'jefe-unidad') {
      let folderId = ''
      try { folderId = decodeURIComponent(folderMatch[1]) } catch { return false }
      const allowedFolders = Object.values(config.officeInboxNodeIds?.[String(request.session.dependency || '').toUpperCase()] || {}).filter(Boolean)
      return allowedFolders.includes(folderId)
    }
    return true
  }
  if (request.method === 'GET' && isGroupMembersRequest) return true
  if (request.method === 'POST' && isSearchRequest) return true
  if (request.method === 'POST' && /\/nodes\/[^/]+\/children$/.test(path)) {
    const nodeId = path.match(/\/nodes\/([^/]+)\/children$/)?.[1]
    let decodedNodeId = ''
    try { decodedNodeId = decodeURIComponent(nodeId || '') } catch { return false }
    const recipientUserId = request.get('x-uac-recipient-user')
    return request.session.capabilities?.includes('documents:write') === true &&
      typeof recipientUserId === 'string' &&
      config.userInboxNodeIds?.[recipientUserId] === decodedNodeId
  }
  return false
}

function isAssignedDocument(session, documentId) {
  const userId = session.alfresco?.id || session.user?.id
  if (!userId || session.functionalRole !== 'jefe-unidad') return true
  return listDispatchesForUser(userId, session.functionalRole, session.unit)
    .some((dispatch) => dispatch.documentId === documentId && ['ASIGNADO', 'DESPACHADO'].includes(dispatch.status))
}

function isPdfMultipart(request, body) {
  const contentType = request.get('content-type') || ''
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!contentType.toLowerCase().startsWith('multipart/form-data;') || !boundary || !Buffer.isBuffer(body) || body.length > 25 * 1024 * 1024) return false
  const marker = Buffer.from(`--${(boundary[1] || boundary[2]).trim()}`)
  const separator = Buffer.from('\r\n\r\n')
  const pdfSignature = Buffer.from('%PDF-')
  let offset = 0
  while ((offset = body.indexOf(marker, offset)) !== -1) {
    const headerStart = offset + marker.length + 2
    const headerEnd = body.indexOf(separator, headerStart)
    if (headerEnd === -1) return false
    const headers = body.toString('latin1', headerStart, headerEnd).toLowerCase()
    const contentStart = headerEnd + separator.length
    const nextMarker = body.indexOf(marker, contentStart)
    if (nextMarker === -1) return false
    let contentEnd = nextMarker
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2
    const isFiledata = /content-disposition:\s*form-data;[^\r\n]*name="filedata"/i.test(headers) && /filename="[^"]+\.pdf"/i.test(headers)
    if (isFiledata) return body.subarray(contentStart, contentEnd).subarray(0, pdfSignature.length).equals(pdfSignature)
    offset = nextMarker
  }
  return false
}

app.use('/api/alfresco', requireSession, requireCsrf, async (request, response) => {
  try {
    if (request.session.authorizationStatus !== 'active') return response.status(403).json({ error: 'ROLE_NOT_CONFIGURED' })
    if (!isAllowedAlfrescoRequest(request)) {
      const isUpload = request.method === 'POST' && /\/nodes\/[^/]+\/children$/.test(request.path)
      if (isUpload && !request.session.capabilities?.includes('documents:write')) {
        return response.status(403).json({ error: 'DOCUMENT_WRITE_NOT_ALLOWED' })
      }
      if (isUpload) return response.status(403).json({ error: 'RECIPIENT_INBOX_NOT_CONFIGURED' })
      return response.status(403).json({ error: 'ALFRESCO_OPERATION_NOT_ALLOWED' })
    }
    const requestPath = request.path
    const url = buildAlfrescoUrl(config.alfrescoTarget, requestPath, request.url.split('?')[1] ? `?${request.url.split('?')[1]}` : '')
    const body = await requestBody(request)
    const contentType = request.get('content-type')
    if (request.method === 'POST' && /\/nodes\/[^/]+\/children$/.test(request.path) && !isPdfMultipart(request, body)) {
      return response.status(415).json({ error: 'PDF_UPLOAD_REQUIRED' })
    }
    const headers = { Accept: request.get('accept') || 'application/json', Authorization: request.session.authorization }
    if (contentType) headers['Content-Type'] = contentType
    const upstream = await fetch(url, { method: request.method, headers, body })
    let responseBody = Buffer.from(await upstream.arrayBuffer())
    if (request.method === 'GET' && request.path.endsWith('/children') && request.session.functionalRole === 'jefe-unidad' && upstream.ok) {
      try {
        const payload = JSON.parse(responseBody.toString('utf8'))
        const userId = request.session.alfresco?.id || request.session.user?.id
        const assignedIds = new Set(listDispatchesForUser(userId, request.session.functionalRole, request.session.unit).map((dispatch) => dispatch.documentId))
        if (Array.isArray(payload?.list?.entries)) {
          payload.list.entries = payload.list.entries.filter(({ entry }) => assignedIds.has(entry?.id))
          responseBody = Buffer.from(JSON.stringify(payload))
        }
      } catch {
        return response.status(502).json({ error: 'ALFRESCO_INVALID_LIST_RESPONSE' })
      }
    }
    response.status(upstream.status)
    const upstreamContentType = upstream.headers.get('content-type')
    const isContentResponse = request.path.endsWith('/content')
    if (isContentResponse) {
      response.set('content-type', upstreamContentType === 'application/pdf' ? 'application/pdf' : 'application/octet-stream')
      response.set('content-disposition', 'attachment')
    } else if (upstreamContentType) {
      response.set('content-type', upstreamContentType)
    }
    response.set('x-content-type-options', 'nosniff')
    return response.send(responseBody)
  } catch (error) {
    return response.status(error.status || 502).json({ error: 'ALFRESCO_PROXY_ERROR' })
  }
})

export const server = app.listen(config.port, () => {
  console.log(`Authentication backend listening on port ${config.port}`)
})
