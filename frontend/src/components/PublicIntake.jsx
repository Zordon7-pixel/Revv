import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Logo, Panel } from './ui'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'

export function IntakeIdentity({ shop }) {
  return <div className="flex min-w-0 items-center gap-3">
    {shop.logo_url ? <img src={resolveUploadedMediaUrl(shop.logo_url)} alt={`${shop.name} logo`} className="h-10 w-10 shrink-0 object-contain" /> : <Logo variant="mark" className="h-10 w-10 shrink-0" />}
    <p className="min-w-0 break-words font-display text-lg font-semibold text-ink">{shop.name}</p>
  </div>
}

function ResolvedIntake({ shopLink, children }) {
  const [state, setState] = useState({ status: shopLink ? 'loading' : 'missing', shop: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!shopLink) return
    const controller = new AbortController()
    let active = true
    setState({ status: 'loading', shop: null })
    async function resolve() {
      try {
        const response = await fetch(`/api/public/intake/${encodeURIComponent(shopLink)}`, { signal: controller.signal })
        if (response.status === 404 || response.status === 400) {
          if (active) setState({ status: 'missing', shop: null })
          return
        }
        if (!response.ok) throw new Error('Shop lookup failed')
        const shop = await response.json()
        if (typeof shop?.name !== 'string' || !shop.name.trim()) throw new Error('Invalid shop identity')
        if (active) setState({ status: 'ready', shop })
      } catch {
        if (active) setState({ status: 'error', shop: null })
      }
    }
    resolve()
    return () => { active = false; controller.abort() }
  }, [shopLink, attempt])

  if (state.status === 'ready') return children(state.shop, shopLink, () => setState({ status: 'missing', shop: null }))
  return <main className="min-h-screen bg-void px-4 py-10 text-ink">
    <Panel className="mx-auto w-full max-w-lg space-y-4 p-6 text-center">
      <h1 className="font-display text-2xl font-semibold">{state.status === 'loading' ? 'Loading shop…' : state.status === 'missing' ? 'Shop link required' : 'Unable to verify shop'}</h1>
      <p role={state.status === 'loading' ? 'status' : 'alert'} className="text-sm text-muted">
        {state.status === 'loading' ? 'Checking your shop-specific link.' : state.status === 'missing' ? 'Ask your shop for a current shop-specific estimate or booking link.' : 'We could not check this shop link. Please try again before entering your details.'}
      </p>
      {state.status === 'error' && <button type="button" className="rounded-instrument bg-brand px-4 py-2 text-white" onClick={() => { setState({ status: 'loading', shop: null }); setAttempt(value => value + 1) }}>Try again</button>}
    </Panel>
  </main>
}

export default function PublicIntake({ children }) {
  const [params] = useSearchParams()
  const shopLink = params.get('shop') || ''
  // A query change synchronously unmounts the old identity AND its form state.
  // Late metadata/submission responses can never enable the new shop's form.
  return <ResolvedIntake key={shopLink} shopLink={shopLink}>{children}</ResolvedIntake>
}
