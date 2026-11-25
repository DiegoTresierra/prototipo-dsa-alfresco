import { resolveRole } from './roleResolver.js'

const core = '/alfresco/api/-default-/public/alfresco/versions/1'
const fail = (code, status) => Object.assign(new Error(code), { status })

export function isServiceIdentity(settings, userId) {
  const configured = [settings.hierarchyService?.username, settings.distributionService?.username, settings.responseTimes?.username,
    ...(settings.technicalUserIds || [])]
  return typeof userId === 'string' && configured.some(id =>
    typeof id === 'string' && id.length > 0 && id.toLowerCase() === userId.toLowerCase())
}

// A request-local snapshot, never a cross-request authorization cache.
export async function readInstitutionalGroups(target, userId, authorization, fetchImpl = (...args) => globalThis.fetch(...args)) {
  const groups = []
  let skip = 0
  for (;;) {
    const payload = await get(target, `${core}/people/${encodeURIComponent(userId)}/groups?maxItems=100&skipCount=${skip}`, authorization, fetchImpl)
    const { entries, pagination } = payload?.list || {}
    if (!Array.isArray(entries) || entries.length > 100 || pagination?.skipCount !== skip ||
        typeof pagination.hasMoreItems !== 'boolean' || entries.some((item) => typeof item?.entry?.id !== 'string' || !item.entry.id) ||
        pagination.hasMoreItems && !entries.length) throw fail('INSTITUTIONAL_IDENTITY_UNAVAILABLE', 503)
    groups.push(...entries.map(({ entry }) => entry.id))
    if (!pagination.hasMoreItems) return [...new Set(groups)]
    skip += entries.length
    if (skip > 10000) throw fail('INSTITUTIONAL_IDENTITY_UNAVAILABLE', 503)
  }
}

async function get(target, path, authorization, fetchImpl) {
  let response
  try {
    response = await fetchImpl(target + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', Authorization: authorization } })
  } catch { throw fail('INSTITUTIONAL_IDENTITY_UNAVAILABLE', 503) }
  if (!response.ok) throw fail([401, 403].includes(response.status) ? 'INSTITUTIONAL_IDENTITY_REJECTED' : 'INSTITUTIONAL_IDENTITY_UNAVAILABLE', [401, 403].includes(response.status) ? 403 : 503)
  try { return await response.json() } catch { throw fail('INSTITUTIONAL_IDENTITY_UNAVAILABLE', 503) }
}

export async function revalidateInstitutionalIdentity(settings, session, fetchImpl = (...args) => globalThis.fetch(...args)) {
  const id = session?.alfresco?.id
  if (!id || isServiceIdentity(settings, id) || !session.authorization || session.authorizationStatus !== 'active') throw fail('INSTITUTIONAL_IDENTITY_REJECTED', 403)
  const me = (await get(settings.alfrescoTarget, `${core}/people/-me-`, session.authorization, fetchImpl))?.entry
  if (me?.id !== id || me.enabled !== true) throw fail('INSTITUTIONAL_IDENTITY_REJECTED', 403)
  const groups = await readInstitutionalGroups(settings.alfrescoTarget, id, session.authorization, fetchImpl)
  const identity = resolveRole(groups, settings.groupMappings, id)
  if (identity.authorizationStatus !== 'active' || identity.functionalRole !== session.functionalRole ||
      identity.dependency !== String(session.dependency || '').toUpperCase()) throw fail('INSTITUTIONAL_IDENTITY_REJECTED', 403)
  return { ...identity, person: me }
}
