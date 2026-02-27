export function getToken() {
  return localStorage.getItem('sc_token')
}

export function getTokenPayload() {
  const token = getToken()
  if (!token) return null
  try {
    return JSON.parse(atob(token.split('.')[1]))
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
  return ['owner', 'admin', 'employee', 'staff'].includes(role)
}

export function isCustomer() {
  return getRole() === 'customer'
}
