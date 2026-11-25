import { dispatchUnitLabel } from './dispatchTracking.js'

// FNV-1a + avalanche: similar institutional IDs must not yield adjacent hues.
// Pure user-ID mapping; no role, state, random value or page context participates.
export function responsibleColor(userId) {
  let hash = 2166136261
  for (const character of String(userId)) hash = Math.imul(hash ^ character.codePointAt(0), 16777619)
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash = (hash ^ (hash >>> 16)) >>> 0
  return `hsl(${hash % 360} ${58 + ((hash >>> 8) % 3) * 12}% ${34 + ((hash >>> 16) % 3) * 8}%)`
}

export function responsibilityBadges(recipients) {
  return recipients.map((recipient) => {
    const person = recipient.displayName || recipient.userId
    return { key: recipient.userId, label: person + ' · ' + dispatchUnitLabel(recipient), color: responsibleColor(recipient.userId) }
  })
}
