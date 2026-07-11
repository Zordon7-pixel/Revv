import { useState } from 'react'
import {
  CarFront,
  Workflow,
  CreditCard,
  Link2,
  ShieldCheck,
  MessageSquare,
  Camera,
  Users,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react'
import AppOverlay from './AppOverlay'

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
      <ul className="space-y-2 text-sm text-muted">
        <li>Click <span className="font-medium text-brand">+ New RO</span> (top right).</li>
        <li>Fill in customer name, phone, vehicle info, and VIN.</li>
        <li>Mark damaged panels on the diagram.</li>
        <li>Set payment type: Insurance or Cash.</li>
        <li>If Insurance: enter insurer, claim #, and adjuster info.</li>
        <li>Hit <span className="font-medium text-brand">Create RO</span>.</li>
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
              <span className="rounded-md border border-line-2 bg-void px-2 py-1 text-ink">
                {step.name}
              </span>
              {idx < PIPELINE_STEPS.length - 1 && <span className="text-brand">→</span>}
            </div>
          ))}
        </div>
        <div className="space-y-2 text-sm">
          {PIPELINE_STEPS.map((step) => (
            <div key={step.name} className="text-muted">
              <span className="font-medium text-ink">{step.name}:</span> {step.desc}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Insurance jobs may be marked <span className="font-medium text-crit">Total Loss</span> when repair is not approved.
        </p>
      </div>
    )
  },
  {
    id: 'collect-payment',
    title: 'Collecting Payment',
    icon: CreditCard,
    content: (
      <ul className="space-y-2 text-sm text-muted">
        <li>Open RO → Payment section → <span className="font-medium text-gold">Collect Payment</span>.</li>
        <li>Enter card info in the secure Stripe form.</li>
        <li>The RO is marked paid automatically after success.</li>
      </ul>
    )
  },
  {
    id: 'customer-portal',
    title: 'Customer Links',
    icon: Link2,
    content: (
      <ul className="space-y-2 text-sm text-muted">
        <li>Customers do not create REVV accounts.</li>
        <li>Open RO → send tracking link and payment link directly by SMS/email.</li>
        <li>After RO is closed and paid, invoice email sends automatically when customer email is on file.</li>
      </ul>
    )
  },
  {
    id: 'texting-customers',
    title: 'Texting Customers (SMS)',
    icon: MessageSquare,
    content: (
      <ul className="space-y-2 text-sm text-muted">
        <li><span className="font-medium text-brand">One-time setup:</span> add Twilio credentials in Shop Settings before SMS can send.</li>
        <li>Create the RO with the customer phone number filled in.</li>
        <li>Open the RO and scroll to the SMS / Messages section; the customer phone auto-fills.</li>
        <li>Type your message and hit <span className="font-medium text-brand">Send</span>. The full text thread lives on the RO.</li>
        <li>Status texts auto-send on every RO status change (In Progress, Ready, Delivered).</li>
        <li>Customers consent in person at intake; if they reply <span className="font-medium text-crit">STOP</span> they are auto-opted out.</li>
      </ul>
    )
  },
  {
    id: 'insurance-claims',
    title: 'Insurance Claims',
    icon: ShieldCheck,
    content: (
      <ul className="space-y-2 text-sm text-muted">
        <li>Claim Status card appears at the bottom of RO for insurance jobs only.</li>
        <li>Set status: <span className="text-ink">Approved for Work</span>, <span className="text-ink">Total Loss</span>, or <span className="text-ink">SIU Hold</span>.</li>
        <li>Total Loss skips repair steps and waits for release/closeout.</li>
      </ul>
    )
  },
  {
    id: 'photos-inspections',
    title: 'Photos & Inspections',
    icon: Camera,
    content: (
      <ul className="space-y-2 text-sm text-muted">
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
      <div className="overflow-hidden rounded-instrument border border-line-2">
        <table className="w-full text-sm">
          <thead className="bg-void text-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Role</th>
              <th className="text-left px-3 py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line-2">
              <td className="px-3 py-2 text-ink">Owner</td>
              <td className="px-3 py-2 text-muted">Full access</td>
            </tr>
            <tr className="border-t border-line-2">
              <td className="px-3 py-2 text-ink">Admin</td>
              <td className="px-3 py-2 text-muted">Full access except billing</td>
            </tr>
            <tr className="border-t border-line-2">
              <td className="px-3 py-2 text-ink">Technician</td>
              <td className="px-3 py-2 text-muted">Own ROs only</td>
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
      <ul className="space-y-2 text-sm text-muted">
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

  function toggleSection(id) {
    setOpenSections((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  if (!isOpen) return null

  return (
    <AppOverlay label="Quick start help" onClose={onClose} className="bg-black/60 p-0">
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-line-2 bg-void shadow-2xl"
      >
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between border-b border-line-2 bg-panel px-5 py-4">
            <div>
              <h2 className="font-semibold text-ink">Quick Start / Cheat Sheet</h2>
              <p className="mt-1 text-xs text-muted">REVV workflow and shortcuts</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-md border border-line-2 bg-void text-muted transition-colors hover:border-brand hover:text-ink"
              aria-label="Close help panel"
            >
              <X size={16} className="mx-auto" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {sections.map(({ id, title, icon: Icon, content }) => {
              const isSectionOpen = openSections.includes(id)
              return (
                <section key={id} className="overflow-hidden rounded-instrument border border-line-2 bg-panel">
                  <button
                    type="button"
                    onClick={() => toggleSection(id)}
                    aria-expanded={isSectionOpen}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon size={16} className="flex-shrink-0 text-brand" />
                      <span className="text-sm font-medium text-ink">{title}</span>
                    </div>
                    {isSectionOpen ? (
                      <ChevronUp size={16} className="text-muted" />
                    ) : (
                      <ChevronDown size={16} className="text-muted" />
                    )}
                  </button>
                  {isSectionOpen && <div className="border-t border-line-2 px-4 pb-4 pt-3">{content}</div>}
                </section>
              )
            })}
          </div>
        </div>
      </aside>
    </AppOverlay>
  )
}
