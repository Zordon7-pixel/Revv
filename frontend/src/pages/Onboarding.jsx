import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ClipboardPlus, Users, ArrowRight, CheckCircle2, FileText } from 'lucide-react'
import api from '../lib/api'
import EstimateImportWizard from '../components/EstimateImportWizard'

const TOTAL_STEPS = 3

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showImportWizard, setShowImportWizard] = useState(false)
  const [form, setForm] = useState({
    shop_name: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
  })

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => {
      setForm(prev => ({
        ...prev,
        shop_name: data?.shop?.name || prev.shop_name,
        phone: data?.shop?.phone || '',
        address: data?.shop?.address || '',
        city: data?.shop?.city || '',
        state: data?.shop?.state || '',
        zip: data?.shop?.zip || '',
      }))
    }).catch(() => {})
  }, [])

  const progress = useMemo(() => `${Math.round((step / TOTAL_STEPS) * 100)}%`, [step])

  async function saveStepOne(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.put('/auth/onboarding', form)
      setStep(2)
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not save shop details.')
    } finally {
      setLoading(false)
    }
  }

  function input(name, label, placeholder) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
        <input
          value={form[name]}
          onChange={e => setForm(prev => ({ ...prev, [name]: e.target.value }))}
          required
          placeholder={placeholder}
          className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-4">
      <div className="w-full max-w-2xl rounded-instrument border border-line-2 bg-panel p-6 md:p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">REVV Onboarding</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">Step {step} of {TOTAL_STEPS}</h1>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-brand transition-all" style={{ width: progress }} />
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={saveStepOne} className="space-y-4">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <Building2 size={18} className="text-brand" />
              Shop Details
            </div>
            {input('shop_name', 'Shop Name', 'REVV Auto Body')}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {input('phone', 'Phone', '(555) 555-5555')}
              {input('zip', 'Zip', '90210')}
            </div>
            {input('address', 'Address', '123 Main Street')}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {input('city', 'City', 'Los Angeles')}
              {input('state', 'State', 'CA')}
            </div>

            {error && <p className="text-xs text-crit" role="alert">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-60"
            >
              {loading ? 'Saving...' : 'Continue'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <ClipboardPlus size={18} className="text-brand" />
              Create Your First RO
            </div>
            <p className="text-sm text-muted">
              Repair orders are the heart of REVV. Add a customer vehicle to get started.
            </p>
            <button
              type="button"
              onClick={() => setShowImportWizard(true)}
              className="flex w-full items-center justify-between gap-4 rounded-lg border border-line-2 bg-void p-4 text-left transition-colors hover:border-brand/70"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <FileText size={20} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">Import your existing estimate</span>
                  <span className="mt-0.5 block text-xs text-muted">Upload a CCC or Mitchell PDF/image and create a pre-filled RO.</span>
                </span>
              </span>
              <ArrowRight size={18} className="text-faint" />
            </button>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/dashboard')}
                className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-[var(--on-gold)] transition-colors hover:bg-gold-lit"
              >
                Create First RO
              </button>
              <button
                onClick={() => setStep(3)}
                className="rounded-lg border border-line-2 bg-raised px-4 py-2.5 text-sm text-ink transition-colors hover:border-brand/40"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {showImportWizard && (
          <EstimateImportWizard
            onClose={() => setShowImportWizard(false)}
            onImported={(ro) => {
              setShowImportWizard(false)
              if (ro?.id) navigate(`/ros/${ro.id}`)
              else navigate('/ros')
            }}
          />
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <Users size={18} className="text-brand" />
              Invite Your Team
            </div>
            <p className="text-sm text-muted">
              Add techs so they can clock in and manage repairs.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/users')}
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit"
              >
                Go to Users
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                className="rounded-lg border border-line-2 bg-raised px-4 py-2.5 text-sm text-ink transition-colors hover:border-brand/40"
              >
                Skip for now
              </button>
            </div>
            <div className="pt-2">
              <button
                onClick={() => navigate('/dashboard')}
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand transition-colors hover:text-brand-lit"
              >
                <CheckCircle2 size={16} />
                Enter REVV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
