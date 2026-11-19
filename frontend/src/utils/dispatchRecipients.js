// Roles come from the authenticated backend session, not from unit metadata.
export function eligibleDispatchRecipients(recipients, allowedRecipientRoles) {
  return recipients.filter((recipient) => allowedRecipientRoles.includes(recipient.functionalRole))
}
