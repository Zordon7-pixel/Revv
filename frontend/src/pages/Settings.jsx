import { useEffect, useState } from 'react'
import { MapPin, Wrench, DollarSign, Save, RefreshCw, CheckCircle, Clock, ShieldCheck, Truck } from 'lucide-react'
import api from '../lib/api'

const TIER_COLORS = {
  1: 'text-purple-400 bg-purple-900/30 border-purple-700',
  2: 'text-blue-400 bg-blue-900/30 border-blue-700',
  3: 'text-indigo-400 bg-indigo-900/30 border-indigo-700',
  4: 'text-slate-400 bg-slate-900/30 border-slate-700',
}
const TIER_LABELS = { 1:'Major Metro', 2:'Large City', 3:'Mid-Size Market', 4:'Small Market' }

export default function Settings() {
  const [shop,   setShop]   = useState(null)
  const [states, setStates] = useState([])
  const [form,   setForm]   = useState({})
  const [mkt,    setMkt]    = useState(null)   // suggested rates for selected state
  const [saving, setSaving]       = useState(false)
  const [saved,  setSaved]        = useState(false)
  const [locating, setLocating]   = useState(false)
  const [locMsg,   setLocMsg]     = useState('')

  useEffect(() => {
    api.get('/market/shop').then(r => {
      setShop(r.data)
      setForm({
        name:             r.data.name         || '',
        phone:            r.data.phone        || '',
        address:          r.data.address      || '',
        city:             r.data.city         || '',
        state:            r.data.state        || '',
        zip:              r.data.zip          || '',
        labor_rate:       r.data.labor_rate   ?? 62,
        parts_markup:     r.data.parts_markup != null ? (r.data.parts_markup * 100).toFixed(0) : 30,
        tax_rate:         r.data.tax_rate     != null ? (r.data.tax_rate * 100).toFixed(2)     : 7.00,
        lat:              r.data.lat          ?? null,
        lng:              r.data.lng          ?? null,
        geofence_radius:  r.data.geofence_radius != null ? Math.round(r.data.geofence_radius * 3281) : 500,
        tracking_api_key: r.data.tracking_api_key || '',
      })
      if (r.data.state) fetchMarket(r.data.state)
    })
    api.get('/market/rates').then(r => setStates(r.data.states || []))
  }, [])

  function fetchMarket(stateCode) {
    if (!stateCode) { setMkt(null); return }
    api.get(`/market/rates?state=${stateCode}`).then(r => setMkt(r.data)).catch(() => setMkt(null))
  }

  function handleStateChange(e) {
    const code = e.target.value
    setForm(f => ({ ...f, state: code }))
    fetchMarket(code)
  }

  function applyMarketRates() {
    if (!mkt) return
    setForm(f => ({
      ...f,
      labor_rate:   mkt.laborRate,
      parts_markup: (mkt.partsMarkup * 100).toFixed(0),
      tax_rate:     (mkt.taxRate * 100).toFixed(2),
    }))
  }

  async function detectLocation() {
    setLocating(true); setLocMsg('')
    if (!navigator.geolocation) { setLocMsg('Geolocation not supported by this browser.'); setLocating(false); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({ ...f, lat: pos.coords.latitude, lng: pos.coords.longitude }))
        setLocMsg('✓ Location captured! Save settings to apply.')
        setLocating(false)
      },
      () => { setLocMsg('Could not get location. Make sure location access is allowed.'); setLocating(false) },
      { timeout: 10000, maximumAge: 0 }
    )
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.put('/market/shop', {
        ...form,
        labor_rate:       parseFloat(form.labor_rate),
        parts_markup:     parseFloat(form.parts_markup) / 100,
        tax_rate:         parseFloat(form.tax_rate) / 100,
        lat:              form.lat != null ? parseFloat(form.lat) : undefined,
        lng:              form.lng != null ? parseFloat(form.lng) : undefined,
        geofence_radius:  form.geofence_radius ? parseFloat(form.geofence_radius) / 3281 : 0.5,
        tracking_api_key: form.tracking_api_key || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1.5'

  if (!shop) return <div className="flex items-center justify-center h-64 text-slate-500">Loading...</div>

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Shop Settings</h1>
      </div>

      {/* Market Tier Banner */}
      {mkt && (
        <div className={`rounded-xl p-4 border flex items-start gap-4 ${TIER_COLORS[mkt.tier]}`}>
          <MapPin size={20} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">{mkt.stateName} — {mkt.tierLabel}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Tier {mkt.tier}</span>
            </div>
            <p className="text-xs opacity-80 mt-1">
              Market rates for this region: <strong>${mkt.laborRate}/hr labor</strong> · <strong>{(mkt.partsMarkup*100).toFixed(0)}% parts markup</strong> · <strong>{(mkt.taxRate*100).toFixed(2)}% tax</strong>
            </p>
          </div>
          <button onClick={applyMarketRates}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
            <RefreshCw size={12} /> Apply Rates
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">

        {/* Shop Info */}
        <div className="bg-[#1a1d2e] rounded-2xl p-5 border border-[#2a2d3e] space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold text-sm mb-1">
            <Wrench size={15} className="text-indigo-400" /> Shop Information
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={lbl}>Shop Name</label>
              <input className={inp} value={form.name || ''} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Premier Auto Body" />
            </div>
            <div>
              <label className={lbl}>Phone</label>
              <input className={inp} value={form.phone || ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="(555) 000-0000" />
            </div>
            <div>
              <label className={lbl}>ZIP Code</label>
              <input className={inp} value={form.zip || ''} onChange={e => setForm(f => ({...f, zip: e.target.value}))} placeholder="10001" maxLength={10} />
            </div>
            <div>
              <label className={lbl}>City</label>
              <input className={inp} value={form.city || ''} onChange={e => setForm(f => ({...f, city: e.target.value}))} placeholder="New York" />
            </div>
            <div>
              <label className={lbl}>State</label>
              <select className={inp} value={form.state || ''} onChange={handleStateChange}>
                <option value="">— Select state —</option>
                {states.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={lbl}>Street Address</label>
              <input className={inp} value={form.address || ''} onChange={e => setForm(f => ({...f, address: e.target.value}))} placeholder="123 Main Street" />
            </div>
          </div>
        </div>

        {/* Rate Settings */}
        <div className="bg-[#1a1d2e] rounded-2xl p-5 border border-[#2a2d3e] space-y-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              <DollarSign size={15} className="text-indigo-400" /> Rate Configuration
            </div>
            {mkt && (
              <span className="text-[10px] text-indigo-400 italic">
                Auto-suggested for {mkt.stateName} · override anytime
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={lbl}>Labor Rate ($/hr)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                <input className={`${inp} pl-6`} type="number" step="1" min="30" max="250"
                  value={form.labor_rate || ''} onChange={e => setForm(f => ({...f, labor_rate: e.target.value}))} />
              </div>
              {mkt && parseFloat(form.labor_rate) !== mkt.laborRate && (
                <p className="text-[10px] text-amber-400 mt-1">Market avg: ${mkt.laborRate}/hr</p>
              )}
            </div>
            <div>
              <label className={lbl}>Parts Markup (%)</label>
              <div className="relative">
                <input className={`${inp} pr-6`} type="number" step="1" min="0" max="100"
                  value={form.parts_markup || ''} onChange={e => setForm(f => ({...f, parts_markup: e.target.value}))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
              </div>
              {mkt && parseInt(form.parts_markup) !== Math.round(mkt.partsMarkup*100) && (
                <p className="text-[10px] text-amber-400 mt-1">Market avg: {(mkt.partsMarkup*100).toFixed(0)}%</p>
              )}
            </div>
            <div>
              <label className={lbl}>Tax Rate (%)</label>
              <div className="relative">
                <input className={`${inp} pr-6`} type="number" step="0.01" min="0" max="20"
                  value={form.tax_rate || ''} onChange={e => setForm(f => ({...f, tax_rate: e.target.value}))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
              </div>
              {mkt && parseFloat(form.tax_rate) !== parseFloat((mkt.taxRate*100).toFixed(2)) && (
                <p className="text-[10px] text-amber-400 mt-1">State avg: {(mkt.taxRate*100).toFixed(2)}%</p>
              )}
            </div>
          </div>

          {/* Rate explainer */}
          <div className="bg-[#0f1117] rounded-xl p-3 text-xs text-slate-500 space-y-1 mt-2">
            <p>• <strong className="text-slate-400">Labor Rate</strong> — applied to all labor hours on repair orders</p>
            <p>• <strong className="text-slate-400">Parts Markup</strong> — gross margin above your cost on all parts</p>
            <p>• <strong className="text-slate-400">Tax Rate</strong> — sales tax applied to parts (labor is typically exempt)</p>
          </div>
        </div>

        {/* Time Clock Geofencing */}
        <div className="bg-[#1a1d2e] rounded-2xl p-5 border border-[#2a2d3e] space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold text-sm mb-1">
            <ShieldCheck size={15} className="text-indigo-400" /> Time Clock Geofencing
          </div>
          <p className="text-xs text-slate-400">
            Employees can only clock in or out when they are within this distance of the shop.
            Set your shop's location first, then choose the radius.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={detectLocation} disabled={locating}
              className="flex items-center gap-2 bg-indigo-900/40 hover:bg-indigo-900/70 border border-indigo-700/40 text-indigo-300 text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
              <MapPin size={13}/> {locating ? 'Detecting…' : form.lat ? 'Update Shop Location' : 'Set Shop Location'}
            </button>
            {form.lat && form.lng && (
              <span className="text-[10px] text-slate-500 font-mono">
                {parseFloat(form.lat).toFixed(4)}, {parseFloat(form.lng).toFixed(4)}
              </span>
            )}
          </div>

          {locMsg && <p className={`text-xs ${locMsg.startsWith('✓') ? 'text-emerald-400' : 'text-amber-400'}`}>{locMsg}</p>}

          {!form.lat && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs text-amber-300">
              ⚠️ No shop location set — geofencing is disabled. Employees can clock in from anywhere.
            </div>
          )}

          <div>
            <label className={lbl}>Geofence Radius (feet)</label>
            <div className="flex items-center gap-4">
              <input type="range" min="100" max="2640" step="50"
                value={form.geofence_radius || 500}
                onChange={e => setForm(f => ({...f, geofence_radius: +e.target.value}))}
                className="flex-1 accent-indigo-500" />
              <span className="text-sm font-bold text-indigo-400 min-w-[70px] text-right">
                {(form.geofence_radius || 500).toLocaleString()} ft
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              ≈ {((form.geofence_radius || 500) / 5280).toFixed(2)} miles · Default: 500 ft
            </p>
          </div>
        </div>

        {/* Parts Tracking */}
        <div className="bg-[#1a1d2e] rounded-2xl p-5 border border-[#2a2d3e] space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold text-sm mb-1">
            <Truck size={15} className="text-indigo-400" /> Parts Tracking (Auto-Sync)
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Add your free <strong className="text-white">17track API key</strong> to automatically sync UPS, FedEx, USPS, and DHL tracking numbers. 
            When a part is delivered, REVV marks it received automatically — and your customer portal updates instantly.
          </p>
          <div>
            <label className={lbl}>17track API Key</label>
            <input className={inp} type="password" value={form.tracking_api_key || ''} onChange={e => setForm(f => ({...f, tracking_api_key: e.target.value}))} placeholder="Paste your 17track API key here" />
          </div>
          <div className="bg-[#0f1117] rounded-xl p-3 text-xs text-slate-500 space-y-1">
            <p>1. Go to <strong className="text-indigo-400">17track.net</strong> → sign up for free → Developer → API Key</p>
            <p>2. Free tier: 40 trackings/day — plenty for a shop</p>
            <p>3. Supports UPS, FedEx, USPS, DHL, and 2,000+ other carriers</p>
            <p className="text-slate-600">Without a key: tracking numbers still show as clickable links to the carrier website.</p>
          </div>
        </div>

        {/* Save */}
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl px-6 py-3 text-sm transition-colors disabled:opacity-50">
          {saved ? <><CheckCircle size={16} /> Saved!</> : saving ? 'Saving...' : <><Save size={16} /> Save Settings</>}
        </button>
      </form>
    </div>
  )
}
