import { useEffect, useState } from 'react'
import { MapPin, Wrench, DollarSign, Save, RefreshCw, CheckCircle, ShieldCheck, Truck, Trash2, ChevronDown, X, AlertTriangle, Smartphone, LogOut, CalendarDays } from 'lucide-react'
import api from '../lib/api'
import { optimizeImageForUpload } from '../lib/imageUpload'
import { isAdmin } from '../lib/auth'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'
import AppOverlay from '../components/AppOverlay'
import { PageHeader } from '../components/ui'

const TIER_COLORS = {
  1: 'border-brand/40 bg-brand/10 text-brand',
  2: 'border-brand/40 bg-brand/10 text-brand',
  3: 'border-brand/40 bg-brand/10 text-brand',
  4: 'border-line-2 bg-raised text-muted',
}
const TIER_LABELS = { 1:'Major Metro', 2:'Large City', 3:'Mid-Size Market', 4:'Small Market' }

export default function Settings() {
  const currentYearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const [shop,   setShop]   = useState(null)
  const [states, setStates] = useState([])
  const [form,   setForm]   = useState({})
  const [mkt,    setMkt]    = useState(null)   // suggested rates for selected state
  const [saving, setSaving]       = useState(false)
  const [saved,  setSaved]        = useState(false)
  const [saveError, setSaveError] = useState('')
  const [locating, setLocating]   = useState(false)
  const [locMsg,   setLocMsg]     = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [clearing, setClearing]   = useState(false)
  const [smsStatus, setSmsStatus] = useState({ configured: false, sms_phone: null })
  const [smsLoading, setSmsLoading] = useState(true)
  const [smsNotificationsEnabled, setSmsNotificationsEnabled] = useState(true)
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true)
  const [ownerActivityPrefs, setOwnerActivityPrefs] = useState({
    owner_activity_digest_enabled: true,
    owner_activity_immediate_alerts_enabled: true,
    owner_activity_digest_time: '19:00',
    owner_activity_digest_recipients: '',
  })
  const [ownerActivityTestResult, setOwnerActivityTestResult] = useState('')
  const [ownerActivityTestSending, setOwnerActivityTestSending] = useState(false)
  const [smsExamplesOpen, setSmsExamplesOpen] = useState(false)
  const [showTestSmsModal, setShowTestSmsModal] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [testSmsResult, setTestSmsResult] = useState({ type: '', message: '' })
  const [profile, setProfile] = useState({ name: '', phone: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [revokingAll, setRevokingAll] = useState(false)
  const [revokeAllDone, setRevokeAllDone] = useState(false)
  const [goalMonth, setGoalMonth] = useState(currentYearMonth)
  const [goalForm, setGoalForm] = useState({ revenue_goal: '', ro_goal: '' })
  const [goalsLoading, setGoalsLoading] = useState(true)
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalSaved, setGoalSaved] = useState(false)
  const [goalError, setGoalError] = useState('')
  const [billing, setBilling] = useState(null)
  const [billingLoading, setBillingLoading] = useState(true)
  const [billingAction, setBillingAction] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoMessage, setLogoMessage] = useState({ type: '', text: '' })
  const [quickbooksStatus, setQuickbooksStatus] = useState({
    configured: false,
    connected: false,
    sync_enabled: false,
    environment: 'production',
    connected_at: null,
    last_sync_at: null,
  })
  const [quickbooksBusy, setQuickbooksBusy] = useState('')
  const [quickbooksMessage, setQuickbooksMessage] = useState('')
  const [activeSettingsTab, setActiveSettingsTab] = useState('core')
  const userIsAdmin = isAdmin()

  async function refreshSmsStatus() {
    setSmsLoading(true)
    try {
      const r = await api.get('/sms/status')
      setSmsStatus({ configured: !!r.data.configured, sms_phone: r.data.sms_phone || r.data.phone || null, auth_method: r.data.auth_method || null, config_source: r.data.config_source || null, db_has: r.data.db_has || null })
    } catch {
      setSmsStatus({ configured: false, sms_phone: null })
    } finally {
      setSmsLoading(false)
    }
  }

  async function refreshQuickBooksStatus() {
    try {
      const { data } = await api.get('/accounting/quickbooks/status')
      setQuickbooksStatus({
        configured: !!data?.configured,
        connected: !!data?.connected,
        sync_enabled: !!data?.sync_enabled,
        environment: data?.environment || 'production',
        connected_at: data?.connected_at || null,
        last_sync_at: data?.last_sync_at || null,
      })
    } catch {
      setQuickbooksStatus({
        configured: false,
        connected: false,
        sync_enabled: false,
        environment: 'production',
        connected_at: null,
        last_sync_at: null,
      })
    }
  }

  useEffect(() => {
    api.get('/market/shop').then(r => {
      setShop(r.data)
      setForm({
        name:             r.data.name         || '',
        phone:            r.data.phone        || '',
        logo_url:         r.data.logo_url     || '',
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
        twilio_account_sid: '',
        twilio_auth_token: '',
        twilio_phone_number: r.data.twilio_phone_number || '',
        monthly_revenue_target: r.data.monthly_revenue_target ?? 85000,
      })
      if (r.data.state) fetchMarket(r.data.state)
    })
    api.get('/market/rates').then(r => setStates(r.data.states || []))
    refreshSmsStatus()
    api.get('/settings')
      .then(r => {
        setSmsNotificationsEnabled(r?.data?.sms_notifications_enabled !== false)
        setEmailNotificationsEnabled(r?.data?.email_notifications_enabled !== false)
      })
      .catch(() => {
        setSmsNotificationsEnabled(true)
        setEmailNotificationsEnabled(true)
      })
    api.get('/owner-activity/preferences')
      .then(r => setOwnerActivityPrefs({
        owner_activity_digest_enabled: r?.data?.owner_activity_digest_enabled !== false,
        owner_activity_immediate_alerts_enabled: r?.data?.owner_activity_immediate_alerts_enabled === true,
        owner_activity_digest_time: r?.data?.owner_activity_digest_time || '19:00',
        owner_activity_digest_recipients: r?.data?.owner_activity_digest_recipients || '',
      }))
      .catch(() => {})
    api.get('/users/me').then(r => setProfile({ name: r.data.name || '', phone: r.data.phone || '' }))
    api.get('/subscriptions/status')
      .then(r => setBilling(r.data))
      .catch(() => setBilling(null))
      .finally(() => setBillingLoading(false))
    refreshQuickBooksStatus()

    const params = new URLSearchParams(window.location.search)
    const qbState = params.get('qb')
    const qbReason = params.get('reason')
    if (qbState === 'connected') {
      setQuickbooksMessage('QuickBooks connected successfully.')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (qbState === 'error') {
      setQuickbooksMessage(`QuickBooks connection failed${qbReason ? `: ${qbReason}` : '.'}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    loadGoal(goalMonth)
  }, [goalMonth])

  async function loadGoal(yearMonth) {
    setGoalsLoading(true)
    setGoalError('')
    try {
      const { data } = await api.get(`/goals/${yearMonth}`)
      setGoalForm({
        revenue_goal: data?.goal?.revenue_goal ?? 0,
        ro_goal: data?.goal?.ro_goal ?? 0,
      })
    } catch (err) {
      setGoalError(err?.response?.data?.error || 'Failed to load monthly goals.')
    } finally {
      setGoalsLoading(false)
    }
  }

  async function saveGoals() {
    setGoalSaving(true)
    setGoalError('')
    try {
      await api.put(`/goals/${goalMonth}`, {
        revenue_goal: Number(goalForm.revenue_goal || 0),
        ro_goal: Number(goalForm.ro_goal || 0),
      })
      setGoalSaved(true)
      setTimeout(() => setGoalSaved(false), 2500)
    } catch (err) {
      setGoalError(err?.response?.data?.error || 'Failed to save monthly goals.')
    } finally {
      setGoalSaving(false)
    }
  }

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

  async function geocodeFromAddress() {
    const query = [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ')
    if (!query.trim()) { setLocMsg('Enter your shop address, city, and state first.'); return }
    setGeocoding(true)
    setLocMsg('')
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'REVV-ShopManagement/1.0' } }
      )
      const data = await res.json()
      if (!data.length) { setLocMsg('Address not found. Try a more complete address (street, city, state).'); return }
      const { lat, lon } = data[0]
      setForm(f => ({ ...f, lat: parseFloat(lat), lng: parseFloat(lon) }))
      setLocMsg('✓ Location set from address! Save settings to apply.')
    } catch {
      setLocMsg('Could not geocode address. Check your internet connection.')
    } finally {
      setGeocoding(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      const shopFields = { ...form }
      delete shopFields.logo_url
      const { data } = await api.put('/market/shop', {
        ...shopFields,
        labor_rate:               parseFloat(form.labor_rate),
        parts_markup:             parseFloat(form.parts_markup) / 100,
        tax_rate:                 parseFloat(form.tax_rate) / 100,
        lat:                      form.lat != null ? parseFloat(form.lat) : undefined,
        lng:                      form.lng != null ? parseFloat(form.lng) : undefined,
        geofence_radius:          form.geofence_radius ? parseFloat(form.geofence_radius) / 3281 : 0.5,
        tracking_api_key:         form.tracking_api_key || null,
        twilio_account_sid:       (form.twilio_account_sid || '').trim() || undefined,
        twilio_auth_token:        (form.twilio_auth_token || '').trim() || undefined,
        twilio_phone_number:      (form.twilio_phone_number || '').trim() || undefined,
        twilio_api_key:           (form.twilio_api_key || '').trim() || undefined,
        twilio_api_secret:        (form.twilio_api_secret || '').trim() || undefined,
        monthly_revenue_target:   parseInt(form.monthly_revenue_target, 10) || 85000,
      })
      await api.patch('/settings', {
        sms_notifications_enabled: !!smsNotificationsEnabled,
        email_notifications_enabled: !!emailNotificationsEnabled,
      })
      await api.put('/owner-activity/preferences', ownerActivityPrefs)
      setShop(data)
      setForm(f => ({
        ...f,
        name:         data.name         || f.name,
        phone:        data.phone        || f.phone,
        logo_url:     data.logo_url     || '',
        address:      data.address      || f.address,
        city:         data.city         || f.city,
        state:        data.state        || f.state,
        zip:          data.zip          || f.zip,
        labor_rate:   data.labor_rate   ?? f.labor_rate,
        parts_markup: data.parts_markup != null ? (data.parts_markup * 100).toFixed(0) : f.parts_markup,
        tax_rate:     data.tax_rate     != null ? (data.tax_rate * 100).toFixed(2)     : f.tax_rate,
        twilio_phone_number: data.twilio_phone_number || f.twilio_phone_number || '',
        twilio_account_sid: '',
        twilio_auth_token: '',
        twilio_api_key: '',
        twilio_api_secret: '',
      }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      setSaveError('')
      window.dispatchEvent(new CustomEvent('revv:shop-logo-updated', {
        detail: { name: data.name || '', logo_url: data.logo_url || '' },
      }))
      refreshSmsStatus()
    } catch (err) {
      setSaveError(err?.response?.data?.error || 'Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function onLogoPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setLogoMessage({ type: 'error', text: 'Choose a PNG or JPEG logo.' })
      return
    }
    setLogoBusy(true)
    setLogoMessage({ type: '', text: '' })
    try {
      const optimized = await optimizeImageForUpload(file, {
        maxDimension: 560,
        targetBytes: 1.5 * 1024 * 1024,
      })
      const payload = new FormData()
      payload.append('logo', optimized)
      const { data } = await api.post('/market/shop/logo', payload)
      const logoUrl = data?.logo_url || ''
      setForm((prev) => ({ ...prev, logo_url: logoUrl }))
      setShop((prev) => prev ? { ...prev, logo_url: logoUrl } : prev)
      setLogoMessage({ type: 'success', text: 'Shop logo updated.' })
      window.dispatchEvent(new CustomEvent('revv:shop-logo-updated', { detail: { name: form.name || '', logo_url: logoUrl } }))
    } catch (err) {
      setLogoMessage({ type: 'error', text: err?.response?.data?.error || 'Could not upload shop logo.' })
    } finally {
      setLogoBusy(false)
    }
  }

  async function removeShopLogo() {
    setLogoBusy(true)
    setLogoMessage({ type: '', text: '' })
    try {
      await api.delete('/market/shop/logo')
      setForm((prev) => ({ ...prev, logo_url: '' }))
      setShop((prev) => prev ? { ...prev, logo_url: null } : prev)
      setLogoMessage({ type: 'success', text: 'Shop logo removed.' })
      window.dispatchEvent(new CustomEvent('revv:shop-logo-updated', { detail: { name: form.name || '', logo_url: '' } }))
    } catch (err) {
      setLogoMessage({ type: 'error', text: err?.response?.data?.error || 'Could not remove shop logo.' })
    } finally {
      setLogoBusy(false)
    }
  }

  async function saveProfile() {
    setProfileSaving(true)
    setProfileError('')
    try {
      await api.put('/users/me', profile)
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch (err) {
      setProfileError(err?.response?.data?.error || 'Unable to save profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  async function logoutAllDevices() {
    if (!window.confirm('This will immediately sign out all devices logged into your account. You will need to log in again on this device. Continue?')) return
    setRevokingAll(true)
    try {
      await api.post('/auth/logout-all')
      setRevokeAllDone(true)
      setTimeout(() => {
        localStorage.removeItem('sc_token')
        window.location.href = '/login'
      }, 1500)
    } catch {
      alert('Something went wrong. Please try again.')
    } finally {
      setRevokingAll(false)
    }
  }

  async function sendTestSMS() {
    if (!testPhone) {
      setTestSmsResult({ type: 'error', message: 'Please enter a phone number first.' })
      return
    }

    setSendingTest(true)
    setTestSmsResult({ type: '', message: '' })
    try {
      const r = await api.post('/sms/test', {
        phone: testPhone,
        message: `REVV test SMS from ${form.name || 'your shop'} - notifications are connected.`,
      })
      const sid = r?.data?.sid
      setTestSmsResult({ type: 'success', message: `Sent! Twilio SID: ${sid || 'n/a'} — if you didn't receive it, check your Twilio console for delivery status, or verify the number if on a trial account.` })
    } catch (e) {
      setTestSmsResult({ type: 'error', message: e?.response?.data?.error || 'Failed to send test SMS.' })
    } finally {
      setSendingTest(false)
    }
  }

  async function sendOwnerActivityTestDigest() {
    setOwnerActivityTestSending(true)
    setOwnerActivityTestResult('')
    try {
      const { data } = await api.post('/owner-activity/digest/test')
      setOwnerActivityTestResult(data?.sent ? `Test digest sent to ${data.sent} recipient(s).` : 'No recipients found for the test digest.')
    } catch (err) {
      setOwnerActivityTestResult(err?.response?.data?.error || 'Could not send test digest.')
    } finally {
      setOwnerActivityTestSending(false)
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

  async function connectQuickBooks() {
    if (!userIsAdmin) return
    setQuickbooksBusy('connect')
    setQuickbooksMessage('')
    try {
      const { data } = await api.get('/accounting/quickbooks/connect-url')
      if (data?.url) {
        window.location.href = data.url
        return
      }
      setQuickbooksMessage('Could not start QuickBooks connection.')
      setQuickbooksBusy('')
    } catch (err) {
      setQuickbooksMessage(err?.response?.data?.error || 'Could not start QuickBooks connection.')
      setQuickbooksBusy('')
    }
  }

  async function disconnectQuickBooks() {
    if (!userIsAdmin) return
    if (!window.confirm('Disconnect QuickBooks for this shop?')) return
    setQuickbooksBusy('disconnect')
    setQuickbooksMessage('')
    try {
      await api.post('/accounting/quickbooks/disconnect')
      await refreshQuickBooksStatus()
      setQuickbooksMessage('QuickBooks disconnected.')
    } catch (err) {
      setQuickbooksMessage(err?.response?.data?.error || 'Could not disconnect QuickBooks.')
    } finally {
      setQuickbooksBusy('')
    }
  }

  async function toggleQuickBooksSyncEnabled() {
    if (!userIsAdmin || !quickbooksStatus.connected) return
    setQuickbooksBusy('toggle')
    setQuickbooksMessage('')
    try {
      const nextEnabled = !quickbooksStatus.sync_enabled
      await api.patch('/accounting/quickbooks/sync-enabled', { enabled: nextEnabled })
      await refreshQuickBooksStatus()
      setQuickbooksMessage(`Auto-sync ${nextEnabled ? 'enabled' : 'disabled'}.`)
    } catch (err) {
      setQuickbooksMessage(err?.response?.data?.error || 'Could not update auto-sync.')
    } finally {
      setQuickbooksBusy('')
    }
  }

  async function syncQuickBooksBatch() {
    if (!userIsAdmin || !quickbooksStatus.connected) return
    setQuickbooksBusy('sync')
    setQuickbooksMessage('')
    try {
      const { data } = await api.post('/accounting/quickbooks/sync/batch', { limit: 150 })
      setQuickbooksMessage(`Sync complete: ${data?.synced_count || 0} synced, ${data?.failed_count || 0} failed.`)
      await refreshQuickBooksStatus()
    } catch (err) {
      setQuickbooksMessage(err?.response?.data?.error || 'QuickBooks sync failed.')
    } finally {
      setQuickbooksBusy('')
    }
  }

  async function startCheckout(plan) {
    setBillingAction('checkout')
    try {
      const { data } = await api.post('/subscriptions/checkout', { plan })
      if (data?.url) window.location.href = data.url
    } catch (e) {
      alert(e?.response?.data?.error || 'Unable to start checkout.')
    } finally {
      setBillingAction('')
    }
  }

  async function openBillingPortal() {
    setBillingAction('portal')
    try {
      const { data } = await api.post('/subscriptions/portal')
      if (data?.url) window.location.href = data.url
    } catch (e) {
      alert(e?.response?.data?.error || 'Unable to open billing portal.')
    } finally {
      setBillingAction('')
    }
  }

  const currentPlan = (billing?.plan || 'free').toLowerCase()
  const trialEndsAt = billing?.trial_ends_at ? new Date(billing.trial_ends_at) : null
  const trialActive = currentPlan === 'free' && trialEndsAt && trialEndsAt > new Date()
  const planLabel = currentPlan === 'agency' ? 'Agency' : currentPlan === 'pro' ? 'Pro' : 'Free'
  const planBadgeClass = currentPlan === 'agency'
    ? 'border-good/30 bg-good/10 text-good'
    : currentPlan === 'pro'
      ? 'border-brand/30 bg-brand/10 text-brand'
      : 'border-line-2 bg-raised text-muted'

  const inp = 'w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand'
  const lbl = 'mb-1.5 block text-xs font-medium text-muted'
  const settingsTabs = [
    { id: 'core', label: 'Core' },
    { id: 'financial', label: 'Financial' },
    { id: 'messaging', label: 'Messaging' },
    { id: 'operations', label: 'Operations' },
    { id: 'accounting', label: 'Accounting' },
    { id: 'security', label: 'Security' },
    { id: 'danger', label: 'Danger Zone' },
  ]

  if (!shop) return <div className="grid min-h-64 place-items-center text-sm text-muted" role="status">Loading settings...</div>

  return (
    <div className="mx-auto max-w-5xl space-y-6">

      {/* Header */}
      <PageHeader
        eyebrow="Administration"
        title="Shop settings"
        description="Manage shop identity, money defaults, messaging, integrations, security, and billing."
        actions={<button
          type="submit"
          form="shop-settings-form"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
        >
          {saved ? <><CheckCircle size={16} /> Saved!</> : saving ? 'Saving...' : <><Save size={16} /> Save Settings</>}
        </button>}
      />

      <div className="rounded-instrument border border-line bg-panel p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3 px-1">
          <p className="text-xs text-ink">Settings sections</p>
          <p className="text-[11px] text-faint">Core, Financial, and Messaging are the primary tabs.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {settingsTabs.map((tab) => {
            const isActive = activeSettingsTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSettingsTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isActive
                    ? 'border-brand/50 bg-brand/10 text-brand'
                    : 'border-line-2 bg-void text-muted hover:text-ink'
                }`}
              >
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {activeSettingsTab === 'financial' && (
        <>
          <div className="bg-panel border border-line rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold text-ink text-sm">Billing</h2>
              {billingLoading ? (
                <span className="text-xs text-faint">Loading plan...</span>
              ) : (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${planBadgeClass}`}>{planLabel}</span>
              )}
            </div>

            {trialActive && (
              <div className="text-xs text-gold bg-gold/10 border border-gold/30 rounded-lg px-3 py-2">
                Free trial active until {trialEndsAt.toLocaleDateString()}.
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {currentPlan === 'free' && (
                <>
                  <button
                    type="button"
                    onClick={() => startCheckout('pro')}
                    disabled={billingAction === 'checkout'}
                    className="bg-brand hover:bg-brand-lit disabled:opacity-60 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {billingAction === 'checkout' ? 'Redirecting...' : 'Upgrade to Pro ($79/mo)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startCheckout('agency')}
                    disabled={billingAction === 'checkout'}
                    className="bg-good hover:bg-good/80 disabled:opacity-60 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {billingAction === 'checkout' ? 'Redirecting...' : 'Upgrade to Agency ($199/mo)'}
                  </button>
                </>
              )}

              {(currentPlan === 'pro' || currentPlan === 'agency') && (
                <button
                  type="button"
                  onClick={openBillingPortal}
                  disabled={billingAction === 'portal'}
                  className="rounded-lg border border-line-2 bg-raised px-4 py-2 text-xs font-medium text-ink transition-colors hover:border-brand disabled:opacity-60"
                >
                  {billingAction === 'portal' ? 'Opening...' : 'Manage Billing (Change Tier)'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-faint">
              Choose the tier you want at checkout. If you are already on a paid plan, use billing portal to switch tiers.
            </p>
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
        </>
      )}

      <form id="shop-settings-form" onSubmit={handleSave} className="space-y-6">

        {activeSettingsTab === 'core' && (
          <>
            {/* My Profile */}
            <div className="bg-panel border border-line rounded-xl p-5 space-y-4">
              <h2 className="font-semibold text-ink text-sm">My Profile</h2>
              <p className="text-xs text-faint">Your name and the phone number where REVV will send you notifications (late clock-ins, alerts).</p>
              <div>
                <label className={lbl}>Full Name</label>
                <input className={inp} value={profile.name} onChange={e => setProfile(p => ({...p, name: e.target.value}))} placeholder="Your name" />
              </div>
              <div>
                <label className={lbl}>Your Notification Phone</label>
                <input className={inp} value={profile.phone} onChange={e => setProfile(p => ({...p, phone: e.target.value}))} placeholder="(212) 555-0100" />
                <p className="text-xs text-faint mt-1">REVV sends late clock-in alerts and other notifications here.</p>
              </div>
              <button onClick={saveProfile} type="button" disabled={profileSaving} className="bg-brand hover:bg-brand-lit disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors">
                {profileSaved ? <span className="inline-flex items-center gap-1"><CheckCircle size={12} /> Saved</span> : profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
              {profileError && <p className="text-xs text-crit">{profileError}</p>}
            </div>

            {/* Shop Info */}
            <div className="bg-panel rounded-2xl p-5 border border-line space-y-4">
              <div className="flex items-center gap-2 text-ink font-semibold text-sm mb-1">
                <Wrench size={15} className="text-brand" /> Shop Information
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
                <div className="col-span-2">
                  <label className={lbl}>Shop Logo</label>
                  <div className="bg-void border border-line rounded-lg p-3 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-xs bg-brand hover:bg-brand-lit text-white font-semibold px-3 py-1.5 rounded-lg cursor-pointer">
                        {logoBusy ? 'Working...' : form.logo_url ? 'Replace Logo' : 'Upload Logo'}
                        <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onLogoPick} disabled={logoBusy} />
                      </label>
                      {!!form.logo_url && (
                        <button
                          type="button"
                          onClick={removeShopLogo}
                          disabled={logoBusy}
                          className="text-xs bg-raised hover:bg-raised text-ink px-3 py-1.5 rounded-lg"
                        >
                          Remove Logo
                        </button>
                      )}
                      <span className="text-[11px] text-faint">PNG or JPEG, up to 2 MB. Shown in REVV and on printed documents.</span>
                    </div>
                    {logoMessage.text && (
                      <p
                        role={logoMessage.type === 'error' ? 'alert' : 'status'}
                        className={`text-xs ${logoMessage.type === 'error' ? 'text-crit' : 'text-good'}`}
                      >
                        {logoMessage.text}
                      </p>
                    )}
                    {form.logo_url ? (
                      <div className="inline-flex bg-white rounded-lg p-2 border border-line">
                        <img src={resolveUploadedMediaUrl(form.logo_url)} alt="Shop logo preview" className="h-14 w-auto object-contain" />
                      </div>
                    ) : (
                      <p className="text-[11px] text-faint">No logo uploaded yet.</p>
                    )}
                  </div>
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
          </>
        )}

        {activeSettingsTab === 'financial' && (
          <div className="bg-panel rounded-2xl p-5 border border-line space-y-4">
            {/* Rate Settings */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-ink font-semibold text-sm">
              <DollarSign size={15} className="text-brand" /> Rate Configuration
            </div>
            {mkt && (
              <span className="text-[10px] text-brand italic">
                Auto-suggested for {mkt.stateName} · override anytime
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={lbl}>Labor Rate ($/hr)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm">$</span>
                <input className={`${inp} pl-6`} type="number" step="1" min="30" max="250"
                  value={form.labor_rate || ''} onChange={e => setForm(f => ({...f, labor_rate: e.target.value}))} />
              </div>
              {mkt && parseFloat(form.labor_rate) !== mkt.laborRate && (
                <p className="text-[10px] text-gold mt-1">Market avg: ${mkt.laborRate}/hr</p>
              )}
            </div>
            <div>
              <label className={lbl}>Parts Markup (%)</label>
              <div className="relative">
                <input className={`${inp} pr-6`} type="number" step="1" min="0" max="100"
                  value={form.parts_markup || ''} onChange={e => setForm(f => ({...f, parts_markup: e.target.value}))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-faint text-sm">%</span>
              </div>
              {mkt && parseInt(form.parts_markup) !== Math.round(mkt.partsMarkup*100) && (
                <p className="text-[10px] text-gold mt-1">Market avg: {(mkt.partsMarkup*100).toFixed(0)}%</p>
              )}
            </div>
            <div>
              <label className={lbl}>Tax Rate (%)</label>
              <div className="relative">
                <input className={`${inp} pr-6`} type="number" step="0.01" min="0" max="20"
                  value={form.tax_rate || ''} onChange={e => setForm(f => ({...f, tax_rate: e.target.value}))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-faint text-sm">%</span>
              </div>
              {mkt && parseFloat(form.tax_rate) !== parseFloat((mkt.taxRate*100).toFixed(2)) && (
                <p className="text-[10px] text-gold mt-1">State avg: {(mkt.taxRate*100).toFixed(2)}%</p>
              )}
            </div>
          </div>

          {/* Monthly Revenue Target */}
          <div>
            <label className={lbl}>Monthly Revenue Target ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm">$</span>
              <input className={`${inp} pl-6`} type="number" step="1000" min="0"
                value={form.monthly_revenue_target || ''} onChange={e => setForm(f => ({...f, monthly_revenue_target: e.target.value}))} placeholder="85000" />
            </div>
            <p className="text-[10px] text-faint mt-1">Fallback default for new monthly goal entries.</p>
          </div>

          <div className="bg-void rounded-xl border border-line p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <CalendarDays size={14} className="text-brand" />
                Monthly Goals
              </h3>
              <input
                type="month"
                value={goalMonth}
                onChange={e => setGoalMonth(e.target.value)}
                className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink"
              />
            </div>

            {goalsLoading ? (
              <p className="text-xs text-faint">Loading monthly goals...</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Revenue Goal ($)</label>
                  <input
                    className={inp}
                    type="number"
                    min="0"
                    step="100"
                    value={goalForm.revenue_goal}
                    onChange={e => setGoalForm(f => ({ ...f, revenue_goal: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={lbl}>RO Goal (count)</label>
                  <input
                    className={inp}
                    type="number"
                    min="0"
                    step="1"
                    value={goalForm.ro_goal}
                    onChange={e => setGoalForm(f => ({ ...f, ro_goal: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-faint">
                New months auto-copy your latest saved goals.
              </p>
              <button
                type="button"
                onClick={saveGoals}
                disabled={goalsLoading || goalSaving}
                className="text-xs bg-brand hover:bg-brand-lit text-white font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {goalSaved ? 'Saved!' : goalSaving ? 'Saving...' : 'Save Goals'}
              </button>
            </div>
            {goalError && <p className="text-xs text-crit">{goalError}</p>}
          </div>

          {/* Rate explainer */}
          <div className="bg-void rounded-xl p-3 text-xs text-faint space-y-1 mt-2">
            <p>• <strong className="text-muted">Labor Rate</strong> - applied to all labor hours on repair orders</p>
            <p>• <strong className="text-muted">Parts Markup</strong> - gross margin above your cost on all parts</p>
            <p>• <strong className="text-muted">Tax Rate</strong> - sales tax applied to parts (labor is typically exempt)</p>
          </div>
          </div>
        )}

        {activeSettingsTab === 'operations' && (
          <>
            {/* Time Clock Geofencing */}
            <div className="bg-panel rounded-2xl p-5 border border-line space-y-4">
              <div className="flex items-center gap-2 text-ink font-semibold text-sm mb-1">
                <ShieldCheck size={15} className="text-brand" /> Time Clock Geofencing
              </div>
              <p className="text-xs text-muted">
                Techs can only clock in or out when they are within this distance of the shop.
                Set your shop's location first, then choose the radius.
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={geocodeFromAddress} disabled={geocoding || locating}
                  className="flex items-center gap-2 bg-brand hover:bg-brand-lit text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                  <MapPin size={13}/> {geocoding ? 'Looking up…' : 'Set from Address'}
                </button>
                <button type="button" onClick={detectLocation} disabled={locating || geocoding}
                  className="flex items-center gap-2 bg-brand/10 hover:bg-brand/15 border border-brand/30 text-brand text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                  <MapPin size={13}/> {locating ? 'Detecting GPS…' : 'Use GPS'}
                </button>
                {form.lat && form.lng && (
                  <span className="text-[10px] text-faint font-mono">
                    📍 {parseFloat(form.lat).toFixed(4)}, {parseFloat(form.lng).toFixed(4)}
                  </span>
                )}
              </div>

              {locMsg && (
                <p className={`text-xs flex items-center gap-1 ${locMsg.startsWith('✓') ? 'text-good' : 'text-gold'}`}>
                  {locMsg.startsWith('✓') && <CheckCircle size={12} />}
                  {locMsg.startsWith('✓') ? locMsg.slice(2) : locMsg}
                </p>
              )}

              {!form.lat && (
                <div className="bg-gold/10 border border-gold/30 rounded-lg p-3 text-xs text-gold flex items-center gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0" /> No shop location set - geofencing is disabled. Techs can clock in from anywhere.
                </div>
              )}

              <div>
                <label className={lbl}>Geofence Radius (feet)</label>
                <div className="flex items-center gap-4">
                  <input type="range" min="100" max="2640" step="50"
                    value={form.geofence_radius || 500}
                    onChange={e => setForm(f => ({...f, geofence_radius: +e.target.value}))}
                    className="flex-1 accent-brand" />
                  <span className="text-sm font-bold text-brand min-w-[70px] text-right">
                    {(form.geofence_radius || 500).toLocaleString()} ft
                  </span>
                </div>
                <p className="text-[10px] text-faint mt-1">
                  ≈ {((form.geofence_radius || 500) / 5280).toFixed(2)} miles · Default: 500 ft
                </p>
              </div>
            </div>

            {/* Parts Tracking */}
            <div className="bg-panel rounded-2xl p-5 border border-line space-y-4">
              <div className="flex items-center gap-2 text-ink font-semibold text-sm mb-1">
                <Truck size={15} className="text-brand" /> Parts Tracking (Auto-Sync)
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Add your free <strong className="text-ink">17track API key</strong> to automatically sync UPS, FedEx, USPS, and DHL tracking numbers.
                When a part is delivered, REVV marks it received automatically - and customer tracking links reflect the update instantly.
              </p>
              <div>
                <label className={lbl}>17track API Key</label>
                <input className={inp} type="password" value={form.tracking_api_key || ''} onChange={e => setForm(f => ({...f, tracking_api_key: e.target.value}))} placeholder="Paste your 17track API key here" />
              </div>
              <div className="bg-void rounded-xl p-3 text-xs text-faint space-y-1">
                <p>1. Go to <strong className="text-brand">17track.net</strong> → sign up for free → Developer → API Key</p>
                <p>2. Free tier: 40 trackings/day - plenty for a shop</p>
                <p>3. Supports UPS, FedEx, USPS, DHL, and 2,000+ other carriers</p>
                <p className="text-faint">Without a key: tracking numbers still show as clickable links to the carrier website.</p>
              </div>
            </div>
          </>
        )}

        {activeSettingsTab === 'messaging' && (
          <div className="bg-panel rounded-2xl p-5 border border-line space-y-4">
            {/* SMS Notifications */}
          <div className="bg-void border border-line rounded-xl p-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">SMS Status Notifications</p>
              <p className="text-xs text-muted mt-1">Automatically text customers when their repair status changes (requires Twilio)</p>
            </div>
            <button
              type="button"
              onClick={() => setSmsNotificationsEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${smsNotificationsEnabled ? 'bg-good' : 'bg-raised'}`}
              aria-pressed={smsNotificationsEnabled}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${smsNotificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          <div className="bg-void border border-line rounded-xl p-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Customer Email Status Notifications</p>
              <p className="text-xs text-muted mt-1">Email customers when their RO status changes, only when the customer opts in and has an email on file.</p>
            </div>
            <button
              type="button"
              onClick={() => setEmailNotificationsEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${emailNotificationsEnabled ? 'bg-brand' : 'bg-raised'}`}
              aria-pressed={emailNotificationsEnabled}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${emailNotificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          <div className="bg-void border border-line rounded-xl p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-ink">Owner Activity Digest</p>
              <p className="text-xs text-muted mt-1">Send owners and admins a daily email summary of opened ROs, closed ROs, assignment changes, total losses, and SIU holds.</p>
            </div>
            <label className="flex items-center justify-between gap-3 text-xs text-muted">
              <span>Daily owner digest</span>
              <input
                type="checkbox"
                checked={ownerActivityPrefs.owner_activity_digest_enabled}
                onChange={e => setOwnerActivityPrefs(p => ({ ...p, owner_activity_digest_enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-line bg-void accent-brand"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs text-muted">
              <span>Immediate high-priority alerts</span>
              <input
                type="checkbox"
                checked={ownerActivityPrefs.owner_activity_immediate_alerts_enabled}
                onChange={e => setOwnerActivityPrefs(p => ({ ...p, owner_activity_immediate_alerts_enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-line bg-void accent-brand"
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Digest Time</label>
                <input
                  className={inp}
                  type="time"
                  value={ownerActivityPrefs.owner_activity_digest_time}
                  onChange={e => setOwnerActivityPrefs(p => ({ ...p, owner_activity_digest_time: e.target.value }))}
                />
              </div>
              <div>
                <label className={lbl}>Extra Recipients</label>
                <input
                  className={inp}
                  value={ownerActivityPrefs.owner_activity_digest_recipients}
                  onChange={e => setOwnerActivityPrefs(p => ({ ...p, owner_activity_digest_recipients: e.target.value }))}
                  placeholder="owner@example.com, admin@example.com"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={sendOwnerActivityTestDigest}
                disabled={ownerActivityTestSending}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-60"
              >
                {ownerActivityTestSending ? 'Sending...' : 'Send Test Digest'}
              </button>
              {ownerActivityTestResult && <span className="text-xs text-muted">{ownerActivityTestResult}</span>}
            </div>
          </div>

          {smsLoading ? (
            <div className="flex items-center gap-3 text-muted text-sm">
              <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
              Loading SMS setup status…
            </div>
          ) : smsStatus.configured ? (
            <div className="space-y-4 rounded-instrument border border-good/30 bg-good/10 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-good font-semibold text-sm flex items-center gap-1.5"><CheckCircle size={14} /> SMS Notifications Active</div>
                  <p className="mt-1 text-xs text-good">Customers will receive automatic texts at every repair stage.</p>
                  <p className="text-xs text-good mt-2">Sending from: <span className="font-semibold">{smsStatus.sms_phone || 'Twilio number configured'}</span></p>
                  {smsStatus.auth_method && <p className="text-xs text-good/60 mt-0.5">Auth: {smsStatus.auth_method === 'api_key' ? 'API Key + Secret' : 'Auth Token'} · Source: {smsStatus.config_source || 'unknown'}</p>}
                  {smsStatus.db_has && <p className="text-xs text-faint mt-0.5">DB creds: sid={smsStatus.db_has.account_sid ? '✓' : '✗'} token={smsStatus.db_has.auth_token ? '✓' : '✗'} phone={smsStatus.db_has.phone ? '✓' : '✗'}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowTestSmsModal(true)
                    setTestSmsResult({ type: '', message: '' })
                  }}
                  className="h-[38px] rounded-lg bg-brand px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-lit"
                >
                  Send Test SMS
                </button>
              </div>

              <div className="rounded-lg border border-good/30/30 bg-void overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSmsExamplesOpen(v => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-good hover:bg-good/10"
                >
                  Sample customer messages
                  <ChevronDown size={14} className={`transition-transform ${smsExamplesOpen ? 'rotate-180' : ''}`} />
                </button>
                {smsExamplesOpen && (
                  <div className="px-3 pb-3 text-xs text-muted space-y-2">
                    <p>• <span className="text-good font-medium">Check-in:</span> "Your 2019 Honda Accord has been checked in at {form.name || '[Shop Name]'} and work has started."</p>
                    <p>• <span className="text-good font-medium">Parts update:</span> "Quick update: we're waiting on parts delivery. We'll text you as soon as they arrive."</p>
                    <p>• <span className="text-good font-medium">Ready:</span> "Your vehicle is ready for pickup!"</p>
                    <p>• <span className="text-good font-medium">Post-repair:</span> "Thanks for trusting {form.name || '[Shop Name]'}! Reply if you have any questions."</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-void rounded-xl border border-line p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                  <Smartphone size={15} className="text-brand" /> SMS Customer Notifications
                </div>
                <p className="text-xs text-muted mt-1">Send automatic texts to customers at every repair stage.</p>
              </div>

              <div className="border-y border-line py-4 space-y-4 text-xs text-muted">
                <div>
                  <p className="text-ink font-medium">Step 1 → Create a free Twilio account</p>
                  <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer"
                    className="mt-2 inline-flex rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-lit">
                    Go to twilio.com →
                  </a>
                </div>

                <div>
                  <p className="text-ink font-medium">Step 2 → Get your credentials</p>
                  <p className="mt-1">From your Twilio dashboard, copy:</p>
                  <p>• Account SID (starts with AC...)</p>
                  <p>• Auth Token (click eye icon to reveal)</p>
                </div>

                <div>
                  <p className="text-ink font-medium">Step 3 → Buy a phone number</p>
                  <p className="mt-1">Twilio Console → Phone Numbers → Buy a Number (~$1/mo)</p>
                  <p>Choose a local area code for your shop city.</p>
                </div>

                <div>
                  <p className="text-ink font-medium">Step 4 → Enter credentials below and save to Railway</p>
                  <p className="mt-1">Go to Railway → your REVV project → Variables → add the 3 vars below.</p>
                </div>
              </div>

              <div className="bg-gold/10 border border-gold/30 rounded-lg p-3 text-xs text-gold flex items-start gap-2">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> Enter Twilio values below and click Save Settings to activate SMS.
              </div>
            </div>
          )}

          <div className="bg-void rounded-xl border border-line p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-ink">Twilio Credentials</p>
              <p className="text-xs text-muted mt-1">Leave fields blank to keep existing saved values. Use API Key + Secret (recommended) or Auth Token.</p>
            </div>
            <div>
              <label className={lbl}>Account SID</label>
              <input
                className={inp}
                value={form.twilio_account_sid || ''}
                onChange={e => setForm(f => ({ ...f, twilio_account_sid: e.target.value }))}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>API Key SID <span className="text-brand">(recommended)</span></label>
                <input
                  className={inp}
                  value={form.twilio_api_key || ''}
                  onChange={e => setForm(f => ({ ...f, twilio_api_key: e.target.value }))}
                  placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className={lbl}>API Secret</label>
                <input
                  className={inp}
                  type="password"
                  value={form.twilio_api_secret || ''}
                  onChange={e => setForm(f => ({ ...f, twilio_api_secret: e.target.value }))}
                  placeholder="API Secret"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div>
              <label className={lbl}>Auth Token <span className="text-faint">(or use API Key above)</span></label>
              <input
                className={inp}
                type="password"
                value={form.twilio_auth_token || ''}
                onChange={e => setForm(f => ({ ...f, twilio_auth_token: e.target.value }))}
                placeholder="Twilio Auth Token"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className={lbl}>Twilio Phone Number</label>
              <input
                className={inp}
                value={form.twilio_phone_number || ''}
                onChange={e => setForm(f => ({ ...f, twilio_phone_number: e.target.value }))}
                placeholder="+15551234567"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-faint">Current SMS sender: {smsStatus.sms_phone || 'Not configured'}</p>
              <button
                type="button"
                onClick={refreshSmsStatus}
                className="text-xs bg-raised hover:bg-raised text-ink px-3 py-1.5 rounded-lg"
              >
                Recheck SMS Status
              </button>
            </div>
          </div>
          </div>
        )}

        {activeSettingsTab === 'accounting' && (
          <div className="bg-panel rounded-2xl p-5 border border-line space-y-4">
            {/* Accounting + QuickBooks */}
          <div className="flex items-center gap-2 text-ink font-semibold text-sm mb-1">
            <DollarSign size={15} className="text-brand" /> Accounting (QuickBooks)
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Connect QuickBooks Online, enable auto-sync on closed paid ROs, and run manual sync when needed.
          </p>
          <div className="bg-void rounded-xl border border-line p-4 space-y-3">
            <p className="text-sm font-semibold text-ink">QuickBooks Connection</p>
            <p className="text-xs text-faint">Status: {quickbooksStatus.connected ? 'Connected' : 'Not connected'} · Environment: {quickbooksStatus.environment}</p>
            <p className="text-xs text-faint">Auto-sync: {quickbooksStatus.sync_enabled ? 'Enabled' : 'Disabled'}</p>
            {quickbooksStatus.connected_at && <p className="text-xs text-faint">Connected: {new Date(quickbooksStatus.connected_at).toLocaleString()}</p>}
            {quickbooksStatus.last_sync_at && <p className="text-xs text-faint">Last sync: {new Date(quickbooksStatus.last_sync_at).toLocaleString()}</p>}
            {!quickbooksStatus.configured && (
              <p className="text-[11px] text-gold">
                QuickBooks app is not configured on the server yet (missing QuickBooks env vars).
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {!quickbooksStatus.connected ? (
                <button
                  type="button"
                  onClick={connectQuickBooks}
                  disabled={quickbooksBusy === 'connect' || !quickbooksStatus.configured || !userIsAdmin}
                  className="text-xs bg-brand hover:bg-brand-lit text-white font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                >
                  {quickbooksBusy === 'connect' ? 'Connecting...' : 'Connect QuickBooks'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleQuickBooksSyncEnabled}
                    disabled={quickbooksBusy === 'toggle' || !userIsAdmin}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-60"
                  >
                    {quickbooksBusy === 'toggle'
                      ? 'Saving...'
                      : quickbooksStatus.sync_enabled
                        ? 'Disable Auto-Sync'
                        : 'Enable Auto-Sync'}
                  </button>
                  <button
                    type="button"
                    onClick={disconnectQuickBooks}
                    disabled={quickbooksBusy === 'disconnect' || !userIsAdmin}
                    className="text-xs bg-raised hover:bg-raised text-ink px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    {quickbooksBusy === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={syncQuickBooksBatch}
                disabled={quickbooksBusy === 'sync' || !quickbooksStatus.connected || !userIsAdmin}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-60"
              >
                {quickbooksBusy === 'sync' ? 'Syncing...' : 'Sync Closed Paid ROs'}
              </button>
              <button
                type="button"
                onClick={refreshQuickBooksStatus}
                disabled={!userIsAdmin}
                className="text-xs bg-raised hover:bg-raised text-ink px-3 py-1.5 rounded-lg disabled:opacity-60"
              >
                Refresh
              </button>
            </div>
            {quickbooksMessage && <p className="text-xs text-brand">{quickbooksMessage}</p>}
          </div>
          </div>
        )}

        {activeSettingsTab === 'security' && (
          <div className="bg-panel rounded-2xl p-5 border border-line space-y-4">
            {/* Security */}
          <div className="flex items-center gap-2 text-ink font-semibold text-sm mb-1">
            <LogOut size={15} className="text-brand" /> Security
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Signed in on another device you don't recognize? Revoke all active sessions and force every device to log in again.
          </p>
          <button
            type="button"
            onClick={logoutAllDevices}
            disabled={revokingAll || revokeAllDone}
            className="flex items-center gap-2 bg-brand/10 hover:bg-brand/15 border border-brand/30 text-brand font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60"
          >
            <LogOut size={14} />
            {revokeAllDone ? 'Done — signing you out…' : revokingAll ? 'Revoking…' : 'Log Out All Devices'}
          </button>
          {revokeAllDone && (
            <p className="text-xs text-good flex items-center gap-1">
              <CheckCircle size={12} /> All sessions revoked. Redirecting to login…
            </p>
          )}
          </div>
        )}

        {saveError && (
          <p className='text-xs text-crit flex items-center gap-1'>
            <AlertTriangle size={12} /> {saveError}
          </p>
        )}

      </form>

      {activeSettingsTab === 'danger' && (
        <div className="space-y-3 rounded-instrument border border-crit/30 bg-panel p-5">
          {/* Danger Zone */}
          <div className="flex items-center gap-2 text-crit font-semibold text-sm">
            <Trash2 size={15} /> Danger Zone
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Starting fresh? This clears all sample repair orders, customers, and vehicles -
            so you can begin entering real jobs. <strong className="text-ink">Your shop info, staff accounts, and rate settings are not affected.</strong>
          </p>
          <button onClick={clearDemoData} disabled={clearing}
            className="flex items-center gap-2 rounded-lg border border-crit/30 bg-crit/10 px-4 py-2.5 text-sm font-semibold text-crit transition-colors hover:bg-crit/15 disabled:opacity-50">
            <Trash2 size={14} /> {clearing ? 'Clearing…' : 'Clear All Demo Data'}
          </button>
        </div>
      )}

      {showTestSmsModal && (
        <AppOverlay label="Send test SMS" onClose={() => setShowTestSmsModal(false)} className="bg-black/60 p-4">
          <div className="w-full max-w-md bg-panel border border-line rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Send Test SMS</h3>
              <button
                type="button"
                onClick={() => {
                  setShowTestSmsModal(false)
                  setTestPhone('')
                  setTestSmsResult({ type: '', message: '' })
                }}
                className="text-muted hover:text-ink"
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
              <div className={`rounded-lg p-3 text-sm font-medium ${testSmsResult.type === 'success' ? 'border border-good/30 bg-good/10 text-good' : 'border border-crit/30 bg-crit/10 text-crit'}`}>
                {testSmsResult.message}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTestSmsModal(false)
                  setTestPhone('')
                  setTestSmsResult({ type: '', message: '' })
                }}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendTestSMS}
                disabled={sendingTest}
                className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-lit disabled:opacity-50"
              >
                {sendingTest ? 'Sending…' : 'Send Test SMS'}
              </button>
            </div>
          </div>
        </AppOverlay>
      )}

    </div>
  )
}
