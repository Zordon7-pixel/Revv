export function isSigningPage() {
  return typeof window !== 'undefined' && /^\/sign\/?$/.test(window.location.pathname)
}
export function scrubSigningSecrets(value) {
  if (typeof value === 'string') return value.replace(/(\/sign\/?#)[a-f0-9]{64}/gi, '$1[redacted]')
  if (Array.isArray(value)) return value.map(scrubSigningSecrets)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubSigningSecrets(item)]))
  return value
}
