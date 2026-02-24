import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Store, UserRound, Mail, Lock, Wrench } from 'lucide-react'
import api from '../lib/api'

export default function ShopRegister() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/shop-register', {
        name,
        email,
        password,
        shop_name: shopName,
      })
      localStorage.setItem('sc_token', data.token)
      navigate('/onboarding')
    } catch (e) {
      setError(e?.response?.data?.error || 'Unable to create account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputWrap = 'relative'
  const inputIcon = 'absolute left-3 top-1/2 -translate-y-1/2 text-[#EAB308]'
  const inputClass = 'w-full bg-[#121620] border border-[#2c3345] rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#EAB308] transition-colors'

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <div className="w-16 h-16 bg-[#EAB308] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-yellow-900/40">
            <Wrench size={28} className="text-black" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-wide">REVV</h1>
          <p className="text-xs font-semibold text-[#EAB308] uppercase tracking-widest mt-2">Shop Owner Sign Up</p>
        </div>

        <form onSubmit={submit} className="bg-[#171c27] rounded-2xl border border-[#2c3345] p-6 space-y-4">
          <div className={inputWrap}>
            <UserRound size={16} className={inputIcon} />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="Your Name"
              className={inputClass}
            />
          </div>

          <div className={inputWrap}>
            <Mail size={16} className={inputIcon} />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="Email"
              className={inputClass}
            />
          </div>

          <div className={inputWrap}>
            <Lock size={16} className={inputIcon} />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Password"
              className={inputClass}
            />
          </div>

          <div className={inputWrap}>
            <Store size={16} className={inputIcon} />
            <input
              type="text"
              value={shopName}
              onChange={e => setShopName(e.target.value)}
              required
              placeholder="Shop Name"
              className={inputClass}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#EAB308] hover:bg-[#facc15] text-black font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-60"
          >
            {loading ? 'Creating account...' : 'Create Shop Account'}
          </button>
        </form>

        <div className="mt-5 text-center">
          <Link to="/login" className="text-xs text-slate-400 hover:text-[#EAB308] transition-colors">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
