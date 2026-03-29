import { useEffect, useMemo, useState } from 'react'

const EXTERIOR_PANELS = [
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
  { id: 'left_front_rim', label: 'LF Rim', type: 'circle', cx: 46, cy: 152, r: 8, family: 'rim' },
  { id: 'right_front_rim', label: 'RF Rim', type: 'circle', cx: 274, cy: 152, r: 8, family: 'rim' },
  { id: 'left_rear_rim', label: 'LR Rim', type: 'circle', cx: 46, cy: 320, r: 8, family: 'rim' },
  { id: 'right_rear_rim', label: 'RR Rim', type: 'circle', cx: 274, cy: 320, r: 8, family: 'rim' },
]

const INTERIOR_PANELS = [
  { id: 'interior_dashboard', label: 'Dashboard', type: 'path', d: 'M94,64 L226,64 L238,106 L82,106 Z', family: 'interior' },
  { id: 'interior_steering_column', label: 'Steering Column', type: 'circle', cx: 126, cy: 124, r: 22, family: 'interior' },
  { id: 'interior_ignition_switch', label: 'Ignition Switch', type: 'circle', cx: 156, cy: 124, r: 10, family: 'interior' },
  { id: 'interior_driver_door_trim', label: 'Driver Door Trim', type: 'rect', x: 68, y: 126, width: 24, height: 214, rx: 12, family: 'interior' },
  { id: 'interior_passenger_door_trim', label: 'Passenger Door Trim', type: 'rect', x: 228, y: 126, width: 24, height: 214, rx: 12, family: 'interior' },
  { id: 'interior_headliner', label: 'Headliner / Upper Cabin', type: 'path', d: 'M108,112 L212,112 L220,360 L100,360 Z', family: 'interior' },
  { id: 'interior_center_console', label: 'Center Console', type: 'path', d: 'M146,164 L174,164 L182,316 L138,316 Z', family: 'interior' },
  { id: 'interior_front_left_seat', label: 'Front Left Seat', type: 'path', d: 'M110,172 L140,172 L146,250 L104,250 Z', family: 'interior' },
  { id: 'interior_front_right_seat', label: 'Front Right Seat', type: 'path', d: 'M180,172 L210,172 L216,250 L174,250 Z', family: 'interior' },
  { id: 'interior_rear_seats', label: 'Rear Seats', type: 'path', d: 'M108,270 L212,270 L220,344 L100,344 Z', family: 'interior' },
]

const INTERIOR_PANEL_IDS = new Set(INTERIOR_PANELS.map((panel) => panel.id))

const COLORS = {
  body: '#1e2235',
  undercarriage: '#182034',
  tire: '#0b1220',
  rim: '#334155',
  interior: '#1f2937',
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
  const [mode, setMode] = useState(() => (
    selected.some((id) => INTERIOR_PANEL_IDS.has(id)) ? 'interior' : 'exterior'
  ))
  const allPanels = useMemo(() => [...EXTERIOR_PANELS, ...INTERIOR_PANELS], [])
  const panelMap = useMemo(() => Object.fromEntries(allPanels.map((panel) => [panel.id, panel])), [allPanels])
  const activePanels = mode === 'interior' ? INTERIOR_PANELS : EXTERIOR_PANELS
  const selectedExteriorCount = selected.filter((id) => !INTERIOR_PANEL_IDS.has(id)).length
  const selectedInteriorCount = selected.filter((id) => INTERIOR_PANEL_IDS.has(id)).length

  useEffect(() => {
    if (selectedInteriorCount > 0 && mode !== 'interior') {
      setMode('interior')
    }
  }, [mode, selectedInteriorCount])

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
    if (panel.family === 'interior') return COLORS.interior
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
    if (panel.type === 'rect') {
      return <rect {...shapeProps} x={panel.x} y={panel.y} width={panel.width} height={panel.height} rx={panel.rx || 0} />
    }
    return <path {...shapeProps} d={panel.d} />
  }

  function renderExteriorCanvas() {
    return (
      <>
        <defs>
          <linearGradient id="vehicle-shell-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#171b2d" />
            <stop offset="100%" stopColor="#0f1322" />
          </linearGradient>
        </defs>
        <ellipse cx="160" cy="230" rx="120" ry="220" fill="url(#vehicle-shell-gradient)" stroke="#2f365a" strokeWidth="1.25" />
        <path d="M96,52 L224,52 L236,228 L224,406 L96,406 L84,228 Z" fill="#0f1426" opacity="0.36" />
        {activePanels.map((panel) => renderPanel(panel))}
        <text x="160" y="14" textAnchor="middle" fontSize="9" fill="#64748b">FRONT</text>
        <text x="160" y="456" textAnchor="middle" fontSize="9" fill="#64748b">REAR</text>
        <text x="10" y="230" textAnchor="middle" fontSize="9" fill="#64748b" transform="rotate(-90,10,230)">LEFT</text>
        <text x="310" y="230" textAnchor="middle" fontSize="9" fill="#64748b" transform="rotate(90,310,230)">RIGHT</text>
      </>
    )
  }

  function renderInteriorCanvas() {
    return (
      <>
        <defs>
          <linearGradient id="interior-shell-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a1f31" />
            <stop offset="100%" stopColor="#101628" />
          </linearGradient>
        </defs>
        <rect x="76" y="38" width="168" height="384" rx="64" fill="url(#interior-shell-gradient)" stroke="#2f365a" strokeWidth="1.25" />
        <rect x="96" y="58" width="128" height="344" rx="42" fill="#0f1426" opacity="0.4" />
        {activePanels.map((panel) => renderPanel(panel))}
        <text x="160" y="18" textAnchor="middle" fontSize="9" fill="#64748b">DASH / FRONT</text>
        <text x="160" y="452" textAnchor="middle" fontSize="9" fill="#64748b">REAR CABIN</text>
      </>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {!readOnly && (
        <div className="inline-flex items-center rounded-lg border border-[#2a2d3e] bg-[#0f1117] p-1">
          <button
            type="button"
            onClick={() => setMode('exterior')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${mode === 'exterior' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Exterior ({selectedExteriorCount})
          </button>
          <button
            type="button"
            onClick={() => setMode('interior')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${mode === 'interior' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Interior ({selectedInteriorCount})
          </button>
        </div>
      )}

      <div className="relative">
        <svg viewBox="0 0 320 460" width="240" height="345" style={{ display: 'block' }}>
          {mode === 'interior' ? renderInteriorCanvas() : renderExteriorCanvas()}
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
          {mode === 'interior'
            ? `Mark interior damage for steering column, ignition switch, dash, console, and seats • ${selected.length} zone${selected.length !== 1 ? 's' : ''} selected`
            : `Mark exterior damage, including undercarriage, tires, and rims • ${selected.length} zone${selected.length !== 1 ? 's' : ''} selected`}
        </p>
      )}
    </div>
  )
}
