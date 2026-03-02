import { useEffect, useState } from 'react'
import {
  CarFront,
  Workflow,
  CreditCard,
  Link2,
  ShieldCheck,
  Camera,
  Users,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react'

const PIPELINE_STEPS = [
  { name: 'Intake', desc: 'Capture customer, vehicle, and initial damage details.' },
  { name: 'Estimate', desc: 'Build labor, parts, and materials estimate.' },
  { name: 'Approval', desc: 'Await customer or insurer authorization to proceed.' },
  { name: 'Parts', desc: 'Order and receive required parts for the repair.' },
  { name: 'Repair', desc: 'Complete structural and body repairs.' },
  { name: 'Paint', desc: 'Refinish and blend repaired panels.' },
  { name: 'QC', desc: 'Run quality checks and final inspection.' },
  { name: 'Delivery', desc: 'Review work with customer and release vehicle.' },
  { name: 'Closed', desc: 'Finalize paperwork and mark the RO complete.' }
]

const sections = [
  {
    id: 'creating-ro',
    title: 'Creating a Repair Order',
    icon: CarFront,
    content: (
      <ul className="space-y-2 text-sm text-slate-300">
        <li>Click <span className="text-indigo-400 font-medium">+ New RO</span> (top right).</li>
        <li>Fill in customer name, phone, vehicle info, and VIN.</li>
        <li>Mark damaged panels on the diagram.</li>
        <li>Set payment type: Insurance or Cash.</li>
        <li>If Insurance: enter insurer, claim #, and adjuster info.</li>
        <li>Hit <span className="text-indigo-400 font-medium">Create RO</span>.</li>
      </ul>
    )
  },
  {
    id: 'status-pipeline',
    title: 'RO Status Pipeline',
    icon: Workflow,
    content: (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {PIPELINE_STEPS.map((step, idx) => (
            <div key={step.name} className="flex items-center gap-2">
              <span className="px-2 py-1 rounded-md bg-[#0f1117] border border-[#2a2d3e] text-slate-200">
                {step.name}
              </span>
              {idx < PIPELINE_STEPS.length - 1 && <span className="text-indigo-400">→</span>}
            </div>
          ))}
        </div>
        <div className="space-y-2 text-sm">
          {PIPELINE_STEPS.map((step) => (
            <div key={step.name} className="text-slate-300">
              <span className="text-slate-100 font-medium">{step.name}:</span> {step.desc}
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-300">
          Insurance jobs may be marked <span className="text-indigo-400 font-medium">Total Loss</span> when repair is not approved.
        </p>
      </div>
    )
  },
  {
    id: 'collect-payment',
    title: 'Collecting Payment',
    icon: CreditCard,
    content: (
      <ul className="space-y-2 text-sm text-slate-300">
        <li>Open RO → Payment section → <span className="text-indigo-400 font-medium">Collect Payment</span>.</li>
        <li>Enter card info in the secure Stripe form.</li>
        <li>The RO is marked paid automatically after success.</li>
      </ul>
    )
  },
  {
    id: 'customer-portal',
    title: 'Customer Portal',
    icon: Link2,
    content: (
      <ul className="space-y-2 text-sm text-slate-300">
        <li>Each RO has a shareable tracking link.</li>
        <li>Customers can track status, approve estimates, and view invoices.</li>
        <li>Open RO → <span className="text-indigo-400 font-medium">Share Portal Link</span> → copy and text to customer.</li>
      </ul>
    )
  },
  {
    id: 'insurance-claims',
    title: 'Insurance Claims',
    icon: ShieldCheck,
    content: (
      <ul className="space-y-2 text-sm text-slate-300">
        <li>Claim Status card appears at the bottom of RO for insurance jobs only.</li>
        <li>Set status: <span className="text-slate-100">Approved for Work</span>, <span className="text-slate-100">Total Loss</span>, or <span className="text-slate-100">SIU Hold</span>.</li>
        <li>Total Loss skips repair steps and waits for release/closeout.</li>
      </ul>
    )
  },
  {
    id: 'photos-inspections',
    title: 'Photos & Inspections',
    icon: Camera,
    content: (
      <ul className="space-y-2 text-sm text-slate-300">
        <li>Open RO → Photos tab → upload damage photos.</li>
        <li>Use the Inspection tab for digital vehicle inspection (DVI).</li>
      </ul>
    )
  },
  {
    id: 'users-roles',
    title: 'Users & Roles',
    icon: Users,
    content: (
      <div className="overflow-hidden rounded-lg border border-[#2a2d3e]">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1117] text-slate-300">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Role</th>
              <th className="text-left px-3 py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-[#2a2d3e]">
              <td className="px-3 py-2 text-slate-100">Owner</td>
              <td className="px-3 py-2 text-slate-300">Full access</td>
            </tr>
            <tr className="border-t border-[#2a2d3e]">
              <td className="px-3 py-2 text-slate-100">Admin</td>
              <td className="px-3 py-2 text-slate-300">Full access except billing</td>
            </tr>
            <tr className="border-t border-[#2a2d3e]">
              <td className="px-3 py-2 text-slate-100">Technician</td>
              <td className="px-3 py-2 text-slate-300">Own ROs only</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  },
  {
    id: 'pro-tips',
    title: 'Pro Tips',
    icon: Lightbulb,
    content: (
      <ul className="space-y-2 text-sm text-slate-300">
        <li>Duplicate warning appears when a similar open RO already exists.</li>
        <li>SMS updates auto-send on every RO status change.</li>
        <li>Always mark the damage diagram during intake for insurance documentation.</li>
        <li>Delete any RO via the trash icon on the RO list.</li>
      </ul>
    )
  }
]

export default function HelpPanel({ isOpen, onClose }) {
  const [openSections, setOpenSections] = useState(['creating-ro'])

  useEffect(() => {
    function onEsc(e) {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      window.addEventListener('keydown', onEsc)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      window.removeEventListener('keydown', onEsc)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  function toggleSection(id) {
    setOpenSections((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-200 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!isOpen}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-xl bg-[#0f1117] border-l border-[#2a2d3e] shadow-2xl transition-transform duration-200 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3e] bg-[#1a1d2e]">
            <div>
              <h2 className="text-white font-semibold">Quick Start / Cheat Sheet</h2>
              <p className="text-xs text-slate-400 mt-1">REVV workflow and shortcuts</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-md border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors"
              aria-label="Close help panel"
            >
              <X size={16} className="mx-auto" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {sections.map(({ id, title, icon: Icon, content }) => {
              const isSectionOpen = openSections.includes(id)
              return (
                <section key={id} className="rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] overflow-hidden">
                  <button
                    onClick={() => toggleSection(id)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#202439] transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon size={16} className="text-indigo-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-100">{title}</span>
                    </div>
                    {isSectionOpen ? (
                      <ChevronUp size={16} className="text-slate-400" />
                    ) : (
                      <ChevronDown size={16} className="text-slate-400" />
                    )}
                  </button>
                  {isSectionOpen && <div className="px-4 pb-4 border-t border-[#2a2d3e] pt-3">{content}</div>}
                </section>
              )
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}
