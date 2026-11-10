import { Buffer } from 'node:buffer'
import { config } from './config.js'

const corePath = '/alfresco/api/-default-/public/alfresco/versions/1'
const authenticationPath = '/alfresco/api/-default-/public/authentication/versions/1'

function basicHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function ticketHeader(ticket) {
  return `Basic ${Buffer.from(ticket, 'utf8').toString('base64')}`
}

function logDiagnostic(method, endpoint, status, category) {
  if (config.alfrescoDiagnostics) {
    console.info(`[alfresco] method=${method} endpoint=${endpoint} status=${status ?? 'network-error'} category=${category}`)
  }
}

async function parseResponse(response, method, endpoint) {
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!response.ok) {
    const category = response.status === 401 || response.status === 403
      ? 'authorization'
      : response.status >= 500
        ? 'upstream'
        : response.status === 404
          ? 'endpoint'
          : 'request'
    logDiagnostic(method, endpoint, response.status, category)
    const error = new Error(`Alfresco responded with ${response.status}.`)
    error.status = response.status
    error.category = category
    throw error
  }
  logDiagnostic(method, endpoint, response.status, 'success')
  return body
}

async function getJson(target, path, authorization) {
  const endpoint = `${target}${path}`
  try {
    return await parseResponse(await fetch(endpoint, {
      headers: { Accept: 'application/json', Authorization: authorization },
    }), 'GET', endpoint)
  } catch (error) {
    if (!error.status) {
      logDiagnostic('GET', endpoint, null, 'network')
      error.category = 'network'
    }
    throw error
  }
}

export async function createTicket(target, username, password) {
  if (!username || !password) {
    const error = new Error('Basic credentials are required.')
    error.status = 400
    error.category = 'request'
    throw error
  }
  const endpoint = `${target}${authenticationPath}/tickets`
  try {
    return await parseResponse(await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: basicHeader(username, password),
      },
      body: JSON.stringify({ userId: username, password }),
    }), 'POST', endpoint)
  } catch (error) {
    if (!error.status) {
      logDiagnostic('POST', endpoint, null, 'network')
      error.category = 'network'
    }
    throw error
  }
}

export async function getAlfrescoIdentity(target, authorization) {
  const response = await getJson(target, `${corePath}/people/-me-`, authorization)
  const identity = response?.entry
  if (!identity?.id) throw new Error('Alfresco did not return an authenticated identity.')
  return identity
}

export async function getAlfrescoGroups(target, personId, authorization) {
  const response = await getJson(target, `${corePath}/people/${encodeURIComponent(personId)}/groups`, authorization)
  return (response?.list?.entries || []).map(({ entry }) => entry?.id || entry?.displayName).filter(Boolean)
}

export async function authenticateBasic(target, username, password) {
  const ticketResponse = await createTicket(target, username, password)
  const ticket = ticketResponse?.entry?.id
  if (!ticket) throw new Error('Alfresco did not return a valid ticket.')
  const authorization = ticketHeader(ticket)
  const identity = await getAlfrescoIdentity(target, authorization)
  const groups = await getAlfrescoGroups(target, identity.id, authorization)
  return { identity, groups, authorization, ticket }
}

export async function authenticateBearer(target, accessToken) {
  const authorization = `Bearer ${accessToken}`
  const identity = await getAlfrescoIdentity(target, authorization)
  const groups = await getAlfrescoGroups(target, identity.id, authorization)
  return { identity, groups, authorization }
}

export function buildAlfrescoUrl(target, requestPath, query) {
  const allowedPrefixes = [
    '/api/-default-/public/alfresco/versions/1/nodes/',
    '/api/-default-/public/alfresco/versions/1/people/',
    '/api/-default-/public/alfresco/versions/1/groups/',
  ]
  if (!allowedPrefixes.some((prefix) => requestPath.startsWith(prefix))) {
    const error = new Error('The requested Alfresco operation is not allowed.')
    error.status = 403
    throw error
  }
  const url = new URL(`${target}${requestPath.replace(/^\/api/, '/alfresco/api')}`)
  url.search = query
  return url
}
