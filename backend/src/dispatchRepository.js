import { createAlfrescoDispatchRepository } from './alfrescoDispatchRepository.js'

export function createDispatchRepository(settings, fetchImpl, options) {
  if (settings.dispatchPersistence !== 'alfresco') throw new Error('INVALID_DISPATCH_PERSISTENCE')
  return createAlfrescoDispatchRepository(settings, fetchImpl, options)
}
