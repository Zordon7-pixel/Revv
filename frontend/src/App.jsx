import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import PublicOnlyRoute from './components/PublicOnlyRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RepairOrders from './pages/RepairOrders'
import RODetail from './pages/RODetail'
import Customers from './pages/Customers'
import Reports from './pages/Reports'
import MonthlyReport from './pages/MonthlyReport'
import Performance from './pages/Performance'
import Settings from './pages/Settings'
import Users from './pages/Users'
import Portal from './pages/Portal'
import TimeClock from './pages/TimeClock'
import Schedule from './pages/Schedule'
import Register from './pages/Register'
import ShopRegister from './pages/ShopRegister'
import Onboarding from './pages/Onboarding'
import ClaimPortal from './pages/ClaimPortal'
import ResetPassword from './pages/ResetPassword'
import Invoice from './pages/Invoice'
import PartsOnOrder from './pages/PartsOnOrder'
import Payments from './pages/Payments'
import TechView from './pages/TechView'
import ApprovalPortal from './pages/ApprovalPortal'
import BookAppointment from './pages/BookAppointment'
import SuperAdminLogin from './pages/SuperAdminLogin'
import SuperAdminDashboard from './pages/SuperAdminDashboard'
import SuperAdminRoute from './components/SuperAdminRoute'
import TrackPortal from './pages/TrackPortal'
import ShopProfile from './pages/ShopProfile'
import ADASCalibration from './pages/ADASCalibration'
import { LanguageProvider } from './contexts/LanguageContext'
import JobCosting from './pages/JobCosting'
import Landing from './pages/Landing'
import { getToken } from './lib/auth'

function PrivateRoute({ children }) {
  return getToken() ? children : <Navigate to="/login" />
}

function AdminRoute({ children }) {
  if (!getToken()) return <Navigate to="/login" />
  try {
    const role = JSON.parse(atob(getToken().split('.')[1])).role
    if (!['owner','admin'].includes(role)) return <Navigate to="/" />
  } catch {}
  return children
}

function OwnerRoute({ children }) {
  if (!getToken()) return <Navigate to="/login" />
  try {
    const role = JSON.parse(atob(getToken().split('.')[1])).role
    if (role !== 'owner' && role !== 'admin') return <Navigate to="/" />
  } catch {}
  return children
}

function EmployeeOnlyRoute({ children }) {
  if (!getToken()) return <Navigate to="/login" />
  try {
    const role = JSON.parse(atob(getToken().split('.')[1])).role
    if (!['employee', 'staff'].includes(role)) return <Navigate to="/" />
  } catch {
    return <Navigate to="/" />
  }
  return children
}

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicOnlyRoute><Landing /></PublicOnlyRoute>} />
          <Route path="/login" element={<Login />} />
          <Route path="/superadmin/login" element={<SuperAdminLogin />} />
          <Route path="/superadmin" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
          <Route path="/register" element={<Register />} />
          <Route path="/shop-register" element={<ShopRegister />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/invoice/:id" element={<Invoice />} />
          <Route path="/approve/:token" element={<ApprovalPortal />} />
          <Route path="/track/:token" element={<TrackPortal />} />
          <Route path="/shop/:shopId" element={<ShopProfile />} />
          <Route path="/book" element={<BookAppointment />} />
          <Route path="/portal" element={<PrivateRoute><Portal /></PrivateRoute>} />
          <Route path="/onboarding" element={<PrivateRoute><Onboarding /></PrivateRoute>} />
          <Route path="/claim/:token" element={<ClaimPortal />} />
          <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="ros" element={<RepairOrders />} />
            <Route path="parts" element={<OwnerRoute><PartsOnOrder /></OwnerRoute>} />
            <Route path="payments" element={<Payments />} />
            <Route path="tech" element={<EmployeeOnlyRoute><TechView /></EmployeeOnlyRoute>} />
            <Route path="ros/:id" element={<RODetail />} />
            <Route path="customers" element={<Customers />} />
            <Route path="timeclock" element={<TimeClock />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="reports" element={<AdminRoute><Reports /></AdminRoute>} />
            <Route path="monthly-report" element={<OwnerRoute><MonthlyReport /></OwnerRoute>} />
            <Route path="performance" element={<AdminRoute><Performance /></AdminRoute>} />
            <Route path="team" element={<AdminRoute><Users /></AdminRoute>} />
            <Route path="users" element={<AdminRoute><Users /></AdminRoute>} />
            <Route path="settings" element={<OwnerRoute><Settings /></OwnerRoute>} />
            <Route path="adas" element={<AdminRoute><ADASCalibration /></AdminRoute>} />
            <Route path="job-costing" element={<OwnerRoute><JobCosting /></OwnerRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
  )
}
