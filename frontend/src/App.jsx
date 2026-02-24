import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RepairOrders from './pages/RepairOrders'
import RODetail from './pages/RODetail'
import Customers from './pages/Customers'
import Reports from './pages/Reports'
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
import SuperAdminLogin from './pages/SuperAdminLogin'
import SuperAdminDashboard from './pages/SuperAdminDashboard'
import SuperAdminRoute from './components/SuperAdminRoute'

function PrivateRoute({ children }) {
  return localStorage.getItem('sc_token') ? children : <Navigate to="/login" />
}

function AdminRoute({ children }) {
  if (!localStorage.getItem('sc_token')) return <Navigate to="/login" />
  try {
    const role = JSON.parse(atob(localStorage.getItem('sc_token').split('.')[1])).role
    if (!['owner','admin'].includes(role)) return <Navigate to="/" />
  } catch {}
  return children
}

function OwnerRoute({ children }) {
  if (!localStorage.getItem('sc_token')) return <Navigate to="/login" />
  try {
    const role = JSON.parse(atob(localStorage.getItem('sc_token').split('.')[1])).role
    if (role !== 'owner') return <Navigate to="/" />
  } catch {}
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/superadmin/login" element={<SuperAdminLogin />} />
        <Route path="/superadmin" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
        <Route path="/register" element={<Register />} />
        <Route path="/shop-register" element={<ShopRegister />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/invoice/:id" element={<Invoice />} />
        <Route path="/portal" element={<PrivateRoute><Portal /></PrivateRoute>} />
        <Route path="/onboarding" element={<PrivateRoute><Onboarding /></PrivateRoute>} />
        <Route path="/claim/:token" element={<ClaimPortal />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="ros" element={<RepairOrders />} />
          <Route path="ros/:id" element={<RODetail />} />
          <Route path="customers" element={<Customers />} />
          <Route path="timeclock" element={<TimeClock />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="reports" element={<AdminRoute><Reports /></AdminRoute>} />
          <Route path="performance" element={<AdminRoute><Performance /></AdminRoute>} />
          <Route path="team" element={<AdminRoute><Users /></AdminRoute>} />
          <Route path="users" element={<AdminRoute><Users /></AdminRoute>} />
          <Route path="settings" element={<OwnerRoute><Settings /></OwnerRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
