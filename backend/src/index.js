import express from 'express'
import crypto from 'node:crypto'
import * as cookie from 'cookie'
import { Issuer, generators } from 'openid-client'
import { Buffer } from 'node:buffer'
import { config } from './config.js'
import { authenticateBasic, authenticateBearer, buildAlfrescoUrl, getAlfrescoGroupMembers } from './alfrescoClient.js'
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

async function getConfiguredRecipients(session) {
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
    if (typeof inboxNodeId !== 'string' || !inboxNodeId.trim()) continue
    recipients.push({
      id: userId,
      displayName: candidate.member.displayName || userId,
      dependency: [...candidate.dependencies][0].toLowerCase(),
      functionalRole,
      unit: config.userUnitAssignments?.[userId] || null,
      inboxNodeId,
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
  if (!Object.keys(config.groupMappings.dependencies || {}).length || !Object.keys(config.groupMappings.functions || {}).length) {
    return response.status(503).json({ error: 'GROUP_MAPPINGS_REQUIRED' })
  }
  if (Object.keys(config.userInboxNodeIds || {}).length === 0) {
    return response.status(503).json({ error: 'USER_INBOX_MAPPING_REQUIRED' })
  }
  try {
    const recipients = await getConfiguredRecipients(request.session)
    return response.json({ recipients })
  } catch {
    return response.status(502).json({ error: 'RECIPIENT_DIRECTORY_UNAVAILABLE' })
  }
})

app.get('/api/directory/office-inboxes', requireSession, (request, response) => {
  const dependency = request.session.dependency
  if (request.session.authorizationStatus !== 'active' || request.session.functionalRole !== 'direccion' || !dependency) {
    return response.status(403).json({ error: 'DIRECTOR_ROLE_REQUIRED' })
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

app.post('/api/documents/send-to-director', requireSession, requireCsrf, async (request, response) => {
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
    body = await requestBody(request)
  } catch (error) {
    return response.status(error.status || 413).json({ error: 'PDF_UPLOAD_TOO_LARGE' })
  }
  if (!isPdfMultipart(request, body)) return response.status(415).json({ error: 'PDF_UPLOAD_REQUIRED' })

  try {
    const upstreamHeaders = {
      Accept: 'application/json',
      Authorization: session.authorization,
    }
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
    const emittedEntry = emittedResult?.entry
    if (!emittedResponse.ok || !emittedEntry?.id) {
      if (emittedResponse.status === 403) return response.status(403).json({ error: 'DIRECTOR_EMITIDOS_WRITE_FORBIDDEN' })
      if (emittedResponse.status === 404) return response.status(404).json({ error: 'DIRECTOR_EMITIDOS_FOLDER_NOT_FOUND' })
      return response.status(emittedResponse.status || 502).json({ error: 'DIRECTOR_EMITIDOS_UPLOAD_FAILED' })
    }

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
    if (!permissionResponse.ok || !currentPermissions || !Array.isArray(currentPermissions.locallySet)) {
      const error = permissionResponse.status === 403
        ? 'DIRECTOR_NODE_PERMISSION_READ_FORBIDDEN'
        : 'DIRECTOR_NODE_PERMISSION_PARTIAL'
      return response.status(permissionResponse.status === 403 ? 403 : 502).json({ error, emittedNodeId: emittedEntry.id })
    }
    const recipientPermission = currentPermissions.locallySet.find((permission) => permission.authorityId === recipientGroupId)
    const nextPermissions = {
      isInheritanceEnabled: currentPermissions.isInheritanceEnabled !== false,
      locallySet: currentPermissions.locallySet,
    }
    if (!recipientPermission) {
      nextPermissions.locallySet = [
        ...currentPermissions.locallySet,
        { authorityId: recipientGroupId, name: 'Consumer', accessStatus: 'ALLOWED' },
      ]
    }

    if (!recipientPermission) {
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
        const error = updatePermissionsResponse.status === 403
          ? 'DIRECTOR_NODE_PERMISSION_WRITE_FORBIDDEN'
          : 'DIRECTOR_NODE_PERMISSION_PARTIAL'
        return response.status(updatePermissionsResponse.status === 403 ? 403 : 502).json({ error, emittedNodeId: emittedEntry.id })
      }
    } else if (recipientPermission.accessStatus === 'DENIED') {
      return response.status(403).json({ error: 'DIRECTOR_NODE_PERMISSION_CONFLICT', emittedNodeId: emittedEntry.id })
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
          ...upstreamHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ childId: emittedEntry.id, assocType: 'cm:contains' }),
      })
    } catch {
      return response.status(502).json({ error: 'DIRECTOR_MULTIFILING_PARTIAL', emittedNodeId: emittedEntry.id })
    }
    const associationPayload = await associationResponse.arrayBuffer()
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
        return response.status(201).json({ emittedEntry, receivedEntry: emittedEntry })
      }
      return response.status(error === 'DIRECTOR_MULTIFILING_PERMISSION_REQUIRED' ? 403 : 502).json({ error, emittedNodeId: emittedEntry.id })
    }

    // Alfresco returns the same node from both folders; the receiver must be able to read it
    // through an explicit node ACL because secondary parents do not confer permissions.
    return response.status(201).json({ emittedEntry, receivedEntry: emittedEntry })
  } catch {
    return response.status(502).json({ error: 'ALFRESCO_PROXY_ERROR' })
  }
})

function isAllowedAlfrescoRequest(request) {
  const path = request.path
  const isNodeRequest = /^\/api\/-default-\/public\/alfresco\/versions\/1\/nodes\/[^/]+(?:\/children|\/content)?$/.test(path)
  const isGroupMembersRequest = /^\/api\/-default-\/public\/alfresco\/versions\/1\/groups\/[^/]+\/members$/.test(path)
  const isSearchRequest = path === '/api/-default-/public/search/versions/1/search'
  if (request.method === 'GET' && (isNodeRequest || isGroupMembersRequest)) return true
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
    const responseBody = await upstream.arrayBuffer()
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
    return response.send(Buffer.from(responseBody))
  } catch (error) {
    return response.status(error.status || 502).json({ error: 'ALFRESCO_PROXY_ERROR' })
  }
})

app.listen(config.port, () => {
  console.log(`Authentication backend listening on port ${config.port}`)
})
