const STATUS_CONFIG = {
  intake: { color: 'bg-slate-700 text-slate-200', icon: '📋', label: 'Intake' },
  estimate: { color: 'bg-blue-900/60 text-blue-300', icon: '📝', label: 'Estimate' },
  approval: { color: 'bg-yellow-900/60 text-yellow-300', icon: '⏳', label: 'Awaiting Approval' },
  parts: { color: 'bg-orange-900/60 text-orange-300', icon: '🔩', label: 'Parts' },
  repair: { color: 'bg-purple-900/60 text-purple-300', icon: '🔧', label: 'In Repair' },
  paint: { color: 'bg-pink-900/60 text-pink-300', icon: '🎨', label: 'Paint' },
  qc: { color: 'bg-cyan-900/60 text-cyan-300', icon: '🔍', label: 'QC' },
  delivery: { color: 'bg-emerald-900/60 text-emerald-300', icon: '🚗', label: 'Delivery' },
  closed: { color: 'bg-green-900/60 text-green-300', icon: '✅', label: 'Closed' },
}

export default function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: 'bg-slate-700 text-slate-300', icon: '❓', label: status || 'Unknown' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}
