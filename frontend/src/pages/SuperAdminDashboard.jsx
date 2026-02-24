import { useEffect, useState } from 'react'

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState(null)
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedShop, setSelectedShop] = useState(null)
  const [shopDetail, setShopDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const token = localStorage.getItem('superadmin_token')

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error('Request failed')
    return res.json()
  }

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [statsRes, shopsRes] = await Promise.all([
          fetchJson('/api/superadmin/stats'),
          fetchJson('/api/superadmin/shops')
        ])
        if (!active) return
        setStats(statsRes)
        setShops(shopsRes.shops || [])
      } catch {
        if (active) setError('Unable to load superadmin data.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  async function selectShop(shop) {
    setSelectedShop(shop)
    setShopDetail(null)
    setDetailLoading(true)
    try {
      const detail = await fetchJson(`/api/superadmin/shops/${shop.id}`)
      setShopDetail(detail)
    } catch {
      setShopDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-wide">Superadmin Dashboard</h1>
            <p className="text-xs text-slate-400 mt-1">REVV platform overview</p>
          </div>
          <div className="text-xs text-yellow-300 uppercase tracking-widest">Superadmin</div>
        </div>

        {error && (
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] text-red-300 text-sm rounded-lg p-3 mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {['total_shops', 'total_users', 'total_ros', 'total_customers'].map((key, idx) => {
            const labels = ['Total Shops', 'Total Users', 'Total ROs', 'Total Customers']
            return (
              <div key={key} className="bg-[#141824] border border-[#242837] rounded-xl p-4">
                <p className="text-xs text-slate-400">{labels[idx]}</p>
                <p className="text-2xl font-semibold text-[#EAB308] mt-2">
                  {stats ? stats[key] : (loading ? '—' : '0')}
                </p>
              </div>
            )
          })}
        </div>

        <div className="bg-[#141824] border border-[#242837] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#242837]">
            <h2 className="text-sm font-semibold text-yellow-300 uppercase tracking-widest">All Shops</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 bg-[#10131d]">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Name</th>
                  <th className="text-left px-5 py-3 font-medium">City/State</th>
                  <th className="text-left px-5 py-3 font-medium">Users</th>
                  <th className="text-left px-5 py-3 font-medium">ROs</th>
                </tr>
              </thead>
              <tbody>
                {shops.map(shop => (
                  <tr
                    key={shop.id}
                    onClick={() => selectShop(shop)}
                    className={`border-t border-[#242837] hover:bg-[#1b2030] cursor-pointer ${
                      selectedShop?.id === shop.id ? 'bg-[#1b2030]' : ''
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium">{shop.name}</div>
                      <div className="text-xs text-slate-500">{shop.phone || '—'}</div>
                    </td>
                    <td className="px-5 py-3 text-slate-300">{shop.city || '—'} / {shop.state || '—'}</td>
                    <td className="px-5 py-3 text-slate-300">{shop.user_count ?? 0}</td>
                    <td className="px-5 py-3 text-slate-300">{shop.ro_count ?? 0}</td>
                  </tr>
                ))}
                {!loading && shops.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-5 py-6 text-center text-slate-500">No shops found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-[#141824] border border-[#242837] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-yellow-300 uppercase tracking-widest">Shop Detail</h3>
            {!selectedShop && <p className="text-sm text-slate-500 mt-4">Select a shop to view details.</p>}
            {selectedShop && detailLoading && <p className="text-sm text-slate-500 mt-4">Loading details...</p>}
            {selectedShop && shopDetail && (
              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <div className="text-lg font-semibold">{shopDetail.shop.name}</div>
                  <div className="text-slate-400">{shopDetail.shop.city || '—'}, {shopDetail.shop.state || '—'}</div>
                </div>
                <div className="text-slate-300">Phone: {shopDetail.shop.phone || '—'}</div>
                <div className="text-slate-300">Address: {shopDetail.shop.address || '—'}</div>
                <div className="text-slate-300">Total ROs: {shopDetail.ro_count ?? 0}</div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 grid grid-cols-1 gap-6">
            <div className="bg-[#141824] border border-[#242837] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-yellow-300 uppercase tracking-widest">Users</h3>
              {shopDetail?.users?.length ? (
                <div className="mt-4 space-y-2 text-sm">
                  {shopDetail.users.map(u => (
                    <div key={u.id} className="flex items-center justify-between border-b border-[#242837] pb-2">
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </div>
                      <div className="text-xs text-slate-300 uppercase tracking-widest">{u.role}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 mt-4">No users found.</p>
              )}
            </div>

            <div className="bg-[#141824] border border-[#242837] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-yellow-300 uppercase tracking-widest">Recent ROs</h3>
              {shopDetail?.recent_ros?.length ? (
                <div className="mt-4 space-y-2 text-sm">
                  {shopDetail.recent_ros.map(ro => (
                    <div key={ro.id} className="flex items-center justify-between border-b border-[#242837] pb-2">
                      <div>
                        <div className="font-medium">RO {ro.id.slice(0, 8)}</div>
                        <div className="text-xs text-slate-500">{ro.job_type}</div>
                      </div>
                      <div className="text-xs text-slate-300 uppercase tracking-widest">{ro.status}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 mt-4">No recent repair orders.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
