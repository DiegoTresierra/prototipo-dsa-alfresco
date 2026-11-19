// Institutional codes must be supplied by a verified backend contract.
// No initials or unit-name derivation is an institutional identifier.
export function derivePersonCode() { return '' }
export function getIssuerCode({ verifiedCode = '' } = {}) { return verifiedCode }
