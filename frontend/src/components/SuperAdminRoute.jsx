import { Navigate } from 'react-router-dom'

function decodeJwtPayload(token) {
  if (!token || token.split('.').length < 2) return null
  const payloadPart = token.split('.')[1]
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return JSON.parse(atob(padded))
}

export default function SuperAdminRoute({ children }) {
  const token = localStorage.getItem('superadmin_token')
  if (!token) return <Navigate to="/superadmin/login" />
  try {
    const role = decodeJwtPayload(token)?.role
    if (role !== 'superadmin') return <Navigate to="/superadmin/login" />
  } catch {
    return <Navigate to="/superadmin/login" />
  }
  return children
}
