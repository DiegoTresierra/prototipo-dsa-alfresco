/* eslint-disable react/prop-types */
export function ResponsibilityIndicator({ badges }) {
  if (!badges.length) return null
  const label = badges.map((badge) => badge.label).join(', ')
  return <span aria-label={'Asignado a: ' + label} className="document-assignment-markers" title={label}>
    {badges.map((badge) => <i key={badge.key} data-user-id={badge.key} title={badge.label} style={{ '--assignment-color': badge.color }} />)}
  </span>
}
