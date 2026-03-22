import { Link } from 'react-router-dom'
import { Wrench, Mail, MessageSquare } from 'lucide-react'

export default function Register() {
  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1a1d2e] rounded-2xl p-6 border border-[#2a2d3e] space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Wrench size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Customer Accounts Removed</h1>
          <p className="text-sm text-slate-400 mt-2">
            Vehicle tracking and payment now happen through secure links sent by the shop.
          </p>
        </div>

        <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-4 text-sm text-slate-300 space-y-3">
          <p className="flex items-center gap-2"><MessageSquare size={14} className="text-indigo-400" /> Check your text messages for a tracking/payment link.</p>
          <p className="flex items-center gap-2"><Mail size={14} className="text-indigo-400" /> Check your email for invoice and status updates.</p>
        </div>

        <div className="text-center">
          <Link to="/login" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
            Team member? Sign in here →
          </Link>
        </div>
      </div>
    </div>
  )
}
