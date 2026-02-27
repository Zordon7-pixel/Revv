import { Navigate } from 'react-router-dom'
import { getToken } from '../lib/auth'

export default function PublicOnlyRoute({ children }) {
  return getToken() ? <Navigate to="/dashboard" replace /> : children
}
