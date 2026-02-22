import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RepairOrders from './pages/RepairOrders'
import RODetail from './pages/RODetail'
import Customers from './pages/Customers'
import Reports from './pages/Reports'

function PrivateRoute({ children }) {
  return localStorage.getItem('sc_token') ? children : <Navigate to="/login" />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="ros" element={<RepairOrders />} />
          <Route path="ros/:id" element={<RODetail />} />
          <Route path="customers" element={<Customers />} />
          <Route path="reports" element={<Reports />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
