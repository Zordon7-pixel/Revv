import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ClipboardPlus, Users, ArrowRight, CheckCircle2 } from 'lucide-react'
import api from '../lib/api'

const TOTAL_STEPS = 3

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
        <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
        <input
          value={form[name]}
          onChange={e => setForm(prev => ({ ...prev, [name]: e.target.value }))}
          required
          placeholder={placeholder}
          className="w-full bg-[#121620] border border-[#2c3345] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#EAB308] transition-colors"
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#171c27] rounded-2xl border border-[#2c3345] p-6 md:p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold text-[#EAB308] uppercase tracking-widest">REVV Onboarding</p>
          <h1 className="text-2xl text-white font-bold mt-1">Step {step} of {TOTAL_STEPS}</h1>
          <div className="w-full h-2 bg-[#232a3b] rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-[#EAB308] transition-all" style={{ width: progress }} />
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={saveStepOne} className="space-y-4">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Building2 size={18} className="text-[#EAB308]" />
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

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 bg-[#EAB308] hover:bg-[#facc15] text-black font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-60"
            >
              {loading ? 'Saving...' : 'Continue'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-white font-semibold">
              <ClipboardPlus size={18} className="text-[#EAB308]" />
              Create Your First RO
            </div>
            <p className="text-sm text-slate-300">
              Repair orders are the heart of REVV. Add a customer vehicle to get started.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/dashboard')}
                className="bg-[#EAB308] hover:bg-[#facc15] text-black font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Create First RO
              </button>
              <button
                onClick={() => setStep(3)}
                className="bg-[#232a3b] hover:bg-[#2c3345] text-slate-200 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Users size={18} className="text-[#EAB308]" />
              Invite Your Team
            </div>
            <p className="text-sm text-slate-300">
              Add employees so they can clock in and manage repairs.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/users')}
                className="bg-[#EAB308] hover:bg-[#facc15] text-black font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Go to Users
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                className="bg-[#232a3b] hover:bg-[#2c3345] text-slate-200 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Skip for now
              </button>
            </div>
            <div className="pt-2">
              <button
                onClick={() => navigate('/dashboard')}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#EAB308] hover:text-[#facc15] transition-colors"
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
