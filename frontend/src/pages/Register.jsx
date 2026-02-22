import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Wrench, Car } from 'lucide-react'
import api from '../lib/api'

export default function Register() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    try {
      const { data } = await api.post('/auth/register', { email, password })
      localStorage.setItem('sc_token', data.token)
      navigate('/portal')
    } catch (e) {
      setError(e?.response?.data?.error || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1.5'

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-900/50">
            <Wrench size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-wide">REVV</h1>
          <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mt-2">Track Your Vehicle</p>
        </div>

        <div className="bg-[#1a1d2e] rounded-2xl p-6 border border-[#2a2d3e] space-y-5">
          <div className="flex items-start gap-3 bg-indigo-900/20 border border-indigo-700/30 rounded-xl p-3">
            <Car size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300 leading-relaxed">
              Use the <strong className="text-white">email you gave the shop</strong> when you dropped off your vehicle. You'll be linked to your repair automatically.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={lbl}>Email on file with the shop</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className={inp} placeholder="your@email.com" />
            </div>
            <div>
              <label className={lbl}>Create a password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className={inp} placeholder="At least 6 characters" />
            </div>
            <div>
              <label className={lbl}>Confirm password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                className={inp} placeholder="••••••••" />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3 text-xs text-red-300">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50">
              {loading ? 'Setting up your account…' : 'Create Account & Track My Vehicle'}
            </button>
          </form>

          <div className="text-center pt-1">
            <Link to="/login" className="text-xs text-slate-500 hover:text-indigo-400 transition-colors">
              Already have an account? Sign in →
            </Link>
          </div>
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-4">
          Don't see your vehicle after signing in? Contact the shop to make sure your email is on file.
        </p>
      </div>
    </div>
  )
}
