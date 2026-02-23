import { useEffect, useState } from 'react'
import { MapPin, Wrench, DollarSign, Save, RefreshCw, CheckCircle, ShieldCheck, Truck, Trash2, MessageSquare, ChevronDown, X, AlertTriangle, Smartphone } from 'lucide-react'
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
  const [clearing, setClearing]   = useState(false)
  const [smsStatus, setSmsStatus] = useState({ configured: false, sms_phone: null })
  const [smsLoading, setSmsLoading] = useState(true)
  const [smsExamplesOpen, setSmsExamplesOpen] = useState(false)
  const [showTestSmsModal, setShowTestSmsModal] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [testSmsResult, setTestSmsResult] = useState({ type: '', message: '' })
  const [profile, setProfile] = useState({ name: '', phone: '' })
  const [profileSaved, setProfileSaved] = useState(false)

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
        monthly_revenue_target: r.data.monthly_revenue_target ?? 85000,
      })
      if (r.data.state) fetchMarket(r.data.state)
    })
    api.get('/market/rates').then(r => setStates(r.data.states || []))
    api.get('/sms/status')
      .then(r => setSmsStatus({ configured: !!r.data.configured, sms_phone: r.data.sms_phone || r.data.phone || null }))
      .catch(() => setSmsStatus({ configured: false, sms_phone: null }))
      .finally(() => setSmsLoading(false))
    api.get('/users/me').then(r => setProfile({ name: r.data.name || '', phone: r.data.phone || '' }))
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
        labor_rate:               parseFloat(form.labor_rate),
        parts_markup:             parseFloat(form.parts_markup) / 100,
        tax_rate:                 parseFloat(form.tax_rate) / 100,
        lat:                      form.lat != null ? parseFloat(form.lat) : undefined,
        lng:                      form.lng != null ? parseFloat(form.lng) : undefined,
        geofence_radius:          form.geofence_radius ? parseFloat(form.geofence_radius) / 3281 : 0.5,
        tracking_api_key:         form.tracking_api_key || null,
        monthly_revenue_target:   parseInt(form.monthly_revenue_target, 10) || 85000,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function saveProfile() {
    await api.put('/users/me', profile)
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 3000)
  }

  async function sendTestSMS() {
    if (!testPhone) {
      setTestSmsResult({ type: 'error', message: 'Please enter a phone number first.' })
      return
    }

    setSendingTest(true)
    setTestSmsResult({ type: '', message: '' })
    try {
      await api.post('/sms/test', {
        phone: testPhone,
        message: `REVV test SMS from ${form.name || 'your shop'} - notifications are connected.`,
      })
      setTestSmsResult({ type: 'success', message: 'Test SMS sent successfully.' })
    } catch (e) {
      setTestSmsResult({ type: 'error', message: e?.response?.data?.error || 'Failed to send test SMS.' })
    } finally {
      setSendingTest(false)
    }
  }

  async function clearDemoData() {
    if (!window.confirm('This will permanently delete all repair orders, customers, and vehicles.\n\nYour shop settings, staff accounts, and rates will NOT be touched.\n\nAre you sure?')) return
    setClearing(true)
    try {
      await api.delete('/market/demo-data')
      alert('Done! All demo data cleared. You\'re starting fresh.')
      window.location.reload()
    } catch(e) {
      alert('Something went wrong. Try again.')
    } finally { setClearing(false) }
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
              <span className="font-bold text-sm">{mkt.stateName} - {mkt.tierLabel}</span>
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

        {/* My Profile */}
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-white text-sm">My Profile</h2>
          <p className="text-xs text-slate-500">Your name and the phone number where REVV will send you notifications (late clock-ins, alerts).</p>
          <div>
            <label className={lbl}>Full Name</label>
            <input className={inp} value={profile.name} onChange={e => setProfile(p => ({...p, name: e.target.value}))} placeholder="Your name" />
          </div>
          <div>
            <label className={lbl}>Your Notification Phone</label>
            <input className={inp} value={profile.phone} onChange={e => setProfile(p => ({...p, phone: e.target.value}))} placeholder="(212) 555-0100" />
            <p className="text-xs text-slate-600 mt-1">REVV sends late clock-in alerts and other notifications here.</p>
          </div>
          <button onClick={saveProfile} type="button" className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors">
            {profileSaved ? <span className="inline-flex items-center gap-1"><CheckCircle size={12} /> Saved</span> : 'Save Profile'}
          </button>
        </div>

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
                <option value="">- Select state -</option>
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

          {/* Monthly Revenue Target */}
          <div>
            <label className={lbl}>Monthly Revenue Target ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
              <input className={`${inp} pl-6`} type="number" step="1000" min="0"
                value={form.monthly_revenue_target || ''} onChange={e => setForm(f => ({...f, monthly_revenue_target: e.target.value}))} placeholder="85000" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Used on the Reports page to track progress toward your monthly goal.</p>
          </div>

          {/* Rate explainer */}
          <div className="bg-[#0f1117] rounded-xl p-3 text-xs text-slate-500 space-y-1 mt-2">
            <p>• <strong className="text-slate-400">Labor Rate</strong> - applied to all labor hours on repair orders</p>
            <p>• <strong className="text-slate-400">Parts Markup</strong> - gross margin above your cost on all parts</p>
            <p>• <strong className="text-slate-400">Tax Rate</strong> - sales tax applied to parts (labor is typically exempt)</p>
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

          {locMsg && (
            <p className={`text-xs flex items-center gap-1 ${locMsg.startsWith('✓') ? 'text-emerald-400' : 'text-amber-400'}`}>
              {locMsg.startsWith('✓') && <CheckCircle size={12} />}
              {locMsg.startsWith('✓') ? locMsg.slice(2) : locMsg}
            </p>
          )}

          {!form.lat && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs text-amber-300 flex items-center gap-2">
              <AlertTriangle size={13} className="flex-shrink-0" /> No shop location set - geofencing is disabled. Employees can clock in from anywhere.
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

        {/* SMS Notifications */}
        <div className="bg-[#1a1d2e] rounded-2xl p-5 border border-[#2a2d3e] space-y-4">
          {smsLoading ? (
            <div className="flex items-center gap-3 text-slate-400 text-sm">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              Loading SMS setup status…
            </div>
          ) : smsStatus.configured ? (
            <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-emerald-300 font-semibold text-sm flex items-center gap-1.5"><CheckCircle size={14} /> SMS Notifications Active</div>
                  <p className="text-xs text-emerald-100/80 mt-1">Customers will receive automatic texts at every repair stage.</p>
                  <p className="text-xs text-emerald-200 mt-2">Sending from: <span className="font-semibold">{smsStatus.sms_phone || 'Twilio number configured'}</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowTestSmsModal(true)
                    setTestSmsResult({ type: '', message: '' })
                  }}
                  className="h-[38px] px-4 rounded-lg text-xs font-semibold bg-[#6366f1] hover:bg-indigo-500 text-white transition-colors"
                >
                  Send Test SMS
                </button>
              </div>

              <div className="rounded-lg border border-emerald-700/30 bg-[#0f1117] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSmsExamplesOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/20"
                >
                  Sample customer messages
                  <ChevronDown size={14} className={`transition-transform ${smsExamplesOpen ? 'rotate-180' : ''}`} />
                </button>
                {smsExamplesOpen && (
                  <div className="px-3 pb-3 text-xs text-slate-300 space-y-2">
                    <p>• <span className="text-emerald-300 font-medium">Check-in:</span> "Your 2019 Honda Accord has been checked in at {form.name || '[Shop Name]'} and work has started."</p>
                    <p>• <span className="text-emerald-300 font-medium">Parts update:</span> "Quick update: we're waiting on parts delivery. We'll text you as soon as they arrive."</p>
                    <p>• <span className="text-emerald-300 font-medium">Ready:</span> "Your vehicle is ready for pickup!"</p>
                    <p>• <span className="text-emerald-300 font-medium">Post-repair:</span> "Thanks for trusting {form.name || '[Shop Name]'}! Reply if you have any questions."</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#0f1117] rounded-xl border border-[#2a2d3e] p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                  <Smartphone size={15} className="text-indigo-400" /> SMS Customer Notifications
                </div>
                <p className="text-xs text-slate-400 mt-1">Send automatic texts to customers at every repair stage.</p>
              </div>

              <div className="border-y border-[#2a2d3e] py-4 space-y-4 text-xs text-slate-300">
                <div>
                  <p className="text-white font-medium">Step 1 → Create a free Twilio account</p>
                  <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer"
                    className="inline-flex mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6366f1] hover:bg-indigo-500 text-white transition-colors">
                    Go to twilio.com →
                  </a>
                </div>

                <div>
                  <p className="text-white font-medium">Step 2 → Get your credentials</p>
                  <p className="mt-1">From your Twilio dashboard, copy:</p>
                  <p>• Account SID (starts with AC...)</p>
                  <p>• Auth Token (click eye icon to reveal)</p>
                </div>

                <div>
                  <p className="text-white font-medium">Step 3 → Buy a phone number</p>
                  <p className="mt-1">Twilio Console → Phone Numbers → Buy a Number (~$1/mo)</p>
                  <p>Choose a local area code for your shop city.</p>
                </div>

                <div>
                  <p className="text-white font-medium">Step 4 → Enter credentials below and save to Railway</p>
                  <p className="mt-1">Go to Railway → your REVV project → Variables → add the 3 vars below.</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-400">Reference fields (read-only reminder of what to set on server):</p>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className={lbl}>TWILIO_ACCOUNT_SID</label>
                    <input className={inp} value="AC......................" readOnly />
                  </div>
                  <div>
                    <label className={lbl}>TWILIO_AUTH_TOKEN</label>
                    <input className={inp} type="password" value="••••••••••••••••••••••" readOnly />
                  </div>
                  <div>
                    <label className={lbl}>TWILIO_PHONE_NUMBER</label>
                    <input className={inp} value="+1..................." readOnly />
                  </div>
                </div>
              </div>

              <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> These are set as server environment variables on Railway, not saved here. Once set, redeploy and this page will show SMS as Active.
              </div>
            </div>
          )}
        </div>

        {/* Parts Tracking */}
        <div className="bg-[#1a1d2e] rounded-2xl p-5 border border-[#2a2d3e] space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold text-sm mb-1">
            <Truck size={15} className="text-indigo-400" /> Parts Tracking (Auto-Sync)
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Add your free <strong className="text-white">17track API key</strong> to automatically sync UPS, FedEx, USPS, and DHL tracking numbers.
            When a part is delivered, REVV marks it received automatically - and your customer portal updates instantly.
          </p>
          <div>
            <label className={lbl}>17track API Key</label>
            <input className={inp} type="password" value={form.tracking_api_key || ''} onChange={e => setForm(f => ({...f, tracking_api_key: e.target.value}))} placeholder="Paste your 17track API key here" />
          </div>
          <div className="bg-[#0f1117] rounded-xl p-3 text-xs text-slate-500 space-y-1">
            <p>1. Go to <strong className="text-indigo-400">17track.net</strong> → sign up for free → Developer → API Key</p>
            <p>2. Free tier: 40 trackings/day - plenty for a shop</p>
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

      {/* Danger Zone */}
      <div className="bg-[#1a1d2e] rounded-2xl p-5 border border-red-900/40 space-y-3">
        <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
          <Trash2 size={15} /> Danger Zone
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Starting fresh? This clears all sample repair orders, customers, and vehicles -
          so you can begin entering real jobs. <strong className="text-white">Your shop info, staff accounts, and rate settings are not affected.</strong>
        </p>
        <button onClick={clearDemoData} disabled={clearing}
          className="flex items-center gap-2 bg-red-900/40 hover:bg-red-900/70 border border-red-700/40 text-red-400 font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50">
          <Trash2 size={14} /> {clearing ? 'Clearing…' : 'Clear All Demo Data'}
        </button>
      </div>

      {showTestSmsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#1a1d2e] border border-[#2a2d3e] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Send Test SMS</h3>
              <button
                type="button"
                onClick={() => {
                  setShowTestSmsModal(false)
                  setTestPhone('')
                  setTestSmsResult({ type: '', message: '' })
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className={lbl}>Phone Number</label>
              <input
                className={inp}
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="+15551234567"
              />
            </div>

            {testSmsResult.message && (
              <p className={`text-xs ${testSmsResult.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                {testSmsResult.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTestSmsModal(false)
                  setTestPhone('')
                  setTestSmsResult({ type: '', message: '' })
                }}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendTestSMS}
                disabled={sendingTest}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#6366f1] hover:bg-indigo-500 text-white disabled:opacity-50"
              >
                {sendingTest ? 'Sending…' : 'Send Test SMS'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
