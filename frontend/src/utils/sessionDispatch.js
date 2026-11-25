export function sessionDispatchRoles(session) {
  return session.dispatchWritesEnabled === true ? session.dispatchRecipientRoles || [] : []
}
