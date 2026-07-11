import { AlertTriangle, ClipboardList, FileText, Clock, Package, Wrench, Palette, Search, Car, CheckCircle, HelpCircle } from 'lucide-react'

const STATUS_CONFIG = {
  intake: { color: 'border border-line-2 bg-raised text-muted', icon: ClipboardList, label: 'Intake' },
  estimate: { color: 'border border-brand/35 bg-brand/10 text-brand', icon: FileText, label: 'Estimate' },
  approval: { color: 'border border-brand/35 bg-brand/10 text-brand', icon: Clock, label: 'Awaiting Approval' },
  parts: { color: 'border border-brand/35 bg-brand/10 text-brand', icon: Package, label: 'Parts' },
  repair: { color: 'border border-brand/35 bg-brand/10 text-brand', icon: Wrench, label: 'In Repair' },
  paint: { color: 'border border-brand/35 bg-brand/10 text-brand', icon: Palette, label: 'Paint' },
  qc: { color: 'border border-brand/35 bg-brand/10 text-brand', icon: Search, label: 'QC' },
  delivery: { color: 'border border-brand/35 bg-brand/10 text-brand', icon: Car, label: 'Delivery' },
  closed: { color: 'border border-good/35 bg-good/10 text-good', icon: CheckCircle, label: 'Closed' },
  total_loss: { color: 'border border-crit/40 bg-crit/10 text-crit', icon: AlertTriangle, label: 'Total Loss' },
  closed_total_loss: { color: 'border border-crit/40 bg-crit/10 text-crit', icon: AlertTriangle, label: 'Total Loss Closed' },
  siu_hold: { color: 'border border-crit/40 bg-crit/10 text-crit', icon: HelpCircle, label: 'SIU Hold' },
}

export function displayStatusKey(status, claimStatus) {
  const normalizedStatus = String(status || '').trim().toLowerCase()
  const normalizedClaim = String(claimStatus || '').trim().toLowerCase()
  if (normalizedStatus === 'closed' && normalizedClaim === 'total_loss') return 'closed_total_loss'
  return normalizedStatus
}

export default function StatusBadge({ status, claimStatus }) {
  const key = displayStatusKey(status, claimStatus)
  const cfg = STATUS_CONFIG[key] || { color: 'border border-line-2 bg-raised text-muted', icon: HelpCircle, label: status || 'Unknown' }
  const IconComponent = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
      <IconComponent size={12} />
      {cfg.label}
    </span>
  )
}
