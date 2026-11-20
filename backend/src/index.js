import express from 'express'
import { createResponseProposalReader } from './responseProposalReader.js'
import { getDistributionAuthorization, invalidateDistributionAuthorization } from './distributionService.js'
import crypto from 'node:crypto'
import * as cookie from 'cookie'
import { Issuer, generators } from 'openid-client'
import { Buffer } from 'node:buffer'
import { config } from './config.js'
import { authenticateBasic, authenticateBearer, buildAlfrescoUrl } from './alfrescoClient.js'
import { createDispatchRepository } from './dispatchRepository.js'
import { acquirePilotLease } from './dispatchPilot.js'
import { allowedRecipientRoles, canDispatch, dispatchIdentity, validateDispatchRequest } from './dispatchPolicy.js'
import { getHierarchyAssignments, replaceHierarchyAssignments } from './organizationStore.js'
import { reserveDocumentNumber } from './numberingStore.js'
import { isForbiddenRetentionMutation } from './emittedRetentionPolicy.js'
import { createOidcTransaction, createSession, consumeOidcTransaction, deleteSession, getSession } from './sessionStore.js'
import { resolveRole } from './roleResolver.js'
import { loadDispatchDirectory, loadInstitutionalDirectory } from './dispatchDirectory.js'
import { resolveManagedRecipients } from './organizationalHierarchy.js'
import { authorizeNodeRead, filterDocumentCollection, validateDocumentReadRequest } from './documentReadPolicy.js'
import { canAttendSession, canIssueResponse, validateAttentionInput } from './attentionPolicy.js'
import { revalidateInstitutionalIdentity } from './institutionalIdentity.js'
import { buildGenericPdfForm } from './pdfCreation.js'
import { genericActorGet, verifyGenericRecipient } from './genericCreation.js'
import { createOfficialEmissionService, hasInstitutionalRead } from './officialEmissionService.js'
import { listInstitutionalEmitted } from './emittedDocuments.js'

const app = express()
const officialEmissionService = createOfficialEmissionService(config)
process.once('exit', officialEmissionService.release)
const dispatchRepository = createDispatchRepository(config)
const releasePilotLease = acquirePilotLease(config)
process.once('exit', releasePilotLease)
const { createDispatch, findAttentionAssignment, findDispatch, listDispatchesForUser, listSentDispatches, updateDispatch } = dispatchRepository
function createReadContext(session) {
  let pending
  const snapshot = () => pending ||= dispatchRepository.loadInbox(session)
  return { session, settings: config,
    listDispatches: dispatchRepository.loadInbox ? async () => (await snapshot()).dispatches : listDispatchesForUser,
    resolveMemberships: dispatchRepository.loadInbox ? async () => (await snapshot()).institutionalMemberships : undefined }
}
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
    institutionalDocumentCode: session.functionalRole === 'direccion' && session.authorizationStatus === 'active' ? session.dependency : '',
    unitVerified: false,
    dispatchRecipientRoles: allowedRecipientRoles(session),
    canAttendAssignments: canAttendSession(session),
    canIssueInstitutionalResponse: canIssueResponse(session),
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

async function getConfiguredRecipients(_session, { requireInbox = true } = {}) {
  const { recipients } = await loadInstitutionalDirectory(config)
  return recipients.map((recipient) => ({ ...recipient, inboxNodeId: config.userInboxNodeIds?.[recipient.id] || '' }))
    .filter((recipient) => !requireInbox || recipient.inboxNodeId)
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

async function requireInstitutionalIdentity(request, response, next) {
  try {
    request.institutionalIdentity = await revalidateInstitutionalIdentity(config, request.session)
    return next()
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.message })
  }
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
    const recipients = await getConfiguredRecipients(request.session, { requireInbox: false })
    return response.json({ recipients })
  } catch {
    return response.status(502).json({ error: 'RECIPIENT_DIRECTORY_UNAVAILABLE' })
  }
})

app.get('/api/documents/emitted', requireSession, async (request, response) => {
  response.set('Cache-Control', 'no-store')
  if (Object.keys(request.query).length) return response.status(400).json({ error: 'EMITTED_QUERY_NOT_ALLOWED' })
  try { return response.json(await listInstitutionalEmitted(config, request.session)) }
  catch (error) { return response.status(error.status || 502).json({ error: error.message || 'EMITTED_READ_FAILED' }) }
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

  app.get(['/api/directory/dispatch-recipients', '/api/directory/unit-heads'], requireSession, async (request, response) => {
    if (!canDispatch(request.session)) return response.status(403).json({ error: 'HIERARCHICAL_DISPATCH_REQUIRED' })
    try {
      const directory = await loadDispatchDirectory(config)
      directory.recipients = await resolveManagedRecipients(request.session, directory.recipients, config.organizationalHierarchyProvider)
      const dependency = String(request.session.dependency || '').toLowerCase()
      return response.json({
        recipients: directory.recipients.filter((recipient) =>
          allowedRecipientRoles(request.session).includes(recipient.functionalRole) &&
          (!request.path.endsWith('/unit-heads') || recipient.functionalRole === 'jefe-unidad') &&
          recipient.dependency === dependency),
        allowedRecipientRoles: allowedRecipientRoles(request.session),
      })
    } catch (error) {
      return response.status(error.status || 502).json({ error: error.message || 'UNIT_HEAD_DIRECTORY_UNAVAILABLE' })
    }
  })

  function requireOfficeHierarchy(request, response) {
    if (request.session.authorizationStatus !== 'active' || request.session.functionalRole !== 'direccion' ||
        !request.session.capabilities?.includes('documents:write') || !request.session.dependency) {
      response.status(403).json({ error: 'DIRECTOR_HIERARCHY_REQUIRED' })
      return false
    }
    return true
  }

  app.get('/api/hierarchy', requireSession, requireInstitutionalIdentity, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    if (!requireOfficeHierarchy(request, response)) return
    try {
      const dependency = String(request.session.dependency).toLowerCase()
      const directory = await loadDispatchDirectory(config)
      return response.json({
        dependency,
        director: {
          id: request.session.alfresco?.id || request.session.user?.id || '',
          displayName: request.session.alfresco?.displayName || request.session.user?.name || request.session.user?.id || 'Director',
        },
        recipients: directory.recipients.filter((recipient) => recipient.dependency === dependency),
        assignments: getHierarchyAssignments(dependency),
      })
    } catch (error) {
      return response.status(error.status || 503).json({ error: error.message || 'HIERARCHY_DIRECTORY_UNAVAILABLE' })
    }
  })

  app.put('/api/hierarchy', requireSession, requireCsrf, requireInstitutionalIdentity, async (request, response) => {
    if (!requireOfficeHierarchy(request, response)) {
      return
    }
    const assignments = request.body?.assignments
    if (!Array.isArray(assignments) || assignments.length > 500) {
      return response.status(400).json({ error: 'INVALID_HIERARCHY_ASSIGNMENTS' })
    }
    try {
      const dependency = String(request.session.dependency).toLowerCase()
      const directory = await loadDispatchDirectory(config)
      const eligible = new Map(directory.recipients
        .filter((recipient) => recipient.dependency === dependency)
        .map((recipient) => [recipient.id, recipient]))
      const laneRoles = { jefes: 'jefe-unidad', especialistas: 'especialista' }
      const seenUsers = new Set()
      const assignedHeads = new Set(assignments
        .filter((assignment) => assignment?.laneId === 'jefes')
        .map((assignment) => String(assignment?.userId || '')))
      for (const assignment of assignments) {
        const laneRole = laneRoles[assignment?.laneId]
        const recipient = eligible.get(String(assignment?.userId || ''))
        if (!laneRole || !recipient || recipient.functionalRole !== laneRole || seenUsers.has(recipient.id)) {
          return response.status(400).json({ error: 'HIERARCHY_MEMBER_NOT_ALLOWED' })
        }
        if (assignment.laneId === 'especialistas' && assignment.unitHeadUserId &&
            (!assignedHeads.has(String(assignment.unitHeadUserId)) || eligible.get(String(assignment.unitHeadUserId))?.functionalRole !== 'jefe-unidad')) {
          return response.status(400).json({ error: 'HIERARCHY_UNIT_HEAD_NOT_ALLOWED' })
        }
        seenUsers.add(recipient.id)
      }
      const actorId = request.session.alfresco?.id || request.session.user?.id || ''
      const saved = replaceHierarchyAssignments(dependency, assignments, actorId)
      return response.json({ assignments: saved })
    } catch (error) {
      const status = error.status || (error.message === 'ORGANIZATION_STORE_UNAVAILABLE' ? 503 : 502)
      const code = error.message === 'ORGANIZATION_STORE_UNAVAILABLE' ? error.message : 'HIERARCHY_SAVE_FAILED'
      return response.status(status).json({ error: code })
    }
  })

  app.get('/api/documents/dispatches', requireSession, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    const userId = request.session.alfresco?.id || request.session.user?.id
    if (!userId || request.session.authorizationStatus !== 'active') return response.status(403).json({ error: 'ROLE_NOT_CONFIGURED' })
    if (!request.session.capabilities?.includes('documents:read')) return response.status(403).json({ error: 'DOCUMENT_READ_REQUIRED' })
    try {
      const snapshot = dispatchRepository.loadInbox ? await dispatchRepository.loadInbox(request.session) : null
      const dispatches = snapshot?.dispatches || await listDispatchesForUser(userId, request.session.functionalRole, request.session.dependency, request.session)
      const sentDispatches = ['direccion', 'jefe-unidad'].includes(request.session.functionalRole)
        ? snapshot?.sentDispatches || await listSentDispatches(userId, request.session.dependency, request.session) : []
      if (request.query.include !== 'documents') return response.json({ dispatches, sentDispatches, discoveryErrors: snapshot?.discoveryErrors || [], persistence: dispatchRepository.kind })
      if (!['jefe-unidad', 'especialista'].includes(request.session.functionalRole)) return response.status(400).json({ error: 'ASSIGNMENT_INBOX_ROLE_REQUIRED' })
      const ids = [...new Set([...dispatches, ...sentDispatches].map((record) => record.documentId).concat(request.session.functionalRole === 'jefe-unidad' ? [...(snapshot?.actorNodes?.keys() || [])] : []))]
      if (ids.length > 10_000) return response.status(503).json({ error: 'DOCUMENT_QUERY_LIMIT_EXCEEDED' })
      const documents = []
      const documentErrors = [...(snapshot?.discoveryErrors || [])]
      const assignmentDocumentIds = new Set([...dispatches, ...sentDispatches].map((record) => record.documentId))
      const context = { session: request.session, settings: config, listDispatches: () => dispatches,
        actorNodes: snapshot?.actorNodes, institutionalMemberships: snapshot?.institutionalMemberships }
      for (const documentId of ids) {
        try {
          if (await authorizeNodeRead(context, documentId)) documents.push(context.nodes.get(documentId))
          else if (assignmentDocumentIds.has(documentId)) documentErrors.push({ documentId, error: 'DOCUMENT_READ_NOT_ALLOWED' })
        } catch {
          documentErrors.push({ documentId, error: 'DOCUMENT_READ_UNAVAILABLE' })
        }
      }
      return response.json({ dispatches, sentDispatches, documents, documentErrors, persistence: dispatchRepository.kind })
    } catch (error) {
      return response.status(error.status || 503).json({ error: error.message || 'DISPATCH_STORE_UNAVAILABLE' })
    }
  })

  app.post(['/api/documents/assignments/attend', '/api/documents/assignments/response'], requireSession, requireCsrf, requireInstitutionalIdentity, async (request, response) => {
    try {
      if (dispatchRepository.kind !== 'alfresco') return response.status(503).json({ error: 'ALFRESCO_ATTENTION_REQUIRED' })
      if (!canAttendSession(request.session)) return response.status(403).json({ error: 'ATTENTION_REQUIRED' })
      const input = validateAttentionInput(request.body, request.path.endsWith('/response'))
      const result = request.path.endsWith('/response') ? await dispatchRepository.linkResponse(input, request.session)
        : await dispatchRepository.attendAssignment(input, request.session)
      return response.json({ ...result, persistence: 'alfresco' })
    } catch (error) {
      return response.status(error.status || 502).json({ error: error.message || 'ATTENTION_FAILED',
        ...(error.responseDocumentId ? { responseDocumentId: error.responseDocumentId } : {}) })
    }
  })

  app.get(['/api/documents/response-proposals', '/api/documents/proposal-version-content'], requireSession, requireInstitutionalIdentity, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try {
      if (dispatchRepository.kind !== 'alfresco') return response.status(503).json({ error: 'ALFRESCO_ATTENTION_REQUIRED' })
      const { documentId, processId, versionId } = request.query
      if (typeof documentId !== 'string' || !/^[A-Za-z0-9-]{1,250}$/.test(documentId) || request.session.authorizationStatus !== 'active' || !request.session.capabilities?.includes('documents:read')) return response.status(403).json({ error: 'DOCUMENT_READ_NOT_ALLOWED' })
      if (['jefe-unidad', 'especialista'].includes(request.session.functionalRole) && !await authorizeNodeRead(createReadContext(request.session), documentId)) return response.status(403).json({ error: 'DOCUMENT_READ_NOT_ALLOWED' })
      const reader = createResponseProposalReader(config)
      if (request.path.endsWith('/response-proposals')) return response.json(await reader.list(documentId, request.session))
      if (typeof processId !== 'string' || processId.length > 250 || typeof versionId !== 'string' || !/^[0-9]+\.[0-9]+$/.test(versionId)) return response.status(400).json({ error: 'INVALID_PROPOSAL_QUERY' })
      const bytes = await reader.content(documentId, processId, versionId, request.session)
      return response.type('application/pdf').set('Content-Disposition', 'attachment; filename="propuesta.pdf"').send(bytes)
    } catch (error) {
      return response.status(error.status || 502).json({ error: error.status === 403 ? 'DOCUMENT_READ_NOT_ALLOWED' : 'PROPOSAL_READ_FAILED' })
    }
  })

  app.get('/api/documents/response-candidates', requireSession, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try {
      if (dispatchRepository.kind !== 'alfresco') return response.status(503).json({ error: 'ALFRESCO_ATTENTION_REQUIRED' })
      return response.json({ documents: await dispatchRepository.listResponseCandidates(request.session) })
    } catch (error) { return response.status(error.status || 502).json({ error: error.message || 'RESPONSE_READ_FAILED' }) }
  })

  app.get(['/api/documents/assignment-responses', '/api/documents/response-content'], requireSession, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try {
      if (dispatchRepository.kind !== 'alfresco') return response.status(503).json({ error: 'ALFRESCO_ATTENTION_REQUIRED' })
      const documentId = request.query.documentId
      if (typeof documentId !== 'string' || !/^[A-Za-z0-9-]+$/.test(documentId) || request.session.authorizationStatus !== 'active' || !request.session.capabilities?.includes('documents:read')) return response.status(403).json({ error: 'DOCUMENT_READ_NOT_ALLOWED' })
      const context = createReadContext(request.session)
      if (['jefe-unidad', 'especialista'].includes(request.session.functionalRole) && !await authorizeNodeRead(context, documentId)) return response.status(403).json({ error: 'DOCUMENT_READ_NOT_ALLOWED' })
      const bundle = await dispatchRepository.relatedResponses(documentId, request.session)
      if (request.path.endsWith('/assignment-responses')) return response.json(bundle)
      const linked = bundle.responses.find((entry) => entry.documentId === request.query.responseDocumentId && entry.available)
      if (!linked) return response.status(403).json({ error: 'RESPONSE_READ_NOT_ALLOWED' })
      const content = await fetch(buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(linked.documentId)}/content`), {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: request.session.authorization },
      })
      if (!content.ok) return response.status(content.status).json({ error: 'RESPONSE_READ_NOT_ALLOWED' })
      if (!content.headers.get('content-type')?.startsWith('application/pdf')) return response.status(415).json({ error: 'PDF_REQUIRED' })
      return response.type('application/pdf').set('Content-Disposition', 'attachment').send(Buffer.from(await content.arrayBuffer()))
    } catch (error) { return response.status(error.status || 502).json({ error: error.message || 'RESPONSE_READ_FAILED' }) }
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

  async function verifyConfiguredFolderMembership(session, documentId, allowedFolders, diagnostic) {
    // A 403 on /parents can deny enumeration without denying the PDF itself.
    // Prove membership from the other end, using only server-configured folders
    // and the same user's ACL-filtered children responses. Never use service auth.
    diagnostic.folderChecks = []
    let inspected = 0
    for (const folderId of allowedFolders) {
      let skipCount = 0
      let more
      do {
        const query = new URLSearchParams({ include: 'association', maxItems: '100', skipCount: String(skipCount) })
        const url = buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(folderId)}/children`, `?${query}`)
        const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', Authorization: session.authorization } })
        diagnostic.folderChecks.push({ folderId, skipCount, status: response.status })
        if ([403, 404].includes(response.status)) break
        if (!response.ok) { diagnostic.reason = 'ALFRESCO_SCOPE_FOLDER_READ_REJECTED'; return false }
        const payload = await response.json().catch(() => null)
        const list = payload?.list
        if (!Array.isArray(list?.entries) || typeof list.pagination?.hasMoreItems !== 'boolean') {
          diagnostic.reason = 'ALFRESCO_SCOPE_FOLDER_INVALID_RESPONSE'
          return false
        }
        if (list.entries.some(({ entry }) => entry?.id === documentId && entry.association?.assocType === 'cm:contains')) {
          diagnostic.reason = 'CONFIGURED_FOLDER_MEMBERSHIP_VERIFIED'
          diagnostic.matchedFolderId = folderId
          return true
        }
        more = list.pagination.hasMoreItems
        skipCount += list.entries.length
        inspected += list.entries.length
        if ((!list.entries.length && more) || inspected > 10_000) {
          diagnostic.reason = 'ALFRESCO_SCOPE_FOLDER_INVALID_PAGING'
          return false
        }
      } while (more)
    }
    diagnostic.reason = 'DOCUMENT_SCOPE_NOT_VERIFIED'
    return false
  }

  async function sourceDocumentBelongsToDependency(session, documentId, diagnostic = {}) {
    const allowedFolders = new Set(Object.values(config.officeInboxNodeIds?.[String(session.dependency || '').toUpperCase()] || {}).filter(Boolean))
    Object.assign(diagnostic, {
      userId: session.alfresco?.id || session.user?.id,
      functionalRole: session.functionalRole,
      dependency: session.dependency,
      documentId,
      configuredFolderIds: [...allowedFolders],
    })
    const reject = (reason) => { diagnostic.reason = reason; return false }
    const url = buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(documentId)}`, '?include=path')
    const result = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', Authorization: session.authorization } })
    diagnostic.nodeStatus = result.status
    const payload = await result.json().catch(() => null)
    const entry = payload?.entry
    if (!result.ok) return reject('ALFRESCO_NODE_READ_REJECTED')
    diagnostic.nodeId = entry?.id
    diagnostic.primaryParentId = entry?.parentId
    diagnostic.isFile = entry?.isFile
    diagnostic.mimeType = entry?.content?.mimeType
    if (entry?.id !== documentId) return reject('ALFRESCO_NODE_ID_MISMATCH')
    if (!entry.isFile || entry.content?.mimeType !== 'application/pdf') return reject('ALFRESCO_NODE_NOT_PDF')
    if (allowedFolders.has(entry.parentId)) {
      diagnostic.reason = 'PRIMARY_PARENT_IN_SCOPE'
      diagnostic.matchedFolderId = entry.parentId
      return true
    }
    let skipCount = 0
    let more
    do {
      const parentsUrl = buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(documentId)}/parents`, `?include=association&maxItems=100&skipCount=${skipCount}`)
      const parentsResponse = await fetch(parentsUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', Authorization: session.authorization } })
      diagnostic.parentsStatus = parentsResponse.status
      const parents = await parentsResponse.json().catch(() => null)
      if (parentsResponse.status === 403) return verifyConfiguredFolderMembership(session, documentId, allowedFolders, diagnostic)
      if (!parentsResponse.ok) return reject('ALFRESCO_PARENTS_READ_REJECTED')
      if (!Array.isArray(parents?.list?.entries)) return reject('ALFRESCO_PARENTS_INVALID_RESPONSE')
      const match = parents.list.entries.find(({ entry: parent }) => allowedFolders.has(parent?.id))
      if (match) {
        diagnostic.reason = 'SECONDARY_PARENT_IN_SCOPE'
        diagnostic.matchedFolderId = match.entry.id
        return true
      }
      more = parents.list.pagination?.hasMoreItems
      skipCount += parents.list.entries.length
      if (typeof more !== 'boolean' || (!parents.list.entries.length && more) || skipCount > 10_000) return reject('ALFRESCO_PARENTS_INVALID_PAGING')
    } while (more)
    return reject('DOCUMENT_OUTSIDE_DEPENDENCY')
  }

  app.post('/api/documents/dispatch', requireSession, requireCsrf, requireInstitutionalIdentity, requireDeliveryLock, async (request, response) => {
    let dispatch
    try {
      const userId = request.session.alfresco?.id || request.session.user?.id
      if (!canDispatch(request.session)) return dispatchError(response, 403, 'HIERARCHICAL_DISPATCH_REQUIRED')
      if (!request.session.capabilities?.includes('documents:read')) return dispatchError(response, 403, 'DOCUMENT_READ_REQUIRED')
      const directory = await loadDispatchDirectory(config)
      const recipients = await resolveManagedRecipients(request.session, directory.recipients, config.organizationalHierarchyProvider)
      const input = validateDispatchRequest(request.body, request.session, recipients)
      return await dispatchRepository.withDocument(input.documentId, async () => {
      const identity = dispatchIdentity(request.session, input.requestKey)
      const existing = await findDispatch(userId, input.requestKey, input.documentId)
      if (existing) {
        const requestedRecipients = JSON.stringify(input.recipients.map((recipient) => [recipient.id, recipient.functionalRole]).sort())
        const storedRecipients = JSON.stringify(existing.recipients.map((recipient) => [recipient.userId, recipient.functionalRole]).sort())
        if (existing.documentId !== input.documentId || storedRecipients !== requestedRecipients ||
            existing.instruction !== input.instruction || existing.priority !== input.priority ||
            (existing.originAssignmentId || null) !== input.originAssignmentId || existing.senderRole !== input.senderRole) {
          return dispatchError(response, 409, 'DISPATCH_REQUEST_CONFLICT', existing)
        }
      }
      if (identity.startsWith(':')) return dispatchError(response, 403, 'SESSION_IDENTITY_REQUIRED')
      if (request.session.functionalRole === 'jefe-unidad') {
        const origin = await findAttentionAssignment(userId, input.documentId, input.senderDependency, input.originAssignmentId)
        if (!origin) return dispatchError(response, 403, 'DISPATCH_ATTENTION_ASSIGNMENT_REQUIRED')
        const source = await fetch(buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(input.documentId)}`), {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { Accept: 'application/json', Authorization: request.session.authorization },
        })
        const node = (await source.json().catch(() => null))?.entry
        if (!source.ok || node?.id !== input.documentId || !node.isFile || node.content?.mimeType !== 'application/pdf') {
          return dispatchError(response, 403, 'DISPATCH_DOCUMENT_NOT_ALLOWED')
        }
      } else {
        const diagnostic = {}
        const allowed = await sourceDocumentBelongsToDependency(request.session, input.documentId, diagnostic)
        if (config.alfrescoDiagnostics) console.info('[dispatch-authorization]', JSON.stringify({ ...diagnostic, allowed }))
        if (!allowed) {
          return response.status(403).json({ error: 'DISPATCH_DOCUMENT_NOT_ALLOWED', ...(config.alfrescoDiagnostics ? { diagnostic } : {}) })
        }
      }
      if (dispatchRepository.kind === 'local' && existing && ['ASIGNADO', 'DESPACHADO'].includes(existing.status)) return response.status(200).json({ dispatch: existing, persistence: 'local' })

      if (dispatchRepository.kind === 'alfresco') {
        dispatch = await createDispatch({ ...input, senderUserId: userId }, request.session)
        return response.status(existing ? 200 : 201).json({ dispatch, persistence: 'alfresco' })
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
      dispatch = updateDispatch(dispatch.id, (current) => ({ ...current, status: 'ASIGNADO', assignmentCompletedAt: new Date().toISOString() }))
      return response.status(201).json({ dispatch, persistence: 'local' })
      })
    } catch (error) {
      if (error.code === 'DISTRIBUTION_SERVICE_NOT_CONFIGURED' || error.code === 'DISTRIBUTION_SERVICE_AUTH_FAILED') {
        return dispatchError(response, 503, error.code, dispatch)
      }
      if (dispatch?.id && dispatchRepository.kind === 'local') {
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
app.post('/api/documents/official-emissions', requireSession, requireCsrf, async (request, response) => {
  try {
    if (request.session.functionalRole !== 'direccion') return response.status(403).json({ error: 'OFFICIAL_DIRECTION_REQUIRED' })
    if (!config.officialEmission.writesEnabled) return response.status(503).json({ error: 'OFFICIAL_EMISSION_WRITES_DISABLED' })
    const body = await requestBody(request)
    let form
    try { form = await new Response(body, { headers: { 'Content-Type': request.get('content-type') || '' } }).formData() }
    catch { return response.status(400).json({ error: 'OFFICIAL_INVALID_REQUEST' }) }
    const allowed = ['filedata', 'requestKey', 'title', 'description', 'documentType', 'documentPeriod', 'priority', 'recipientDependency', 'receiptCategory']
    if ([...form.keys()].some((key) => !allowed.includes(key) || form.getAll(key).length !== 1)) return response.status(400).json({ error: 'OFFICIAL_INVALID_REQUEST' })
    const file = form.get('filedata')
    if (!file || typeof file.arrayBuffer !== 'function') return response.status(400).json({ error: 'PDF_UPLOAD_REQUIRED' })
    const input = Object.fromEntries(allowed.filter((key) => key !== 'filedata').map((key) => [key, form.get(key)]))
    const result = await officialEmissionService.issue(request.session, { ...input, file: Buffer.from(await file.arrayBuffer()) })
    return response.status(201).json(result)
  } catch (error) {
    return response.status(error.status || 502).json({ error: error.message || 'OFFICIAL_EMISSION_FAILED', uncertain: Boolean(error.uncertain), ...(error.emittedNodeId ? { emittedNodeId: error.emittedNodeId } : {}) })
  }
})
app.post(['/api/documents/send-to-director', '/api/documents/retry-director-delivery'], requireSession, requireCsrf, requireInstitutionalIdentity, requireDeliveryLock, async (request, response) => {
  const retry = request.path.endsWith('/retry-director-delivery')
  if (!retry) {
    request.deliveryRelease()
    return response.status(403).json({ error: 'OFFICIAL_EMISSION_ENDPOINT_REQUIRED' })
  }
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

  if (typeof request.body?.nodeId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(request.body.nodeId)) return response.status(400).json({ error: 'INVALID_DIRECTOR_DELIVERY' })

  try {
    // Fail before creating a PDF if the configured distribution account cannot authenticate.
    const distributionHeaders = { Accept: 'application/json', Authorization: await getDistributionAuthorization() }
    const upstreamHeaders = {
      Accept: 'application/json',
      Authorization: session.authorization,
    }
    const existing = await fetch(buildAlfrescoUrl(config.alfrescoTarget, `/api/-default-/public/alfresco/versions/1/nodes/${encodeURIComponent(request.body.nodeId)}`, '?include=properties'), { headers: upstreamHeaders })
    const payload = await existing.json().catch(() => null)
    if (payload?.entry?.properties?.['gd:identidadEmision']) return response.status(403).json({ error: 'OFFICIAL_RETRY_ENDPOINT_REQUIRED' })
    const emittedEntry = payload?.entry
    if (!existing.ok || !emittedEntry || emittedEntry.parentId !== emittedNodeId || emittedEntry.createdByUser?.id !== session.alfresco.id || emittedEntry.nodeType !== 'cm:content' || emittedEntry.isFile !== true || emittedEntry.content?.mimeType !== 'application/pdf') return response.status(403).json({ error: 'DIRECTOR_RETRY_NOT_ALLOWED' })
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
    // Recovery only: never grant permissions from this endpoint.
    if (!hasInstitutionalRead(currentPermissions, recipientGroupId)) {
      return response.status(409).json({ error: 'DIRECTOR_RECIPIENT_NODE_READ_REQUIRED', emittedNodeId: emittedEntry.id })
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

async function containsOfficialMetadata(request, body) {
  try {
    const form = await new Response(body, { headers: { 'Content-Type': request.get('content-type') || '' } }).formData()
    return ['gd:numero', 'gd:codigoDocumental', 'gd:cicloDocumental', 'gd:identidadEmision'].some((key) => form.has(key))
  } catch { return true }
}

app.use('/api/alfresco', requireSession, requireCsrf, async (request, response) => {
  try {
    if (request.session.authorizationStatus !== 'active') return response.status(403).json({ error: 'ROLE_NOT_CONFIGURED' })
    if (isForbiddenRetentionMutation(request)) return response.status(403).json({ error: 'DOCUMENT_RETENTION_OPERATION_FORBIDDEN' })
    const readRequest = validateDocumentReadRequest(request, config)
    if (!isAllowedAlfrescoRequest(request)) {
      const isUpload = request.method === 'POST' && /\/nodes\/[^/]+\/children$/.test(request.path)
      if (isUpload && !request.session.capabilities?.includes('documents:write')) {
        return response.status(403).json({ error: 'DOCUMENT_WRITE_NOT_ALLOWED' })
      }
      if (isUpload) return response.status(403).json({ error: 'RECIPIENT_INBOX_NOT_CONFIGURED' })
      return response.status(403).json({ error: 'ALFRESCO_OPERATION_NOT_ALLOWED' })
    }
    const requestPath = request.path
    const readContext = createReadContext(request.session)
    if (readRequest?.nodeId && !readRequest.collection && !await authorizeNodeRead(readContext, readRequest.nodeId)) {
      return response.status(403).json({ error: 'DOCUMENT_READ_NOT_ALLOWED' })
    }
    if (readRequest?.collection) {
      const payload = await filterDocumentCollection(readContext, request, readRequest)
      return response.set('x-content-type-options', 'nosniff').json(payload)
    }
    const url = buildAlfrescoUrl(config.alfrescoTarget, requestPath, request.url.split('?')[1] ? `?${request.url.split('?')[1]}` : '')
    let body = await requestBody(request)
    const contentType = request.get('content-type')
    if (request.method === 'POST' && /\/nodes\/[^/]+\/children$/.test(request.path) && !isPdfMultipart(request, body)) {
      return response.status(415).json({ error: 'PDF_UPLOAD_REQUIRED' })
    }
    if (request.method === 'POST' && /\/nodes\/[^/]+\/children$/.test(request.path)) {
      const uploadFolder = decodeURIComponent(request.path.match(/\/nodes\/([^/]+)\/children$/)[1])
      const emittedFolders = Object.values(config.officeInboxNodeIds || {}).map((folders) => folders.emitidos)
      if (await containsOfficialMetadata(request, body) || emittedFolders.includes(uploadFolder)) return response.status(403).json({ error: 'OFFICIAL_EMISSION_ENDPOINT_REQUIRED' })
    }
    const genericCreation = request.method === 'POST' && /\/nodes\/[^/]+\/children$/.test(request.path)
    let genericDocumentType
    if (genericCreation) {
      await revalidateInstitutionalIdentity(config, request.session)
      body = await buildGenericPdfForm(body, contentType, {
        readClassification: () => genericActorGet(config, request.session, '/classes/gd_clasificacion'),
      })
      genericDocumentType = body.get('gd:tipoDocumental')
      await verifyGenericRecipient(config, request.session, {
        userId: request.get('x-uac-recipient-user'), dependency: request.get('x-uac-recipient-dependency'),
        functionalRole: request.get('x-uac-recipient-role'),
        folderId: decodeURIComponent(request.path.match(/\/nodes\/([^/]+)\/children$/)[1]),
      })
    }
    const headers = { Accept: request.get('accept') || 'application/json', Authorization: request.session.authorization }
    if (contentType && !genericCreation) headers['Content-Type'] = contentType
    const upstream = await fetch(url, { method: request.method, headers, body })
    let responseBody = Buffer.from(await upstream.arrayBuffer())
    if (genericCreation && genericDocumentType && upstream.ok) {
      let created
      try { created = JSON.parse(responseBody.toString('utf8'))?.entry } catch { /* uncertain creation below */ }
      try {
        if (typeof created?.id !== 'string' || !/^[A-Za-z0-9-]+$/.test(created.id)) throw new Error('INVALID_CREATED_NODE')
        const verified = (await genericActorGet(config, request.session, `/nodes/${encodeURIComponent(created.id)}?include=properties,aspectNames`))?.entry
        if (verified?.id !== created.id || verified.nodeType !== 'cm:content' || verified.isFile !== true || verified.content?.mimeType !== 'application/pdf' ||
            !verified.aspectNames?.includes('gd:clasificacion') || verified.properties?.['gd:tipoDocumental'] !== genericDocumentType) throw new Error('INVALID_CREATED_METADATA')
        responseBody = Buffer.from(JSON.stringify({ entry: verified }))
      } catch {
        return response.status(502).json({ error: 'GENERIC_CREATE_OUTCOME_UNCERTAIN', uncertain: true,
          ...(created?.id && /^[A-Za-z0-9-]+$/.test(created.id) ? { emittedNodeId: created.id } : {}) })
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
    return response.status(error.status || 502).json({ error: ['RESERVED_DOCUMENT_METADATA', 'INVALID_PDF_MULTIPART', 'PDF_UPLOAD_REQUIRED', 'INSTITUTIONAL_IDENTITY_REJECTED', 'INSTITUTIONAL_IDENTITY_UNAVAILABLE',
      'GENERIC_RECIPIENT_SELECTION_REQUIRED', 'GENERIC_RECIPIENT_UNVERIFIABLE', 'GENERIC_RECIPIENT_NOT_ALLOWED', 'GENERIC_RECIPIENT_FOLDER_DENIED', 'GENERIC_DOCUMENT_TYPE_INVALID', 'GENERIC_DOCUMENT_TYPE_MODEL_REQUIRED'].includes(error.message) ? error.message : 'ALFRESCO_PROXY_ERROR' })
  }
})

export const server = app.listen(config.port, () => {
  console.log(`Authentication backend listening on port ${config.port}`)
})
server.once('close', releasePilotLease)
server.once('close', officialEmissionService.release)
if (config.dispatchPersistence === 'alfresco' && config.dispatchPilot.writesEnabled) {
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)))
}
