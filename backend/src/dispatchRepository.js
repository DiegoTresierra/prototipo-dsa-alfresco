import * as local from './dispatchStore.js'
import { createAlfrescoDispatchRepository } from './alfrescoDispatchRepository.js'
import { createDocumentQueue } from './documentQueue.js'

export function createDispatchRepository(settings, fetchImpl) {
  if (settings.dispatchPersistence === 'alfresco') return createAlfrescoDispatchRepository(settings, fetchImpl)
  if (settings.dispatchPersistence !== 'local') throw new Error('INVALID_DISPATCH_PERSISTENCE')
  return { ...local, kind: 'local', withDocument: createDocumentQueue() }
}
