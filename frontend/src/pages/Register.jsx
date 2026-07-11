import { Link } from 'react-router-dom'
import { Mail, MessageSquare } from 'lucide-react'
import { Logo } from '../components/ui'

export default function Register() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-4">
      <div className="w-full max-w-md space-y-5 rounded-instrument border border-line-2 bg-panel p-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-instrument border border-line-2 bg-white">
            <Logo variant="mark" className="h-10 w-10 object-contain" />
          </div>
          <h1 className="font-display text-2xl font-bold text-ink">Customer Accounts Removed</h1>
          <p className="mt-2 text-sm text-muted">
            Vehicle tracking and payment now happen through secure links sent by the shop.
          </p>
        </div>

        <div className="space-y-3 rounded-instrument border border-line-2 bg-void p-4 text-sm text-ink">
          <p className="flex items-center gap-2"><MessageSquare size={14} className="text-brand" /> Check your text messages for a tracking/payment link.</p>
          <p className="flex items-center gap-2"><Mail size={14} className="text-brand" /> Check your email for invoice and status updates.</p>
        </div>

        <div className="text-center">
          <Link to="/login" className="text-sm text-brand transition-colors hover:text-brand-lit">
            Team member? Sign in here →
          </Link>
        </div>
      </div>
    </div>
  )
}
