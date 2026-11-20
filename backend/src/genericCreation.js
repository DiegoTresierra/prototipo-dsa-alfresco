import { loadInstitutionalDirectory } from './dispatchDirectory.js'

const fail = (code, status = 403) => Object.assign(new Error(code), { status })

export async function verifyGenericRecipient(settings, session, selection, fetchImpl = (...args) => globalThis.fetch(...args)) {
  const { userId, dependency, functionalRole, folderId } = selection
  if (typeof userId !== 'string' || !userId || typeof dependency !== 'string' || !dependency ||
      typeof functionalRole !== 'string' || !functionalRole) throw fail('GENERIC_RECIPIENT_SELECTION_REQUIRED', 400)
  let directory
  try { directory = await loadInstitutionalDirectory(settings, fetchImpl) }
  catch { throw fail('GENERIC_RECIPIENT_UNVERIFIABLE', 503) }
  const recipient = directory.recipients.find((person) => person.id === userId)
  // Client role/dependency describe the selection, never confer authority.
  if (!recipient || recipient.dependency !== dependency.toLowerCase() || recipient.functionalRole !== functionalRole ||
      settings.userInboxNodeIds?.[userId] !== folderId) throw fail('GENERIC_RECIPIENT_NOT_ALLOWED')
  const folder = (await genericActorGet(settings, session, `/nodes/${encodeURIComponent(folderId)}?include=allowableOperations`, fetchImpl))?.entry
  if (folder?.id !== folderId || folder.isFolder !== true || !folder.allowableOperations?.includes('create') ||
      settings.userInboxNodeIds?.[userId] !== folderId) throw fail('GENERIC_RECIPIENT_FOLDER_DENIED')
  return recipient
}

export async function genericActorGet(settings, session, path, fetchImpl = (...args) => globalThis.fetch(...args)) {
  const prefix = path === '/classes/gd_clasificacion' ? '/alfresco/service/api' : '/alfresco/api/-default-/public/alfresco/versions/1'
  let response
  try {
    response = await fetchImpl(settings.alfrescoTarget + prefix + path, { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', Authorization: session.authorization } })
  } catch { throw fail('GENERIC_RECIPIENT_UNVERIFIABLE', 503) }
  if (!response.ok) throw fail('GENERIC_RECIPIENT_UNVERIFIABLE', [401, 403].includes(response.status) ? 403 : 503)
  try { return await response.json() } catch { throw fail('GENERIC_RECIPIENT_UNVERIFIABLE', 503) }
}
