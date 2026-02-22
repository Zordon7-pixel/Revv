import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RepairOrders from './pages/RepairOrders'
import RODetail from './pages/RODetail'
import Customers from './pages/Customers'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Users from './pages/Users'
import Portal from './pages/Portal'
import TimeClock from './pages/TimeClock'
import Schedule from './pages/Schedule'
import Register from './pages/Register'

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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/portal" element={<PrivateRoute><Portal /></PrivateRoute>} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="ros" element={<RepairOrders />} />
          <Route path="ros/:id" element={<RODetail />} />
          <Route path="customers" element={<Customers />} />
          <Route path="timeclock" element={<TimeClock />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="reports" element={<AdminRoute><Reports /></AdminRoute>} />
          <Route path="team" element={<AdminRoute><Users /></AdminRoute>} />
          <Route path="settings" element={<AdminRoute><Settings /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
