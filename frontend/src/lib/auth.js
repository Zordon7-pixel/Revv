export function getToken() {
  return localStorage.getItem('sc_token')
}

function decodeJwtPayload(token) {
  if (!token || token.split('.').length < 2) return null
  const payloadPart = token.split('.')[1]
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return JSON.parse(atob(padded))
}

export function getTokenPayload() {
  const token = getToken()
  if (!token) return null
  try {
    return decodeJwtPayload(token)
  } catch {
    return null
  }
}

export function getRole() {
  return getTokenPayload()?.role || null
}

export function isAdmin() {
  const role = getRole()
  return role === 'owner' || role === 'admin'
}

export function isOwner() {
  return getRole() === 'owner'
}

export function isEmployee() {
  const role = getRole()
  return ['owner', 'admin', 'technician', 'employee', 'staff'].includes(role)
}

export function isAssistant() {
  return getRole() === 'assistant'
}

export function isCustomer() {
  return getRole() === 'customer'
}
