import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { Logo } from '../components/ui'

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
    <div className="flex min-h-screen items-center justify-center bg-void p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-instrument border border-line-2 bg-white shadow-lg">
            <Logo variant="mark" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-ink">REVV</h1>
          <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-brand">Set New Password</p>
        </div>

        {success ? (
          <div className="space-y-4 rounded-instrument border border-line-2 bg-panel p-6 text-center">
            <p className="text-sm font-semibold text-good">Password updated.</p>
            <p className="text-xs text-faint">You can now sign in with your new password.</p>
            <button onClick={() => navigate('/login')}
              className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit">
              Go to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-instrument border border-line-2 bg-panel p-6">
            {!token && (
              <p className="text-xs text-crit" role="alert">Missing reset token. Please use the link from the email.</p>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">New Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                placeholder="••••••••" />
            </div>
            {error && <p className="text-xs text-crit" role="alert">{error}</p>}
            <button type="submit" disabled={loading || !token}
              className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
            <button type="button" onClick={() => navigate('/login')}
              className="w-full py-1 text-xs text-faint transition-colors hover:text-ink">
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
