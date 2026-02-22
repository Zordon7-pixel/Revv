import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import api from '../lib/api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('sc_token', data.token)
      navigate(data.user.role === 'customer' ? '/portal' : '/')
    } catch {
      setError('Wrong email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-900/50">
            <Wrench size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-wide">REVV</h1>
          <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mt-2">Auto Body Shop Management</p>
        </div>
        <form onSubmit={submit} className="bg-[#1a1d2e] rounded-2xl p-6 border border-[#2a2d3e] space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="demo@shop.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="••••••••" />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-center text-xs text-slate-600">Demo: demo@shop.com / demo1234</p>
        </form>
        <div className="mt-4 text-center">
          <Link to="/register"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
            🚗 New here? Track your vehicle →
          </Link>
        </div>
      </div>
    </div>
  )
}
