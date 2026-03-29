import { useMemo, useState } from 'react'

const PANELS = [
  { id: 'front_bumper', label: 'Front Bumper', type: 'path', d: 'M102,24 L218,24 L228,50 L92,50 Z', family: 'body' },
  { id: 'hood', label: 'Hood', type: 'path', d: 'M98,56 L222,56 L215,134 L105,134 Z', family: 'body' },
  { id: 'windshield', label: 'Windshield', type: 'path', d: 'M108,140 L212,140 L206,173 L114,173 Z', family: 'body' },
  { id: 'roof', label: 'Roof', type: 'path', d: 'M114,178 L206,178 L206,284 L114,284 Z', family: 'body' },
  { id: 'rear_glass', label: 'Rear Glass', type: 'path', d: 'M114,289 L206,289 L212,322 L108,322 Z', family: 'body' },
  { id: 'trunk', label: 'Trunk', type: 'path', d: 'M104,326 L216,326 L222,402 L98,402 Z', family: 'body' },
  { id: 'rear_bumper', label: 'Rear Bumper', type: 'path', d: 'M92,408 L228,408 L218,434 L102,434 Z', family: 'body' },
  { id: 'left_front_fender', label: 'LF Fender', type: 'path', d: 'M69,58 L97,58 L97,134 L66,128 L58,86 Z', family: 'body' },
  { id: 'left_front_door', label: 'LF Door', type: 'path', d: 'M62,138 L106,138 L106,226 L60,224 Z', family: 'body' },
  { id: 'left_rear_door', label: 'LR Door', type: 'path', d: 'M60,230 L106,230 L106,314 L62,312 Z', family: 'body' },
  { id: 'left_rear_quarter', label: 'LR Quarter', type: 'path', d: 'M66,318 L98,318 L98,401 L62,392 L56,346 Z', family: 'body' },
  { id: 'right_front_fender', label: 'RF Fender', type: 'path', d: 'M223,58 L251,58 L262,86 L254,128 L223,134 Z', family: 'body' },
  { id: 'right_front_door', label: 'RF Door', type: 'path', d: 'M214,138 L260,138 L262,224 L216,226 Z', family: 'body' },
  { id: 'right_rear_door', label: 'RR Door', type: 'path', d: 'M214,230 L260,230 L258,312 L214,314 Z', family: 'body' },
  { id: 'right_rear_quarter', label: 'RR Quarter', type: 'path', d: 'M222,318 L254,318 L260,346 L254,392 L222,401 Z', family: 'body' },
  { id: 'undercarriage', label: 'Undercarriage', type: 'path', d: 'M116,236 L204,236 L212,364 L108,364 Z', family: 'undercarriage' },
  { id: 'left_front_tire', label: 'LF Tire', type: 'ellipse', cx: 46, cy: 152, rx: 16, ry: 34, family: 'tire' },
  { id: 'right_front_tire', label: 'RF Tire', type: 'ellipse', cx: 274, cy: 152, rx: 16, ry: 34, family: 'tire' },
  { id: 'left_rear_tire', label: 'LR Tire', type: 'ellipse', cx: 46, cy: 320, rx: 16, ry: 34, family: 'tire' },
  { id: 'right_rear_tire', label: 'RR Tire', type: 'ellipse', cx: 274, cy: 320, rx: 16, ry: 34, family: 'tire' },
  { id: 'left_front_rim', label: 'LF Rim', type: 'circle', cx: 46, cy: 152, r: 10, family: 'rim' },
  { id: 'right_front_rim', label: 'RF Rim', type: 'circle', cx: 274, cy: 152, r: 10, family: 'rim' },
  { id: 'left_rear_rim', label: 'LR Rim', type: 'circle', cx: 46, cy: 320, r: 10, family: 'rim' },
  { id: 'right_rear_rim', label: 'RR Rim', type: 'circle', cx: 274, cy: 320, r: 10, family: 'rim' },
]

const COLORS = {
  body: '#1e2235',
  undercarriage: '#182034',
  tire: '#0b1220',
  rim: '#334155',
  hover: '#2d3258',
  selected: '#ef4444',
  stroke: '#3a3f6e',
  tireStroke: '#475569',
  selectedStroke: '#ff6b6b',
}

function fallbackLabel(id) {
  return String(id || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function VehicleDiagram({ value = [], onChange, readOnly = false }) {
  const [hovered, setHovered] = useState(null)
  const selected = Array.isArray(value) ? value : []
  const panelMap = useMemo(() => Object.fromEntries(PANELS.map((panel) => [panel.id, panel])), [])

  function toggle(id) {
    if (readOnly) return
    const next = selected.includes(id)
      ? selected.filter((panelId) => panelId !== id)
      : [...selected, id]
    onChange(next)
  }

  function getPanelFill(panel, isSelected, isHovered) {
    if (isSelected) return COLORS.selected
    if (isHovered) return COLORS.hover
    if (panel.family === 'undercarriage') return COLORS.undercarriage
    if (panel.family === 'tire') return COLORS.tire
    if (panel.family === 'rim') return COLORS.rim
    return COLORS.body
  }

  function getPanelStroke(panel, isSelected) {
    if (isSelected) return COLORS.selectedStroke
    if (panel.family === 'tire') return COLORS.tireStroke
    return COLORS.stroke
  }

  function renderPanel(panel) {
    const isSelected = selected.includes(panel.id)
    const isHovered = hovered === panel.id
    const shapeProps = {
      key: panel.id,
      fill: getPanelFill(panel, isSelected, isHovered),
      stroke: getPanelStroke(panel, isSelected),
      strokeWidth: isSelected ? 2 : 1,
      opacity: 0.95,
      style: { cursor: readOnly ? 'default' : 'pointer', transition: 'fill 0.15s ease' },
      onClick: () => toggle(panel.id),
      onMouseEnter: () => setHovered(panel.id),
      onMouseLeave: () => setHovered(null),
    }

    if (panel.type === 'ellipse') {
      return <ellipse {...shapeProps} cx={panel.cx} cy={panel.cy} rx={panel.rx} ry={panel.ry} />
    }
    if (panel.type === 'circle') {
      return <circle {...shapeProps} cx={panel.cx} cy={panel.cy} r={panel.r} />
    }
    return <path {...shapeProps} d={panel.d} />
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <svg viewBox="0 0 320 460" width="240" height="345" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="vehicle-shell-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#171b2d" />
              <stop offset="100%" stopColor="#0f1322" />
            </linearGradient>
          </defs>

          <ellipse cx="160" cy="230" rx="120" ry="220" fill="url(#vehicle-shell-gradient)" stroke="#2f365a" strokeWidth="1.25" />
          <path d="M96,52 L224,52 L236,228 L224,406 L96,406 L84,228 Z" fill="#0f1426" opacity="0.36" />

          {PANELS.map((panel) => renderPanel(panel))}

          <text x="160" y="14" textAnchor="middle" fontSize="9" fill="#64748b">FRONT</text>
          <text x="160" y="456" textAnchor="middle" fontSize="9" fill="#64748b">REAR</text>
          <text x="10" y="230" textAnchor="middle" fontSize="9" fill="#64748b" transform="rotate(-90,10,230)">LEFT</text>
          <text x="310" y="230" textAnchor="middle" fontSize="9" fill="#64748b" transform="rotate(90,310,230)">RIGHT</text>
        </svg>

        {hovered && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-[#0f1117] border border-[#2a2d3e] text-white text-xs px-2 py-1 rounded-lg pointer-events-none whitespace-nowrap z-10">
            {panelMap[hovered]?.label || fallbackLabel(hovered)}
            {selected.includes(hovered) ? ' — click to remove' : ' — click to mark damaged'}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center max-w-xs">
          {selected.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 bg-red-900/40 border border-red-700/50 text-red-300 text-xs px-2 py-0.5 rounded-full"
            >
              {panelMap[id]?.label || fallbackLabel(id)}
              {!readOnly && (
                <button
                  onClick={() => toggle(id)}
                  className="text-red-400 hover:text-red-200 ml-0.5 leading-none"
                >
                  x
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <p className="text-xs text-slate-500 text-center">
          Click panels to mark damage, including undercarriage, tires, and rims • {selected.length} zone{selected.length !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  )
}
