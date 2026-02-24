import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Wrench, Car } from 'lucide-react'
import api from '../lib/api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMsg, setForgotMsg] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('sc_token', data.token)
      if (data.user.role === 'customer') {
        navigate('/portal')
      } else if (data.user.role === 'owner' && !data.user.onboarded) {
        navigate('/onboarding')
      } else {
        navigate('/')
      }
    } catch {
      setError('Wrong email or password.')
    } finally {
      setLoading(false)
    }
  }

  async function submitForgot(e) {
    e.preventDefault()
    setForgotLoading(true); setForgotMsg('')
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail })
      setForgotMsg('If that email exists, a reset link has been sent. Check the server console.')
    } catch {
      setForgotMsg('Something went wrong. Please try again.')
    } finally {
      setForgotLoading(false)
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

        {!forgotMode ? (
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
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600">Demo: demo@shop.com / demo1234</p>
              <button type="button" onClick={() => { setForgotMode(true); setForgotMsg('') }}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                Forgot password?
              </button>
            </div>
            <div className="pt-1">
              <Link to="/shop-register"
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
                Shop owner? Create your account →
              </Link>
            </div>
          </form>
        ) : (
          <form onSubmit={submitForgot} className="bg-[#1a1d2e] rounded-2xl p-6 border border-[#2a2d3e] space-y-4">
            <h2 className="text-sm font-semibold text-white">Reset your password</h2>
            <p className="text-xs text-slate-500">Enter your email address and we will log a reset link to the server console.</p>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
              <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="your@email.com" />
            </div>
            {forgotMsg && <p className="text-xs text-indigo-400">{forgotMsg}</p>}
            <button type="submit" disabled={forgotLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50">
              {forgotLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button type="button" onClick={() => setForgotMode(false)}
              className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors py-1">
              Back to sign in
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <Link to="/register"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium inline-flex items-center gap-1">
            <Car size={13} /> New here? Track your vehicle →
          </Link>
        </div>
      </div>
    </div>
  )
}
