import { useState } from 'react'

const PANELS = [
  { id: 'front_bumper',        label: 'Front Bumper',      d: 'M90,20 L210,20 L220,50 L80,50 Z' },
  { id: 'hood',                label: 'Hood',              d: 'M85,55 L215,55 L210,130 L90,130 Z' },
  { id: 'windshield',          label: 'Windshield',        d: 'M92,135 L208,135 L202,165 L98,165 Z' },
  { id: 'roof',                label: 'Roof',              d: 'M98,170 L202,170 L202,280 L98,280 Z' },
  { id: 'rear_glass',          label: 'Rear Glass',        d: 'M98,285 L202,285 L208,315 L92,315 Z' },
  { id: 'trunk',               label: 'Trunk',             d: 'M90,320 L210,320 L215,395 L85,395 Z' },
  { id: 'rear_bumper',         label: 'Rear Bumper',       d: 'M80,400 L220,400 L210,430 L90,430 Z' },
  // Left side
  { id: 'left_front_fender',   label: 'LF Fender',         d: 'M58,55 L83,55 L83,130 L55,130 L50,80 Z' },
  { id: 'left_front_door',     label: 'LF Door',           d: 'M50,135 L90,135 L90,220 L50,220 Z' },
  { id: 'left_rear_door',      label: 'LR Door',           d: 'M50,225 L90,225 L90,310 L50,310 Z' },
  { id: 'left_rear_quarter',   label: 'LR Quarter',        d: 'M55,315 L83,315 L83,395 L50,370 L48,330 Z' },
  // Right side
  { id: 'right_front_fender',  label: 'RF Fender',         d: 'M217,55 L242,55 L250,80 L245,130 L217,130 Z' },
  { id: 'right_front_door',    label: 'RF Door',           d: 'M210,135 L250,135 L250,220 L210,220 Z' },
  { id: 'right_rear_door',     label: 'RR Door',           d: 'M210,225 L250,225 L250,310 L210,310 Z' },
  { id: 'right_rear_quarter',  label: 'RR Quarter',        d: 'M217,315 L245,315 L252,330 L250,370 L217,395 Z' },
]

const COLORS = {
  default:  '#1e2235',
  hover:    '#2d3258',
  selected: '#ef4444',
  stroke:   '#3a3f6e',
  selectedStroke: '#ff6b6b',
}

export default function VehicleDiagram({ value = [], onChange, readOnly = false }) {
  const [hovered, setHovered] = useState(null)

  const selected = Array.isArray(value) ? value : []

  function toggle(id) {
    if (readOnly) return
    const next = selected.includes(id)
      ? selected.filter(p => p !== id)
      : [...selected, id]
    onChange(next)
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Diagram */}
      <div className="relative">
        <svg
          viewBox="0 0 300 450"
          width="220"
          height="330"
          style={{ display: 'block' }}
        >
          {/* Car body outline */}
          <ellipse cx="150" cy="225" rx="108" ry="215" fill="#141728" stroke="#3a3f6e" strokeWidth="1" />

          {/* Panels */}
          {PANELS.map(panel => {
            const isSelected = selected.includes(panel.id)
            const isHovered = hovered === panel.id
            return (
              <path
                key={panel.id}
                d={panel.d}
                fill={isSelected ? COLORS.selected : isHovered ? COLORS.hover : COLORS.default}
                stroke={isSelected ? COLORS.selectedStroke : COLORS.stroke}
                strokeWidth={isSelected ? 2 : 1}
                opacity={0.92}
                style={{ cursor: readOnly ? 'default' : 'pointer', transition: 'fill 0.15s' }}
                onClick={() => toggle(panel.id)}
                onMouseEnter={() => setHovered(panel.id)}
                onMouseLeave={() => setHovered(null)}
              />
            )
          })}

          {/* Direction labels */}
          <text x="150" y="12" textAnchor="middle" fontSize="9" fill="#64748b">FRONT</text>
          <text x="150" y="446" textAnchor="middle" fontSize="9" fill="#64748b">REAR</text>
          <text x="8" y="228" textAnchor="middle" fontSize="9" fill="#64748b" transform="rotate(-90,8,228)">LEFT</text>
          <text x="292" y="228" textAnchor="middle" fontSize="9" fill="#64748b" transform="rotate(90,292,228)">RIGHT</text>
        </svg>

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-[#0f1117] border border-[#2a2d3e] text-white text-xs px-2 py-1 rounded-lg pointer-events-none whitespace-nowrap z-10">
            {PANELS.find(p => p.id === hovered)?.label}
            {selected.includes(hovered) ? ' — click to remove' : ' — click to mark damaged'}
          </div>
        )}
      </div>

      {/* Selected panels list */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center max-w-xs">
          {selected.map(id => {
            const panel = PANELS.find(p => p.id === id)
            return (
              <span
                key={id}
                className="flex items-center gap-1 bg-red-900/40 border border-red-700/50 text-red-300 text-xs px-2 py-0.5 rounded-full"
              >
                {panel?.label}
                {!readOnly && (
                  <button
                    onClick={() => toggle(id)}
                    className="text-red-400 hover:text-red-200 ml-0.5 leading-none"
                  >×</button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {!readOnly && (
        <p className="text-xs text-slate-500 text-center">
          Click panels to mark damage • {selected.length} panel{selected.length !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  )
}
