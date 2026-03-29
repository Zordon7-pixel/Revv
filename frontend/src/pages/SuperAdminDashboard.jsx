import { useEffect, useMemo, useState } from 'react'
import { LogIn, LogOut, Search, UserCog } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function SuperAdminDashboard() {
  const [accounts, setAccounts] = useState([])
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [shopFilter, setShopFilter] = useState('')
  const [impersonatingKey, setImpersonatingKey] = useState('')

  const token = localStorage.getItem('superadmin_token')
  const navigate = useNavigate()

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error('Request failed')
    return res.json()
  }

  useEffect(() => {
    let active = true
    async function loadShops() {
      try {
        const shopsRes = await fetchJson('/api/superadmin/shops')
        if (!active) return
        setShops(shopsRes.shops || [])
      } catch {
        if (active) setShops([])
      }
    }
    loadShops()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    async function loadAccounts() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        if (search.trim()) params.set('q', search.trim())
        if (shopFilter) params.set('shop_id', shopFilter)
        const queryString = params.toString()
        const data = await fetchJson(`/api/superadmin/accounts${queryString ? `?${queryString}` : ''}`)
        if (!active) return
        setAccounts(data.accounts || [])
      } catch {
        if (active) setError('Unable to load user accounts.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadAccounts()
    return () => { active = false }
  }, [search, shopFilter])

  const totalShown = useMemo(() => accounts.length, [accounts])

  async function impersonate(userId, key) {
    setImpersonatingKey(key)
    setError('')
    try {
      const res = await fetch('/api/superadmin/impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ user_id: userId })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Impersonation failed')
      if (!data?.token) throw new Error('Missing impersonation token')

      localStorage.setItem('sc_token', data.token)
      localStorage.setItem('support_impersonation', JSON.stringify({
        superadmin_id: data?.impersonation?.by_superadmin_id || null,
        user_id: data?.user?.id || null,
        user_email: data?.user?.email || null,
        started_at: new Date().toISOString(),
      }))
      navigate('/dashboard')
    } catch (err) {
      setError(err?.message || 'Unable to open this account session.')
    } finally {
      setImpersonatingKey('')
    }
  }

  function logoutMaster() {
    localStorage.removeItem('superadmin_token')
    navigate('/superadmin/login')
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-yellow-300 mb-2">
              <UserCog size={14} />
              Master Support Console
            </div>
            <h1 className="text-2xl font-bold tracking-wide">User Account Access</h1>
            <p className="text-xs text-slate-400 mt-1">Support-only view. No shop operations dashboard modules.</p>
          </div>
          <button
            type="button"
            onClick={logoutMaster}
            className="inline-flex items-center justify-center gap-2 text-xs bg-[#1a1d2e] hover:bg-[#22263b] border border-[#2a2d3e] px-3 py-2 rounded-lg text-slate-200"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>

        {error && (
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] text-red-300 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        <div className="bg-[#141824] border border-[#242837] rounded-xl p-4 mb-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by user, email, role, or shop..."
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <select
              value={shopFilter}
              onChange={e => setShopFilter(e.target.value)}
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Shops</option>
              {shops.map(shop => (
                <option key={shop.id} value={shop.id}>{shop.name}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-slate-500 mt-3">
            Showing {loading ? '...' : totalShown} account{totalShown === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-[#141824] border border-[#242837] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 bg-[#10131d]">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">User</th>
                  <th className="text-left px-5 py-3 font-medium">Role</th>
                  <th className="text-left px-5 py-3 font-medium">Shop</th>
                  <th className="text-left px-5 py-3 font-medium">Location</th>
                  <th className="text-right px-5 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {!loading && accounts.map(account => (
                  <tr key={account.id} className="border-t border-[#242837]">
                    <td className="px-5 py-3">
                      <div className="font-medium">{account.name || 'Unnamed User'}</div>
                      <div className="text-xs text-slate-500">{account.email || '—'}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] uppercase tracking-widest text-slate-300">
                        {account.role || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-200">{account.shop_name || '—'}</td>
                    <td className="px-5 py-3 text-slate-400">
                      {account.shop_city || '—'} / {account.shop_state || '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => impersonate(account.id, `user:${account.id}`)}
                        disabled={impersonatingKey === `user:${account.id}`}
                        className="inline-flex items-center gap-1 text-[11px] bg-[#20273a] hover:bg-[#2a334d] disabled:opacity-50 text-indigo-200 px-2.5 py-1.5 rounded-md border border-[#313957]"
                      >
                        <LogIn size={11} />
                        {impersonatingKey === `user:${account.id}` ? 'Opening…' : 'Open Account'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && accounts.length === 0 && (
                  <tr>
                    <td colSpan="5" className="px-5 py-8 text-center text-slate-500">
                      No accounts found for the current filters.
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan="5" className="px-5 py-8 text-center text-slate-500">
                      Loading accounts...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
