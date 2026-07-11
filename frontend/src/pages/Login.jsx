import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../lib/api'
import { Logo } from '../components/ui'

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
      if (data?.user?.role === 'superadmin') {
        localStorage.removeItem('sc_token')
        localStorage.removeItem('support_impersonation')
        localStorage.setItem('superadmin_token', data.token)
        navigate('/superadmin')
        return
      }
      localStorage.setItem('sc_token', data.token)
      if (data.user.role === 'owner' && !data.user.onboarded) {
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
      setForgotMsg('If that email exists, a reset link has been sent. Check your inbox (and spam folder).')
    } catch {
      setForgotMsg('Something went wrong. Please try again.')
    } finally {
      setForgotLoading(false)
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
          <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-brand">Auto Body Shop Management</p>
        </div>

        {!forgotMode ? (
          <form onSubmit={submit} className="space-y-4 rounded-instrument border border-line-2 bg-panel p-6">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                placeholder="you@example.com" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                placeholder="••••••••" />
            </div>
            {error && <p className="text-xs text-crit" role="alert">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <div className="flex items-center justify-between">
              <p className="text-xs text-faint">Use your shop credentials.</p>
              <button type="button" onClick={() => { setForgotMode(true); setForgotMsg('') }}
                className="text-xs text-brand transition-colors hover:text-brand-lit">
                Forgot password?
              </button>
            </div>
            <div className="pt-1">
              <Link to="/shop-register"
                className="text-xs font-medium text-brand transition-colors hover:text-brand-lit">
                Shop owner? Create your account →
              </Link>
            </div>
          </form>
        ) : (
          <form onSubmit={submitForgot} className="space-y-4 rounded-instrument border border-line-2 bg-panel p-6">
            <h2 className="font-display text-sm font-semibold text-ink">Reset your password</h2>
            <p className="text-xs text-faint">Enter your email address and we'll send you a reset link.</p>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Email</label>
              <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required
                className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                placeholder="your@email.com" />
            </div>
            {forgotMsg && <p className="text-xs text-brand" role="status" aria-live="polite">{forgotMsg}</p>}
            <button type="submit" disabled={forgotLoading}
              className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
              {forgotLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button type="button" onClick={() => setForgotMode(false)}
              className="w-full py-1 text-xs text-faint transition-colors hover:text-ink">
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
