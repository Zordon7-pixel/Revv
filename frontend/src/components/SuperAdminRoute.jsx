import { Navigate } from 'react-router-dom'

export default function SuperAdminRoute({ children }) {
  const token = localStorage.getItem('superadmin_token')
  if (!token) return <Navigate to="/superadmin/login" />
  try {
    const role = JSON.parse(atob(token.split('.')[1])).role
    if (role !== 'superadmin') return <Navigate to="/superadmin/login" />
  } catch {
    return <Navigate to="/superadmin/login" />
  }
  return children
}
