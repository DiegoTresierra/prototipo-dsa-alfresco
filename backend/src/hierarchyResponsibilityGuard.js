import { hasPendingResponsibilities } from './hasPendingResponsibilities.js'
import { createDocumentQueue } from './documentQueue.js'

// Shared by head changes and specialist reassignments in this process only.
export const withHierarchyChange = createDocumentQueue()

// Readers are trusted server integrations, never request bodies. No inventory is
// fabricated from an empty search. Missing complete coverage blocks the change.
export function createHierarchyResponsibilityGuard({ readHeadEvaluation, readSpecialistEvaluation } = {}) {
  return {
    async checkHead(scope) {
      if (!readHeadEvaluation) return { status: 'INDETERMINATE', blockers: ['RESPONSIBILITY_READER_PENDING'] }
      const input = await readHeadEvaluation(scope)
      if (input?.scope?.unitId !== scope.unitId || input.scope.headUserId !== scope.userId ||
          input.scope.dependency !== scope.dependency.toLowerCase()) {
        return { status: 'INDETERMINATE', blockers: ['RESPONSIBILITY_SCOPE_MISMATCH'] }
      }
      return hasPendingResponsibilities(input)
    },
    async checkSpecialist(scope) {
      if (!readSpecialistEvaluation) return { status: 'INDETERMINATE', blockers: ['SPECIALIST_RESPONSIBILITY_READER_PENDING'] }
      // Specialist duties must not be projected onto a head. A future reader
      // must attest its own complete scope and use the current envelope parser.
      const result = await readSpecialistEvaluation(scope)
      if (result?.source !== 'alfresco' || result?.userId !== scope.userId || result?.unitId !== scope.unitId ||
          result?.dependency !== scope.dependency.toLowerCase() || result?.verified !== true ||
          result?.status === 'NO_PENDING' && (result?.coverageComplete !== true || result?.relationshipsComplete !== true)) {
        return { status: 'INDETERMINATE', blockers: ['SPECIALIST_RESPONSIBILITY_EVIDENCE_INCOMPLETE'] }
      }
      return result
    },
  }
}

export async function assertNoDocumentResponsibilities(check, scope) {
  const result = typeof check === 'function' ? await check(scope) : null
  if (result?.status !== 'NO_PENDING') {
    const code = result?.status === 'HAS_PENDING' ? 'HIERARCHY_DOCUMENT_RESPONSIBILITIES_PENDING' : 'HIERARCHY_DOCUMENT_COVERAGE_INCOMPLETE'
    throw Object.assign(new Error(code), { code, status: 409, responsibilityAssessment: result || { status: 'INDETERMINATE' } })
  }
}
