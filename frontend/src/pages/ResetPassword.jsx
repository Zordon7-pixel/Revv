import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import api from '../lib/api'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('Passwords do not match.')
    if (password.length < 6) return setError('Password must be at least 6 characters.')
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      setSuccess(true)
    } catch (err) {
      setError(err?.response?.data?.error || 'Reset failed. The link may have expired.')
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
          <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mt-2">Set New Password</p>
        </div>

        {success ? (
          <div className="bg-[#1a1d2e] rounded-2xl p-6 border border-[#2a2d3e] text-center space-y-4">
            <p className="text-emerald-400 text-sm font-semibold">Password updated.</p>
            <p className="text-slate-500 text-xs">You can now sign in with your new password.</p>
            <button onClick={() => navigate('/login')}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
              Go to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-[#1a1d2e] rounded-2xl p-6 border border-[#2a2d3e] space-y-4">
            {!token && (
              <p className="text-red-400 text-xs">Missing reset token. Please use the link from the email.</p>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">New Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="••••••••" />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button type="submit" disabled={loading || !token}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50">
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
            <button type="button" onClick={() => navigate('/login')}
              className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors py-1">
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
