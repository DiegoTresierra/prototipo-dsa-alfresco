export function getDashboardRoleId(session) {
  if (session?.authorizationStatus !== 'active' || !session.roleId) return null
  return session.roleId
}
