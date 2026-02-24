import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function SuperAdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      if (!res.ok) throw new Error('Login failed')
      const data = await res.json()
      if (data?.user?.role !== 'superadmin') {
        setError('Not authorized for superadmin access.')
        return
      }
      localStorage.setItem('superadmin_token', data.token)
      navigate('/superadmin')
    } catch {
      setError('Wrong email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#EAB308] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-yellow-900/40">
            <span className="text-[#0f1117] font-bold text-xl tracking-tight">REVV</span>
          </div>
          <h1 className="text-2xl font-bold tracking-wide">Superadmin</h1>
          <p className="text-xs font-semibold text-yellow-300 uppercase tracking-widest mt-2">Platform Control</p>
        </div>

        <form onSubmit={submit} className="bg-[#141824] rounded-2xl p-6 border border-[#242837] space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#EAB308] transition-colors"
              placeholder="admin@revv.app"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#EAB308] transition-colors"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#EAB308] hover:bg-[#f2c64b] text-[#0f1117] font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-xs text-slate-500">Superadmin: admin@revv.app / admin1234</p>
        </form>
      </div>
    </div>
  )
}
