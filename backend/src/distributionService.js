import { Buffer } from 'node:buffer'
import { createTicket, getAlfrescoIdentity } from './alfrescoClient.js'
import { config } from './config.js'

let authenticationPromise
let expiresAt = 0

function serviceError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

// Service credentials and tickets are kept on the server, outside user sessions.
export async function getDistributionAuthorization() {
  const { username, password } = config.distributionService
  if (!username || !password) throw serviceError('DISTRIBUTION_SERVICE_NOT_CONFIGURED')
  if (!authenticationPromise || Date.now() >= expiresAt) {
    expiresAt = Date.now() + 5 * 60 * 1000
    authenticationPromise = (async () => {
      try {
        const result = await createTicket(config.alfrescoTarget, username, password)
        if (!result?.entry?.id) throw new Error('Missing ticket')
        const authorization = `Basic ${Buffer.from(result.entry.id, 'utf8').toString('base64')}`
        const identity = await getAlfrescoIdentity(config.alfrescoTarget, authorization)
        if (identity.id !== username || identity.enabled !== true || identity.capabilities?.isAdmin !== false) throw new Error('Invalid service identity')
        return authorization
      } catch {
        authenticationPromise = undefined
        throw serviceError('DISTRIBUTION_SERVICE_AUTH_FAILED')
      }
    })()
  }
  return authenticationPromise
}

export function invalidateDistributionAuthorization() {
  authenticationPromise = undefined
  expiresAt = 0
}
