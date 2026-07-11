import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '../components/ui'

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
      localStorage.removeItem('sc_token')
      localStorage.removeItem('support_impersonation')
      localStorage.setItem('superadmin_token', data.token)
      navigate('/superadmin')
    } catch {
      setError('Wrong email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-4 text-ink">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-instrument border border-brand/30 bg-panel shadow-lg">
            <Logo variant="mark" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-wide">Master Access</h1>
          <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-brand">Platform Control</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-instrument border border-line-2 bg-panel p-6">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Master Username</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
              placeholder="superadmin@example.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-xs text-crit" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-xs text-faint">Use your master superadmin username and password.</p>
        </form>
      </div>
    </div>
  )
}
