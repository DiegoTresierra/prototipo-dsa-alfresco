import { isValidDispatchUnit } from './dispatchPolicy.js'

function failure(code, status = 502) {
  return Object.assign(new Error(code), { status })
}

// Separate contract: never replace the public v1 client used by other flows.
export async function loadDispatchDirectory(settings, fetchImpl = globalThis.fetch) {
  if (!settings.groupMappings?.functions?.['jefe-unidad'] || !settings.groupMappings?.functions?.especialista) throw failure('GROUP_MAPPINGS_REQUIRED', 503)
  return loadInstitutionalDirectory(settings, fetchImpl, ['jefe-unidad', 'especialista'])
}

export async function loadInstitutionalDirectory(settings, fetchImpl = globalThis.fetch, recipientRoles = ['direccion', 'jefe-unidad', 'especialista']) {
  const { username, password } = settings.distributionService
  if (!username || !password) throw failure('DISPATCH_DIRECTORY_CREDENTIALS_REQUIRED', 503)
  const mappings = settings.groupMappings
  if (!Object.keys(mappings.dependencies || {}).length || !Object.keys(mappings.functions || {}).length) {
    throw failure('GROUP_MAPPINGS_REQUIRED', 503)
  }
  const headers = { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
  const get = async (path) => {
    const response = await fetchImpl(`${settings.alfrescoTarget}${path}`, {
      method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw failure('DISPATCH_DIRECTORY_UNAVAILABLE')
    try { return await response.json() } catch { throw failure('DISPATCH_DIRECTORY_INVALID_RESPONSE') }
  }
  const core = '/alfresco/api/-default-/public/alfresco/versions/1'
  const identity = (await get(`${core}/people/-me-`))?.entry
  if (identity?.id !== username || identity.enabled !== true) throw failure('DISPATCH_DIRECTORY_IDENTITY_INVALID')
  const asArray = (value) => Array.isArray(value) ? value : [value]
  const groups = [...new Set([...Object.values(mappings.dependencies), ...Object.values(mappings.functions)].flatMap(asArray))]
  const memberships = new Map()
  for (const groupId of groups) {
    if (typeof groupId !== 'string' || !/^GROUP_[A-Za-z0-9_-]+$/.test(groupId)) throw failure('GROUP_MAPPINGS_REQUIRED', 503)
    const users = new Map()
    let skipCount = 0
    let expectedTotal
    do {
      const query = new URLSearchParams({ maxItems: '100', skipCount: String(skipCount) })
      const payload = await get(`/alfresco/service/api/groups/${encodeURIComponent(groupId.slice(6))}/children?${query}`)
      const { data, paging } = payload || {}
      if (!Array.isArray(data) || !Number.isSafeInteger(paging?.totalItems) || paging.totalItems < 0 ||
          paging.skipCount !== skipCount || data.length > 100 || (expectedTotal !== undefined && expectedTotal !== paging.totalItems)) {
        throw failure('DISPATCH_DIRECTORY_INVALID_RESPONSE')
      }
      expectedTotal = paging.totalItems
      for (const member of data) {
        if (!member || !['USER', 'GROUP'].includes(member.authorityType) || typeof member.shortName !== 'string' || !member.shortName) {
          throw failure('DISPATCH_DIRECTORY_INVALID_RESPONSE')
        }
        // Inherited membership needs a separately approved policy; do not silently omit subgroups.
        if (member.authorityType === 'GROUP') throw failure('DISPATCH_DIRECTORY_NESTED_GROUPS_UNSUPPORTED', 503)
        if (users.has(member.shortName)) throw failure('DISPATCH_DIRECTORY_INVALID_RESPONSE')
        users.set(member.shortName, { id: member.shortName, displayName: member.displayName?.trim() || member.shortName })
      }
      skipCount += data.length
      if (skipCount > expectedTotal || (!data.length && skipCount < expectedTotal) || skipCount > 10_000) {
        throw failure('DISPATCH_DIRECTORY_INVALID_RESPONSE')
      }
    } while (skipCount < expectedTotal)
    memberships.set(groupId, users)
  }
  const belongs = (userId, mapping) => Object.entries(mapping).filter(([, ids]) => asArray(ids).some((id) => memberships.get(id)?.has(userId))).map(([key]) => key)
  const candidates = new Map(recipientRoles.filter((role) => mappings.functions[role]).flatMap((role) => asArray(mappings.functions[role]).flatMap((id) => [...memberships.get(id)])))
  const recipients = []
  const configurationErrors = []
  for (const [userId, member] of candidates) {
    const dependencies = belongs(userId, mappings.dependencies)
    const roles = belongs(userId, mappings.functions)
    if (dependencies.length !== 1 || roles.length !== 1 || !recipientRoles.includes(roles[0])) continue
    const person = (await get(`${core}/people/${encodeURIComponent(userId)}`))?.entry
    if (person?.id !== userId || typeof person.enabled !== 'boolean') throw failure('DISPATCH_DIRECTORY_INVALID_RESPONSE')
    if (!person.enabled) continue
    const dependency = dependencies[0].toLowerCase()
    const configuredUnit = settings.userUnitAssignments?.[userId]
    const unit = isValidDispatchUnit(configuredUnit, dependency) ? configuredUnit : null
    recipients.push({ ...member, displayName: person.displayName || member.displayName, dependency, functionalRole: roles[0], unit })
  }
  return { recipients: recipients.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es')), configurationErrors }
}
