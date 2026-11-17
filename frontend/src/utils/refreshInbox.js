// Both sources run on every refresh, even if one of them fails.
export async function refreshInboxSources(loadDocuments, loadAssignments) {
  const results = await Promise.allSettled([Promise.resolve().then(loadDocuments), loadAssignments ? Promise.resolve().then(loadAssignments) : Promise.resolve()])
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return results[0].value
}
