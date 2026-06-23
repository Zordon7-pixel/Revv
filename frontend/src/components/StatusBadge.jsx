import { AlertTriangle, ClipboardList, FileText, Clock, Package, Wrench, Palette, Search, Car, CheckCircle, HelpCircle } from 'lucide-react'

const STATUS_CONFIG = {
  intake: { color: 'bg-slate-700 text-slate-200', icon: ClipboardList, label: 'Intake' },
  estimate: { color: 'bg-blue-900/60 text-blue-300', icon: FileText, label: 'Estimate' },
  approval: { color: 'bg-yellow-900/60 text-yellow-300', icon: Clock, label: 'Awaiting Approval' },
  parts: { color: 'bg-orange-900/60 text-orange-300', icon: Package, label: 'Parts' },
  repair: { color: 'bg-purple-900/60 text-purple-300', icon: Wrench, label: 'In Repair' },
  paint: { color: 'bg-pink-900/60 text-pink-300', icon: Palette, label: 'Paint' },
  qc: { color: 'bg-cyan-900/60 text-cyan-300', icon: Search, label: 'QC' },
  delivery: { color: 'bg-emerald-900/60 text-emerald-300', icon: Car, label: 'Delivery' },
  closed: { color: 'bg-green-900/60 text-green-300', icon: CheckCircle, label: 'Closed' },
  total_loss: { color: 'bg-red-950/70 text-red-300 border border-red-700/50', icon: AlertTriangle, label: 'Total Loss' },
  closed_total_loss: { color: 'bg-red-950/70 text-red-300 border border-red-700/50', icon: AlertTriangle, label: 'Total Loss Closed' },
  siu_hold: { color: 'bg-violet-950/70 text-violet-300 border border-violet-700/50', icon: HelpCircle, label: 'SIU Hold' },
}

export function displayStatusKey(status, claimStatus) {
  const normalizedStatus = String(status || '').trim().toLowerCase()
  const normalizedClaim = String(claimStatus || '').trim().toLowerCase()
  if (normalizedStatus === 'closed' && normalizedClaim === 'total_loss') return 'closed_total_loss'
  return normalizedStatus
}

export default function StatusBadge({ status, claimStatus }) {
  const key = displayStatusKey(status, claimStatus)
  const cfg = STATUS_CONFIG[key] || { color: 'bg-slate-700 text-slate-300', icon: HelpCircle, label: status || 'Unknown' }
  const IconComponent = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
      <IconComponent size={12} />
      {cfg.label}
    </span>
  )
}
