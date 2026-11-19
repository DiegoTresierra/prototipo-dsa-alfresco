import { useAssignmentInbox } from './useAssignmentInbox'
import { getEmittedDocuments } from '../api/alfresco'

// Same refresh/error lifecycle; the data source is institutional Emitidos,
// independent of assignment states and browser confirmation records.
export function useEmittedInbox(options) {
  return useAssignmentInbox({ ...options, loadInbox: getEmittedDocuments })
}
