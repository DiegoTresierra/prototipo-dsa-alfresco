// Explicit application boundary. These proxy operations were already excluded
// by the allowlist; keep retention independent of future additions to it.
// Applies to all nodes: no UUID knowledge or frontend flag can waive retention.
// Internal cm:contains addition for DTI–DSA distribution remains separate.
export function isForbiddenRetentionMutation(request) {
  if (['DELETE', 'PUT', 'PATCH'].includes(request.method)) return true
  return request.method === 'POST' && /\/nodes\/[^/]+\/(?:move|copy)(?:\/|$)/i.test(request.path)
}
