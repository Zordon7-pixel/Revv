import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Save, X, Package, PackageCheck, PackageX, Plus, CheckCircle, AlertCircle, Clock, Truck, RefreshCw, ExternalLink, Car, DollarSign, ClipboardList, Smartphone, AlertTriangle, Copy, Printer, User, Phone, MessageSquare, Mail, Users, CreditCard } from 'lucide-react'
import api from '../lib/api'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'
import StatusBadge from '../components/StatusBadge'
import PaymentStatusBadge, { normalizePaymentStatus } from '../components/PaymentStatusBadge'
import LibraryAutocomplete from '../components/LibraryAutocomplete'
import ROPhotos from '../components/ROPhotos'
import PaymentModal from '../components/PaymentModal'
import { searchInsurers } from '../data/insurers'
import { searchVendors } from '../data/vendors'
import { isAdmin, isEmployee } from '../lib/auth'
import { useLanguage } from '../contexts/LanguageContext'
import VehicleDiagram from '../components/VehicleDiagram'
import ClaimStatusCard from '../components/ClaimStatusCard'

const PART_STATUS_META = {
  ordered:     { label: 'Ordered',     cls: 'text-blue-400   bg-blue-900/30   border-blue-700',   icon: Clock },
  backordered: { label: 'Backordered', cls: 'text-red-400    bg-red-900/30    border-red-700',    icon: AlertCircle },
  received:    { label: 'Received',    cls: 'text-emerald-400 bg-emerald-900/30 border-emerald-700', icon: CheckCircle },
  cancelled:   { label: 'Cancelled',  cls: 'text-slate-500  bg-slate-900/30  border-slate-700',  icon: X },
}

const TRACKING_META = {
  pending:          { label: 'Tracking Pending',    cls: 'text-slate-400',  dot: '#64748b' },
  in_transit:       { label: 'In Transit',          cls: 'text-blue-400',   dot: '#3b82f6' },
  out_for_delivery: { label: 'Out for Delivery',    cls: 'text-amber-400',  dot: '#f59e0b' },
  delivered:        { label: 'Delivered to Shop',   cls: 'text-emerald-400',dot: '#10b981' },
  exception:        { label: 'Shipping Exception',  cls: 'text-red-400',    dot: '#ef4444' },
  expired:          { label: 'Tracking Expired',    cls: 'text-slate-500',  dot: '#64748b' },
}
const CARRIER_LABELS = { ups:'UPS', fedex:'FedEx', usps:'USPS', dhl:'DHL', unknown:'Carrier' }

const REQ_STATUS_META = {
  pending:   { label: 'Pending',   cls: 'text-amber-400 bg-amber-900/30 border-amber-700/40',   Icon: Package },
  ordered:   { label: 'Ordered',   cls: 'text-blue-400 bg-blue-900/30 border-blue-700/40',       Icon: PackageCheck },
  received:  { label: 'Received',  cls: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40', Icon: PackageCheck },
  cancelled: { label: 'Cancelled', cls: 'text-slate-500 bg-slate-900/30 border-slate-700/40',   Icon: PackageX },
}

const COMM_TYPE_META = {
  call: { label: 'Call', Icon: Phone },
  text: { label: 'Text', Icon: MessageSquare },
  email: { label: 'Email', Icon: Mail },
  'in-person': { label: 'In Person', Icon: Users },
}

const STAGES = ['intake','estimate','approval','parts','repair','paint','qc','delivery','closed']

export default function RODetail() {
  const { t } = useLanguage()
  const { id } = useParams()
  const navigate = useNavigate()
  const [ro, setRo] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const [parts, setParts]     = useState([])
  const [showAddPart, setShowAddPart] = useState(false)
  const [partForm, setPartForm] = useState({ part_name:'', part_number:'', vendor:'', quantity:1, unit_cost:'', expected_date:'', notes:'', tracking_number:'' })
  const [savingPart, setSavingPart] = useState(false)
  const [refreshingPart, setRefreshingPart] = useState(null)  // partId being refreshed

  const [portalCreds, setPortalCreds]         = useState(null)
  const [generatingAccess, setGeneratingAccess] = useState(false)
  const [claimLink, setClaimLink] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [trackingLink, setTrackingLink] = useState('')

  const [shopUsers, setShopUsers] = useState([])
  const [techNotes, setTechNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [partsRequests, setPartsRequests] = useState([])
  const [showPartsReqForm, setShowPartsReqForm] = useState(false)
  const [partsReqForm, setPartsReqForm] = useState({ part_name: '', part_number: '', quantity: 1, notes: '' })
  const [submittingPartsReq, setSubmittingPartsReq] = useState(false)
  const [approvingEstimate, setApprovingEstimate] = useState(false)
  const [sendingForApproval, setSendingForApproval] = useState(false)
  const [approvalLink, setApprovalLink] = useState('')
  const [showMarkPaidModal, setShowMarkPaidModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [markingPaid, setMarkingPaid] = useState(false)
  const [comms, setComms] = useState([])
  const [showCommForm, setShowCommForm] = useState(false)
  const [commForm, setCommForm] = useState({ type: 'call', notes: '' })
  const [savingComm, setSavingComm] = useState(false)

  const userIsAdmin = isAdmin()
  const userIsEmployee = isEmployee()

  const load = () => api.get(`/ros/${id}`).then(r => { setRo(r.data); setForm(r.data); setParts(r.data.parts || []); setTechNotes(r.data.tech_notes || '') })
  const loadPartsRequests = () => api.get(`/parts-requests/${id}`).then(r => setPartsRequests(r.data.requests || [])).catch(() => {})
  const loadComms = () => api.get(`/ros/${id}/comms`).then(r => setComms(r.data.comms || [])).catch(() => setComms([]))

  useEffect(() => { load() }, [id])
  useEffect(() => {
    api.get(`/claim-links/ro/${id}`).then(r => setClaimLink(r.data)).catch(() => {})
  }, [id])
  useEffect(() => {
    api.get('/users').then(r => setShopUsers(r.data.users || [])).catch(() => {})
  }, [])
  useEffect(() => { loadPartsRequests() }, [id])
  useEffect(() => { loadComms() }, [id])

  async function addPart(e) {
    e.preventDefault(); setSavingPart(true)
    try {
      await api.post(`/parts/ro/${id}`, partForm)
      load()
      setShowAddPart(false)
      setPartForm({ part_name:'', part_number:'', vendor:'', quantity:1, unit_cost:'', expected_date:'', notes:'', tracking_number:'' })
    } finally { setSavingPart(false) }
  }

  async function refreshTracking(partId) {
    setRefreshingPart(partId)
    try {
      const { data } = await api.post(`/tracking/check/${partId}`)
      if (data.manual && data.tracking_url) {
        window.open(data.tracking_url, '_blank')
      } else {
        load()
      }
    } catch (e) {
      alert(e?.response?.data?.error || 'Could not refresh tracking')
    } finally {
      setRefreshingPart(null)
    }
  }

  async function updatePartStatus(partId, status) {
    await api.put(`/parts/${partId}`, { status }); load()
  }

  async function deletePart(partId) {
    await api.delete(`/parts/${partId}`); load()
  }

  async function generatePortalAccess() {
    setGeneratingAccess(true)
    try {
      const { data } = await api.post('/users/portal-access', { customer_id: ro.customer?.id })
      setPortalCreds(data)
      load() // refresh has_portal_access flag
    } catch(e) {
      alert(e?.response?.data?.error || 'Could not generate access')
    } finally { setGeneratingAccess(false) }
  }

  async function generateClaimLink() {
    setGeneratingLink(true)
    try {
      const r = await api.post(`/claim-links/${id}`)
      setClaimLink({ token: r.data.token })
      const url = `${window.location.origin}/claim/${r.data.token}`
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 3000)
    } catch (e) {
      alert('Error generating link')
    } finally {
      setGeneratingLink(false)
    }
  }

  async function copyClaimLink() {
    const url = `${window.location.origin}/claim/${claimLink.token}`
    await navigator.clipboard.writeText(url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 3000)
  }

  async function generateTrackingLink() {
    setGeneratingLink(true)
    try {
      const { data } = await api.post(`/portal/magic-link/${id}`)
      setTrackingLink(data.trackingUrl)
      await navigator.clipboard.writeText(data.trackingUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 3000)
    } catch (e) {
      alert(e?.response?.data?.error || 'Could not generate tracking link')
    } finally {
      setGeneratingLink(false)
    }
  }

  async function advance() {
    const idx = STAGES.indexOf(ro.status)
    if (idx < STAGES.length - 1) {
      await api.put(`/ros/${id}/status`, { status: STAGES[idx+1] })
      load()
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.put(`/ros/${id}`, {
        parts_cost: +form.parts_cost || 0,
        labor_cost: +form.labor_cost || 0,
        sublet_cost: +form.sublet_cost || 0,
        deductible_waived: +form.deductible_waived || 0,
        referral_fee: +form.referral_fee || 0,
        goodwill_repair_cost: +form.goodwill_repair_cost || 0,
        deductible: +form.deductible || 0,
        claim_number: form.claim_number,
        insurer: form.insurer,
        adjuster_name: form.adjuster_name,
        adjuster_phone: form.adjuster_phone,
        estimated_delivery: form.estimated_delivery,
        notes: form.notes,
      })
      setEditing(false)
      load()
    } finally { setSaving(false) }
  }

  async function assignTech(userId) {
    await api.patch(`/ros/${id}/assign`, { user_id: userId || null })
    load()
  }

  async function saveTechNotes() {
    setSavingNotes(true)
    try {
      await api.patch(`/ros/${id}`, { tech_notes: techNotes })
    } finally {
      setSavingNotes(false)
    }
  }

  async function submitPartsRequest(e) {
    e.preventDefault()
    setSubmittingPartsReq(true)
    try {
      await api.post('/parts-requests', { ro_id: id, ...partsReqForm })
      loadPartsRequests()
      setShowPartsReqForm(false)
      setPartsReqForm({ part_name: '', part_number: '', quantity: 1, notes: '' })
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not submit request')
    } finally {
      setSubmittingPartsReq(false)
    }
  }

  async function updatePartsReqStatus(reqId, status) {
    await api.patch(`/parts-requests/${reqId}`, { status })
    loadPartsRequests()
  }

  async function approveEstimate() {
    setApprovingEstimate(true)
    try {
      await api.post(`/ros/${id}/approve-estimate`)
      load()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not approve estimate')
    } finally {
      setApprovingEstimate(false)
    }
  }

  async function sendForApproval() {
    setSendingForApproval(true)
    try {
      const { data } = await api.post(`/ros/${id}/approval-link`)
      const url = data.link || `${window.location.origin}/approve/${data.token}`
      setApprovalLink(url)
      await navigator.clipboard.writeText(url)
      alert('Approval link copied to clipboard.')
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not generate approval link')
    } finally {
      setSendingForApproval(false)
    }
  }

  async function submitComm(e) {
    e.preventDefault()
    if (!commForm.notes.trim()) return
    setSavingComm(true)
    try {
      await api.post(`/ros/${id}/comms`, commForm)
      setCommForm({ type: 'call', notes: '' })
      setShowCommForm(false)
      loadComms()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not log communication')
    } finally {
      setSavingComm(false)
    }
  }

  async function markPaid() {
    setMarkingPaid(true)
    try {
      await api.post(`/ros/${id}/mark-paid`, { payment_method: paymentMethod })
      load()
      setShowMarkPaidModal(false)
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not mark as paid')
    } finally {
      setMarkingPaid(false)
    }
  }

  if (!ro) return <div className="flex items-center justify-center h-64 text-slate-500">{t('common.loading')}</div>

  const p = ro.profit || {}
  const currentIdx = STAGES.indexOf(ro.status)
  const paymentStatus = normalizePaymentStatus(ro.payment_status, ro.payment_received)
  const paymentAmount = Number(ro.total || ro.parts_cost || 0)
  const daysIn = ro.intake_date ? Math.floor((Date.now() - new Date(ro.intake_date)) / 86400000) : 0
  const daysColor = daysIn > 14 ? 'text-red-400' : daysIn > 7 ? 'text-yellow-400' : 'text-emerald-400'
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate('/ros')} className="text-slate-400 hover:text-white transition-colors"><ArrowLeft size={20} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">{ro.ro_number}</h1>
          <p className="text-slate-500 text-sm truncate">{ro.vehicle?.year} {ro.vehicle?.make} {ro.vehicle?.model} · {ro.customer?.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold ${daysColor}`}>{daysIn}d in shop</span>
          <StatusBadge status={ro.status} />
          <PaymentStatusBadge status={paymentStatus} paymentReceived={ro.payment_received} />
          {ro.payment_received === 1 && (
            <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium bg-emerald-900/30 border border-emerald-700/40 px-3 py-1.5 rounded-lg">
              <CheckCircle size={12} /> Paid {ro.payment_received_at && `· ${new Date(ro.payment_received_at).toLocaleDateString()}`}
            </span>
          )}
          {ro.status === 'estimate_sent' && !ro.estimate_approved_at && (
            <button onClick={approveEstimate} disabled={approvingEstimate} className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              <CheckCircle size={12} /> {approvingEstimate ? 'Approving...' : `${t('portal.approveBtn')} ${t('ro.estimate')}`}
            </button>
          )}
          {ro.status === 'estimate' && (
            <button
              onClick={sendForApproval}
              disabled={sendingForApproval}
              className="flex items-center gap-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <Mail size={12} /> {sendingForApproval ? 'Generating Link...' : 'Send for Approval'}
            </button>
          )}
          {ro.status !== 'closed' && !ro.payment_received && (
            <button onClick={() => setShowMarkPaidModal(true)} className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
              <DollarSign size={12} /> {t('ro.paymentReceived')}
            </button>
          )}
          {paymentStatus !== 'succeeded' && paymentAmount > 0 && (
            <button
              onClick={() => setShowPaymentModal(true)}
              className="flex items-center gap-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <CreditCard size={12} /> Collect Payment
            </button>
          )}
          {currentIdx < STAGES.length - 1 && (
            <button onClick={advance} className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
              → {STATUS_LABELS[STAGES[currentIdx+1]]}
            </button>
          )}
          <button onClick={() => window.open(`/invoice/${id}`, '_blank')}
            className="flex items-center gap-1 bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
            <Printer size={12} /> {t('ro.invoice')}
          </button>
          {!editing
            ? <button onClick={() => setEditing(true)} className="flex items-center gap-1 bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <Pencil size={12} /> {t('common.edit')}
              </button>
            : <div className="flex gap-1">
                <button onClick={save} disabled={saving} className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                  <Save size={12} /> {saving ? 'Saving...' : t('common.save')}
                </button>
                <button onClick={() => { setEditing(false); setForm(ro) }} className="flex items-center gap-1 bg-[#2a2d3e] text-slate-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                  <X size={12} />
                </button>
              </div>
          }
        </div>
      </div>

      {approvalLink && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3 text-xs text-yellow-200">
          Approval link ready: <span className="font-mono break-all">{approvalLink}</span>
        </div>
      )}

      {/* Progress */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex gap-1 mb-2">
          {STAGES.slice(0,-1).map((s, i) => (
            <div key={s} className="flex-1 h-2 rounded-full" style={{background: i <= currentIdx ? STATUS_COLORS[s] : '#2a2d3e'}} />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-slate-600">
          <span>Intake</span><span>Delivery</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Vehicle Info */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5"><Car size={12} /> {t('common.vehicle')}</h2>
          <div className="space-y-2">
            {[
              [`${t('common.year')}/${t('common.make')}/${t('common.model')}`, `${ro.vehicle?.year} ${ro.vehicle?.make} ${ro.vehicle?.model}`],
              ['Color', ro.vehicle?.color],
              [t('common.vin'), ro.vehicle?.vin],
              ['Plate', ro.vehicle?.plate],
              ['Job Type', ro.job_type],
              ['Intake Date', ro.intake_date],
            ].map(([k,v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-slate-500">{k}</span>
                <span className="text-white font-medium capitalize">{v || '—'}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('portal.estimatedCompletion')}</span>
              {editing
                ? <input type="date" value={form.estimated_delivery || ''} onChange={e => set('estimated_delivery', e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
                : <span className="text-white font-medium">{ro.estimated_delivery || '—'}</span>
              }
            </div>
          </div>
        </div>

        {/* Insurance */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">
            {ro.payment_type === 'cash' ? 'Cash Job' : 'Insurance Claim'}
          </h2>
          {ro.payment_type === 'insurance' ? (
            <div className="space-y-2">
              {editing ? (
                <>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Insurer</label>
                    <LibraryAutocomplete
                      value={form.insurer || ''}
                      onChange={v => set('insurer', v)}
                      onSelect={ins => {
                        set('insurer', ins.name)
                        if (!form.adjuster_phone && ins.claims_phone) set('adjuster_phone', ins.claims_phone)
                      }}
                      searchFn={searchInsurers}
                      placeholder="State Farm, GEICO, Progressive..."
                      renderItem={ins => (
                        <div>
                          <div className="text-xs text-white font-medium">{ins.name}</div>
                          {ins.claims_phone && <div className="text-[10px] text-indigo-400">{ins.claims_phone}</div>}
                        </div>
                      )}
                    />
                  </div>
                  <div><label className="text-[10px] text-slate-500">Claim #</label><input className={inp + ' mt-1'} value={form.claim_number || ''} onChange={e => set('claim_number', e.target.value)} /></div>
                  <div><label className="text-[10px] text-slate-500">Adjuster Name</label><input className={inp + ' mt-1'} value={form.adjuster_name || ''} onChange={e => set('adjuster_name', e.target.value)} /></div>
                  <div><label className="text-[10px] text-slate-500">Adjuster Phone</label><input className={inp + ' mt-1'} value={form.adjuster_phone || ''} onChange={e => set('adjuster_phone', e.target.value)} /></div>
                  <div><label className="text-[10px] text-slate-500">Deductible ($)</label><input type="number" className={inp + ' mt-1'} value={form.deductible || ''} onChange={e => set('deductible', e.target.value)} /></div>
                </>
              ) : (
                [['Insurer', ro.insurer], ['Claim #', ro.claim_number], ['Adjuster', ro.adjuster_name], ['Phone', ro.adjuster_phone], ['Deductible', ro.deductible ? `$${ro.deductible}` : '—']].map(([k,v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-white font-medium">{v || '—'}</span>
                  </div>
                ))
              )}
            </div>
          ) : <div className="text-xs text-slate-400">Customer pay — no claim.</div>}
        </div>

        {/* Damage Diagram */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4 col-span-full">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4 flex items-center gap-1.5">
            <Car size={12} /> Damage Diagram
          </h2>
          <VehicleDiagram
            value={(() => { try { return JSON.parse(ro.damaged_panels || '[]') } catch { return [] } })()}
            onChange={async (panels) => {
              try { await api.patch(`/ros/${ro.id}`, { damaged_panels: JSON.stringify(panels) }) } catch {}
            }}
            readOnly={!isAdmin() && !isEmployee()}
          />
        </div>

        {/* Claim Status — insurance jobs only */}
        {ro.payment_type === 'insurance' && (
          <ClaimStatusCard ro={ro} onUpdate={setRo} isAdmin={isAdmin()} />
        )}

        {/* Insurance Adjustor Panel */}
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-white text-sm flex items-center gap-2">
            Insurance Adjustor
          </h3>
          {!claimLink ? (
            <div>
              <p className="text-xs text-slate-500 mb-3">Generate a secure link to share with the insurance adjustor. They can view the RO details and submit their assessment without creating an account.</p>
              <button onClick={generateClaimLink} disabled={generatingLink} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                {generatingLink ? 'Generating...' : 'Generate Adjustor Link'}
              </button>
            </div>
          ) : claimLink.submitted_at ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-400 text-xs font-medium"><CheckCircle size={14} /> Assessment Received</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-slate-500">Adjustor</span><p className="text-white">{claimLink.adjustor_name} — {claimLink.adjustor_company}</p></div>
                <div><span className="text-slate-500">Submitted</span><p className="text-white">{new Date(claimLink.submitted_at).toLocaleDateString()}</p></div>
                <div><span className="text-slate-500">Approved Labor</span><p className="text-white">${(claimLink.approved_labor||0).toLocaleString()}</p></div>
                <div><span className="text-slate-500">Approved Parts</span><p className="text-white">${(claimLink.approved_parts||0).toLocaleString()}</p></div>
                {claimLink.supplement_amount > 0 && <div><span className="text-slate-500">Supplement</span><p className="text-emerald-400 font-medium">${claimLink.supplement_amount.toLocaleString()}</p></div>}
                {claimLink.adjustor_notes && <div className="col-span-2"><span className="text-slate-500">Notes</span><p className="text-white">{claimLink.adjustor_notes}</p></div>}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Link sent — waiting for adjustor assessment.</p>
              <div className="flex gap-2">
                <button onClick={copyClaimLink} className="bg-[#0f1117] border border-[#2a2d3e] text-white text-xs px-3 py-2 rounded-lg hover:border-indigo-500 transition-colors flex items-center gap-1.5">
                  <Copy size={13} />
                  {linkCopied ? 'Copied!' : 'Copy Link'}
                </button>
                <button onClick={generateClaimLink} className="text-slate-500 text-xs px-3 py-2 rounded-lg hover:text-white transition-colors">
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Profit Breakdown */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5"><DollarSign size={12} /> Profit (NY Market)</h2>
          {editing ? (
            <div className="space-y-2">
              {[
                ['Parts Cost ($)', 'parts_cost'],
                ['Labor Cost ($)', 'labor_cost'],
                ['Sublet Cost ($)', 'sublet_cost'],
                ['Deductible Waived ($)', 'deductible_waived'],
                ['Referral Fee ($)', 'referral_fee'],
                ['Goodwill Repair ($)', 'goodwill_repair_cost'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="text-[10px] text-slate-500">{label}</label>
                  <input type="number" className={inp + ' mt-0.5'} value={form[key] || ''} onChange={e => set(key, e.target.value)} placeholder="0" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {[
                ['Parts Cost', `$${parseFloat(ro.parts_cost||0).toFixed(2)}`],
                [t('ro.labor'), `$${parseFloat(ro.labor_cost||0).toFixed(2)}`],
                ['Sublet', `$${parseFloat(ro.sublet_cost||0).toFixed(2)}`],
                ['Total Billed', `$${parseFloat(ro.total||0).toFixed(2)}`],
              ].map(([k,v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-slate-500">{k}</span><span className="text-white">{v}</span>
                </div>
              ))}
              {ro.deductible_waived > 0 && <div className="flex justify-between text-xs"><span className="text-red-400">Deductible Waived</span><span className="text-red-400">-${ro.deductible_waived}</span></div>}
              {ro.referral_fee > 0 && <div className="flex justify-between text-xs"><span className="text-red-400">Referral Fee</span><span className="text-red-400">-${ro.referral_fee}</span></div>}
              {ro.goodwill_repair_cost > 0 && <div className="flex justify-between text-xs"><span className="text-red-400">Goodwill Repair</span><span className="text-red-400">-${ro.goodwill_repair_cost}</span></div>}
              <div className="border-t border-[#2a2d3e] pt-2 flex justify-between text-sm font-bold">
                <span className="text-emerald-400">True Profit</span>
                <span className="text-emerald-400">${parseFloat(ro.true_profit||0).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5"><ClipboardList size={12} /> Timeline</h2>
          <div className="space-y-2.5">
            {ro.log?.map((entry, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{background: STATUS_COLORS[entry.to_status]}} />
                <div className="flex-1">
                  <div className="text-xs text-white font-medium">{STATUS_LABELS[entry.to_status]}</div>
                  <div className="text-[10px] text-slate-500">{new Date(entry.created_at).toLocaleString()}</div>
                  {entry.note && <div className="text-[10px] text-slate-400 italic">{entry.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">{t('common.notes')}</h2>
        {editing
          ? <textarea className={inp} rows={3} value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder={`${t('common.notes')}...`} />
          : <p className="text-sm text-slate-300">{ro.notes || <span className="text-slate-600 italic">No notes</span>}</p>
        }
      </div>

      {/* Photos */}
      <ROPhotos roId={ro.id} isAdmin={userIsAdmin} />

      {/* Assigned Tech */}
      {userIsEmployee && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <User size={12} /> {t('ro.technician')}
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-white font-medium">
              {ro.assigned_tech ? ro.assigned_tech.name : <span className="text-slate-500 italic">Unassigned</span>}
            </span>
            {userIsAdmin && (
              <select
                value={ro.assigned_to || ''}
                onChange={e => assignTech(e.target.value)}
                className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Unassigned</option>
                {shopUsers
                  .filter(u => ['owner', 'admin', 'employee', 'staff'].includes(u.role))
                  .map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Tech Notes */}
      {userIsEmployee && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <ClipboardList size={12} /> {t('common.notes')}
          </h2>
          <textarea
            className={`${inp} w-full`}
            rows={4}
            value={techNotes}
            onChange={e => setTechNotes(e.target.value)}
            onBlur={saveTechNotes}
            placeholder="Internal tech notes — not visible to customer..."
          />
          {savingNotes && <p className="text-[10px] text-slate-500 mt-1">Saving...</p>}
        </div>
      )}

      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <MessageSquare size={12} /> Communication Log
          </h2>
          <button
            onClick={() => setShowCommForm((s) => !s)}
            className="text-xs bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            {showCommForm ? 'Cancel' : 'Log Contact'}
          </button>
        </div>

        {showCommForm && (
          <form onSubmit={submitComm} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3 mb-3 space-y-2">
            <select
              value={commForm.type}
              onChange={(e) => setCommForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            >
              <option value="call">Call</option>
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="in-person">In-Person</option>
            </select>
            <textarea
              rows={3}
              value={commForm.notes}
              onChange={(e) => setCommForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Contact summary..."
              className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            />
            <button
              type="submit"
              disabled={savingComm}
              className="bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              {savingComm ? 'Saving...' : 'Submit'}
            </button>
          </form>
        )}

        {comms.length === 0 ? (
          <p className="text-slate-500 text-sm">No communication entries yet.</p>
        ) : (
          <div className="space-y-2">
            {comms.map((entry) => {
              const meta = COMM_TYPE_META[entry.type] || COMM_TYPE_META.call
              const Icon = meta.Icon
              return (
                <div key={entry.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <Icon size={12} className="text-[#EAB308]" />
                    <span className="text-white font-medium">{meta.label}</span>
                    <span>·</span>
                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                    <span>·</span>
                    <span>{entry.logged_by || 'System'}</span>
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{entry.notes}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Parts Requests */}
      {userIsEmployee && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Package size={12} /> Parts Requests
            </h2>
            <button
              onClick={() => setShowPartsReqForm(s => !s)}
              className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={12} /> Request Part
            </button>
          </div>

          {showPartsReqForm && (
            <form onSubmit={submitPartsRequest} className="bg-[#0f1117] rounded-xl p-4 border border-[#2a2d3e] mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-[10px] text-slate-500 block mb-1">Part Name *</label>
                  <input
                    className={inp + ' w-full'}
                    required
                    value={partsReqForm.part_name}
                    onChange={e => setPartsReqForm(f => ({ ...f, part_name: e.target.value }))}
                    placeholder="Front bumper cover"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Part Number</label>
                  <input
                    className={inp + ' w-full'}
                    value={partsReqForm.part_number}
                    onChange={e => setPartsReqForm(f => ({ ...f, part_number: e.target.value }))}
                    placeholder="OEM-12345"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Qty</label>
                  <input
                    type="number"
                    min="1"
                    className={inp + ' w-full'}
                    value={partsReqForm.quantity}
                    onChange={e => setPartsReqForm(f => ({ ...f, quantity: +e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-slate-500 block mb-1">Notes</label>
                  <input
                    className={inp + ' w-full'}
                    value={partsReqForm.notes}
                    onChange={e => setPartsReqForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="OEM only, urgent, etc."
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowPartsReqForm(false)} className="flex-1 bg-[#1a1d2e] text-slate-400 rounded-lg py-2 text-xs border border-[#2a2d3e]">Cancel</button>
                <button type="submit" disabled={submittingPartsReq} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2 text-xs disabled:opacity-50">
                  {submittingPartsReq ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          )}

          {partsRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 border border-dashed border-[#2a2d3e] rounded-xl">
              <Package size={24} className="text-slate-600 mb-2" />
              <p className="text-slate-500 text-sm">No parts requested yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {partsRequests.map(req => {
                const meta = REQ_STATUS_META[req.status] || REQ_STATUS_META.pending
                const Icon = meta.Icon
                return (
                  <div key={req.id} className="flex items-start gap-3 bg-[#0f1117] rounded-xl p-3 border border-[#2a2d3e]">
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.cls}`}>
                      <Icon size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white font-medium">{req.part_name}</span>
                        {req.part_number && <span className="text-[10px] text-slate-500">#{req.part_number}</span>}
                        {req.quantity > 1 && <span className="text-[10px] text-slate-500">× {req.quantity}</span>}
                      </div>
                      {req.notes && <p className="text-[10px] text-slate-500 mt-0.5">{req.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {userIsAdmin ? (
                        <select
                          value={req.status}
                          onChange={e => updatePartsReqStatus(req.id, e.target.value)}
                          className={`text-[10px] px-2 py-1 rounded-lg border font-semibold bg-transparent focus:outline-none ${meta.cls}`}
                        >
                          <option value="pending">Pending</option>
                          <option value="ordered">Ordered</option>
                          <option value="received">Received</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      ) : (
                        <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${meta.cls}`}>
                          {meta.label}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Customer Portal Access */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5"><Smartphone size={12} /> Customer Portal</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {ro.customer?.has_portal_access
                ? <span className="flex items-center gap-1"><CheckCircle size={12} className="text-emerald-400" /> Customer has portal access</span>
                : 'Customer cannot track their vehicle yet'}
            </p>
          </div>
          <button onClick={generatePortalAccess}
            disabled={generatingAccess || !ro.customer?.email}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
            {generatingAccess ? 'Generating…'
              : ro.customer?.has_portal_access ? 'Reset Password'
              : 'Generate Login'}
          </button>
        </div>

        {!ro.customer?.email && (
          <p className="text-xs text-amber-400 mt-2 flex items-center gap-1.5"><AlertTriangle size={12} /> No email on file — add it to the customer record first.</p>
        )}

        {portalCreds && (
          <div className="mt-4 bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              {portalCreds.reset ? <><RefreshCw size={14} /> Password reset</> : <><CheckCircle size={14} /> Portal access created</>}
            </p>
            <div className="bg-[#0f1117] rounded-lg p-3 space-y-2 font-mono">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 text-xs">Link</span>
                <span className="text-indigo-400 text-xs">{window.location.origin}/portal</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 text-xs">Email</span>
                <span className="text-white text-xs">{portalCreds.email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 text-xs">Password</span>
                <span className="text-emerald-400 text-sm font-bold tracking-wider">{portalCreds.password}</span>
              </div>
            </div>
            <button onClick={() => {
              const msg = `Hi! You can track your vehicle repair here:\n${window.location.origin}/portal\n\nEmail: ${portalCreds.email}\nPassword: ${portalCreds.password}\n\nLog in to see your repair status, expected delivery, and parts updates.`
              navigator.clipboard.writeText(msg).then(() => alert('Copied! Paste it into a text message.'))
            }} className="w-full text-xs bg-emerald-700 hover:bg-emerald-600 text-white font-semibold rounded-lg py-2 transition-colors flex items-center justify-center gap-1.5">
              <Copy size={13} /> Copy Message to Send Customer
            </button>
          </div>
        )}

        {/* Tracking Link Section */}
        {ro.customer?.phone && (
          <div className="mt-4 bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Smartphone size={12} /> Send Tracking Link
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Send customer a link to track their vehicle
                </p>
              </div>
              <button
                onClick={generateTrackingLink}
                disabled={generatingLink}
                className="flex items-center gap-1.5 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {generatingLink ? 'Sending...' : 'Send SMS'}
              </button>
            </div>

            {trackingLink && (
              <div className="mt-3 bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    readOnly
                    value={trackingLink}
                    className="flex-1 bg-transparent text-xs text-slate-300 font-mono truncate"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(trackingLink)
                      setLinkCopied(true)
                      setTimeout(() => setLinkCopied(false), 3000)
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    {linkCopied ? <><CheckCircle size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showPaymentModal && (
        <PaymentModal
          roId={id}
          amount={paymentAmount}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            load()
            setShowPaymentModal(false)
          }}
        />
      )}

      {/* Mark as Paid Modal */}
      {showMarkPaidModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign size={20} className="text-emerald-400" />
              <h2 className="text-lg font-bold text-white">Mark as Paid</h2>
            </div>
            <p className="text-sm text-slate-400">Select payment method and confirm. This will mark the RO as paid and close it.</p>
            <div className="space-y-2">
              <label className="text-xs text-slate-500 block">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="insurance">Insurance</option>
                <option value="check">Check</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowMarkPaidModal(false)}
                className="flex-1 bg-[#2a2d3e] text-slate-300 text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#3a3d4e] transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={markPaid}
                disabled={markingPaid}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {markingPaid ? 'Processing...' : <>
                  <DollarSign size={14} /> Mark Paid
                </>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parts Tracking */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package size={15} className="text-indigo-400" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide">{t('ro.parts')}</h2>
            {parts.filter(p => p.status === 'backordered').length > 0 && (
              <span className="text-[10px] bg-red-900/40 text-red-400 border border-red-700/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <AlertTriangle size={11} /> {parts.filter(p=>p.status==='backordered').length} backordered
              </span>
            )}
            {parts.length > 0 && parts.every(p=>p.status==='received') && (
              <span className="text-[10px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <CheckCircle size={11} /> All parts in
              </span>
            )}
          </div>
          <button onClick={() => setShowAddPart(s=>!s)}
            className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={12}/> {t('common.add')} {t('ro.parts')}
          </button>
        </div>

        {/* Add Part Form */}
        {showAddPart && (
          <form onSubmit={addPart} className="bg-[#0f1117] rounded-xl p-4 border border-[#2a2d3e] mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="text-[10px] text-slate-500 block mb-1">Part Name *</label>
                <input className={inp} required value={partForm.part_name} onChange={e=>setPartForm(f=>({...f,part_name:e.target.value}))} placeholder="Front bumper assembly" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Part Number</label>
                <input className={inp} value={partForm.part_number} onChange={e=>setPartForm(f=>({...f,part_number:e.target.value}))} placeholder="OEM-12345" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Vendor</label>
                <LibraryAutocomplete
                  value={partForm.vendor || ''}
                  onChange={v => setPartForm(f => ({...f, vendor: v}))}
                  onSelect={v => setPartForm(f => ({...f, vendor: v.name}))}
                  searchFn={searchVendors}
                  placeholder="LKQ, NAPA, PPG..."
                  renderItem={v => (
                    <div>
                      <div className="text-xs text-white font-medium">{v.name}</div>
                      <div className="text-[10px] text-slate-400">{v.type}{v.phone ? ` · ${v.phone}` : ''}</div>
                    </div>
                  )}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Expected Date</label>
                <input type="date" className={inp} value={partForm.expected_date} onChange={e=>setPartForm(f=>({...f,expected_date:e.target.value}))} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Qty</label>
                <input type="number" min="1" className={inp} value={partForm.quantity} onChange={e=>setPartForm(f=>({...f,quantity:e.target.value}))} />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-slate-500 block mb-1">Tracking Number (optional — UPS / FedEx / USPS / DHL)</label>
                <input className={inp} value={partForm.tracking_number} onChange={e=>setPartForm(f=>({...f,tracking_number:e.target.value}))} placeholder="1Z999AA10123456784 or 94001116990045349715" />
                <p className="text-[9px] text-slate-600 mt-0.5">Carrier is auto-detected. Status updates automatically when you have a tracking API key in Settings.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={()=>setShowAddPart(false)} className="flex-1 bg-[#1a1d2e] text-slate-400 rounded-lg py-2 text-xs border border-[#2a2d3e]">Cancel</button>
              <button type="submit" disabled={savingPart} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2 text-xs disabled:opacity-50">
                {savingPart ? 'Adding...' : 'Add Part'}
              </button>
            </div>
          </form>
        )}

        {parts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed border-[#2a2d3e] rounded-xl">
            <img src="/empty-parts.png" alt="No parts ordered" className="w-40 h-40 opacity-80 object-contain" />
            <p className="text-slate-400 text-sm font-medium">Parts board is clear.</p>
            <p className="text-slate-600 text-xs">No parts ordered yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {parts.map(p => {
              const meta = PART_STATUS_META[p.status] || PART_STATUS_META.ordered
              const Icon = meta.icon
              return (
                <div key={p.id} className="flex items-start gap-3 bg-[#0f1117] rounded-xl p-3 border border-[#2a2d3e]">
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.cls}`}>
                    <Icon size={13}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-white font-medium">{p.part_name}</span>
                      {p.part_number && <span className="text-[10px] text-slate-500">#{p.part_number}</span>}
                      {p.quantity > 1 && <span className="text-[10px] text-slate-500">× {p.quantity}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500 flex-wrap">
                      {p.vendor && <span>{p.vendor}</span>}
                      {p.expected_date && p.status !== 'received' && <span className="text-amber-400">Expected: {p.expected_date}</span>}
                      {p.received_date && <span className="text-emerald-400">Received: {p.received_date}</span>}
                    </div>

                    {/* Tracking row */}
                    {p.tracking_number && (
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <Truck size={11} className="text-slate-500 flex-shrink-0"/>
                        <span className="text-[10px] font-mono text-slate-500">{CARRIER_LABELS[p.carrier] || 'Track'}: {p.tracking_number}</span>
                        {p.tracking_status && TRACKING_META[p.tracking_status] && (
                          <span className={`text-[10px] font-semibold flex items-center gap-1 ${TRACKING_META[p.tracking_status].cls}`}>
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background: TRACKING_META[p.tracking_status].dot}} />
                            {TRACKING_META[p.tracking_status].label}
                          </span>
                        )}
                        {p.tracking_detail && p.tracking_status !== 'delivered' && (
                          <span className="text-[10px] text-slate-500 italic">{p.tracking_detail}</span>
                        )}
                        {p.tracking_updated_at && (
                          <span className="text-[9px] text-slate-600">· updated {new Date(p.tracking_updated_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span>
                        )}
                        {/* Carrier link */}
                        <a href={`/api/tracking/url?carrier=${p.carrier||''}&num=${encodeURIComponent(p.tracking_number)}`}
                          target="_blank" rel="noopener" onClick={e => { e.preventDefault(); api.get(`/tracking/url?carrier=${p.carrier||''}&num=${encodeURIComponent(p.tracking_number)}`).then(r=>window.open(r.data.url,'_blank')) }}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 transition-colors">
                          <ExternalLink size={9}/> Track
                        </a>
                        {/* Refresh button */}
                        <button onClick={() => refreshTracking(p.id)} disabled={refreshingPart === p.id}
                          className="text-[10px] text-slate-500 hover:text-amber-400 flex items-center gap-0.5 transition-colors disabled:opacity-50">
                          <RefreshCw size={9} className={refreshingPart === p.id ? 'animate-spin' : ''}/> Refresh
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Quick status toggle */}
                    {p.status === 'ordered' && (
                      <>
                        <button onClick={()=>updatePartStatus(p.id,'backordered')} className="text-[10px] bg-red-900/30 text-red-400 border border-red-700/40 px-2 py-1 rounded-lg hover:bg-red-900/50 transition-colors">Backorder</button>
                        <button onClick={()=>updatePartStatus(p.id,'received')} className="text-[10px] bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 px-2 py-1 rounded-lg hover:bg-emerald-900/50 transition-colors">Received</button>
                      </>
                    )}
                    {p.status === 'backordered' && (
                      <button onClick={()=>updatePartStatus(p.id,'received')} className="text-[10px] bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 px-2 py-1 rounded-lg hover:bg-emerald-900/50 transition-colors inline-flex items-center gap-1">Received <CheckCircle size={10} /></button>
                    )}
                    <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${meta.cls}`}>{meta.label}</span>
                    <button onClick={()=>deletePart(p.id)} className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                      <X size={13}/>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
