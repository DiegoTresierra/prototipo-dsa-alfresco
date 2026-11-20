// Test-only GET fixture. Actors are explicitly registered, never inferred from IDs.
export function identityResponse(url, options, actors, mappings) {
  const parsed = new URL(url)
  const actor = actors.get(options?.headers?.Authorization)
  if (!actor) return null
  if (parsed.pathname.endsWith('/people/-me-')) return Response.json({ entry: { id: actor.id, enabled: actor.enabled !== false } })
  if (parsed.pathname === `/alfresco/api/-default-/public/alfresco/versions/1/people/${encodeURIComponent(actor.id)}/groups`) {
    const groups = actor.groups || [mappings.dependencies[actor.dependency], mappings.functions[actor.functionalRole]].flat()
    return Response.json({ list: { entries: groups.map((id) => ({ entry: { id } })), pagination: { skipCount: 0, hasMoreItems: false } } })
  }
  return null
}
