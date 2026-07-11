import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Save, X, Package, PackageCheck, PackageX, Plus, CheckCircle, AlertCircle, Clock, Truck, RefreshCw, ExternalLink, Car, DollarSign, ClipboardList, Smartphone, AlertTriangle, Copy, Printer, User, Phone, MessageSquare, Mail, Users, CreditCard, Search, Camera, Trash2, ChevronDown, ChevronUp, MoreHorizontal, ChevronRight } from 'lucide-react'
import api from '../lib/api'
import { tryCopyToClipboard } from '../lib/clipboard'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'
import { Money, StatusBadge } from '../components/ui'
import PaymentStatusBadge, { normalizePaymentStatus } from '../components/PaymentStatusBadge'
import PaymentPanel from '../components/PaymentPanel'
import LibraryAutocomplete from '../components/LibraryAutocomplete'
import ROPhotos from '../components/ROPhotos'
import TurnaroundEstimator from '../components/TurnaroundEstimator'
import PartsSearch from '../components/PartsSearch'
import { searchInsurers } from '../data/insurers'
import { searchVendors } from '../data/vendors'
import { getTokenPayload, isAdmin, isAssistant, isEmployee } from '../lib/auth'
import { useLanguage } from '../contexts/LanguageContext'
import VehicleDiagram from '../components/VehicleDiagram'
import ClaimStatusCard from '../components/ClaimStatusCard'
import InsurancePanel from '../components/InsurancePanel'
import SupplementFinderPanel from '../components/SupplementFinderPanel'
import ROOperations from '../components/ROOperations'
import ClaimTrackerPanel from '../components/ClaimTrackerPanel'
import { optimizeImageForUpload } from '../lib/imageUpload'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'
import { safeExternalErrorMessage } from '../lib/safeErrors'
import PhotoLightbox from '../components/PhotoLightbox'
import AppOverlay from '../components/AppOverlay'

const PART_STATUS_META = {
  ordered:     { label: 'Ordered',     cls: 'border-brand/40 bg-brand/10 text-brand', icon: Clock },
  backordered: { label: 'Backordered', cls: 'border-crit/40 bg-crit/10 text-crit', icon: AlertCircle },
  received:    { label: 'Received',    cls: 'border-good/40 bg-good/10 text-good', icon: CheckCircle },
  cancelled:   { label: 'Cancelled',   cls: 'border-line-2 bg-raised text-muted', icon: X },
}

const TRACKING_META = {
  pending:          { label: 'Tracking Pending',   cls: 'text-muted', dot: 'var(--muted)' },
  in_transit:       { label: 'In Transit',         cls: 'text-brand', dot: 'var(--brand)' },
  out_for_delivery: { label: 'Out for Delivery',   cls: 'text-brand', dot: 'var(--brand-lit)' },
  delivered:        { label: 'Delivered to Shop',  cls: 'text-good', dot: 'var(--good)' },
  exception:        { label: 'Shipping Exception', cls: 'text-crit', dot: 'var(--crit)' },
  expired:          { label: 'Tracking Expired',   cls: 'text-faint', dot: 'var(--faint)' },
}
const CARRIER_LABELS = { ups:'UPS', fedex:'FedEx', usps:'USPS', dhl:'DHL', unknown:'Carrier' }

const REQ_STATUS_META = {
  pending:   { label: 'Pending',   cls: 'text-muted bg-raised border-line-2', Icon: Package },
  ordered:   { label: 'Ordered',   cls: 'text-brand bg-brand/10 border-brand/40',       Icon: PackageCheck },
  received:  { label: 'Received',  cls: 'text-good bg-good/10 border-good/40', Icon: PackageCheck },
  cancelled: { label: 'Cancelled', cls: 'text-crit bg-crit/10 border-crit/40', Icon: PackageX },
}

const COMM_TYPE_META = {
  call: { label: 'Call', Icon: Phone },
  sms: { label: 'SMS', Icon: MessageSquare },
  text: { label: 'SMS', Icon: MessageSquare },
  email: { label: 'Email', Icon: Mail },
  'in-person': { label: 'In Person', Icon: Users },
}

const SUPP_STATUS_META = {
  Pending:  { cls: 'text-gold bg-gold/10 border-gold/40' },
  Approved: { cls: 'text-good bg-good/10 border-good/40' },
  Denied:   { cls: 'text-crit bg-crit/10 border-crit/40' },
}

const AUDIT_PRIORITY_META = {
  HIGH: { label: 'High', cls: 'text-crit border-crit/40 bg-crit/10' },
  MEDIUM: { label: 'Medium', cls: 'text-brand border-brand/40 bg-brand/10' },
  LOW: { label: 'Low', cls: 'text-muted border-line-2 bg-raised' },
}

const STAGES = ['intake','estimate','approval','parts','repair','paint','qc','delivery','closed']

function ROFeedbackPortal({ feedback, onDismiss }) {
  if (!feedback || typeof document === 'undefined') return null
  const isError = feedback.type === 'error'
  const isWarning = feedback.type === 'warning'
  const tone = isError
    ? 'border-crit/50 bg-panel text-crit'
    : isWarning
      ? 'border-brand/50 bg-panel text-brand'
      : 'border-good/50 bg-panel text-good'

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[220] flex justify-center sm:inset-x-auto sm:right-4 sm:top-4">
      <div
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-instrument border px-4 py-3 shadow-2xl ${tone}`}
      >
        <p className="min-w-0 flex-1 text-sm text-ink">{feedback.text}</p>
        <button type="button" onClick={onDismiss} className="shrink-0 text-muted transition-colors hover:text-ink" aria-label="Dismiss message">
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

export default function RODetail() {
  const { t } = useLanguage()
  const { id } = useParams()
  const navigate = useNavigate()
  const [ro, setRo] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)

  function showFeedback(type, text) {
    setFeedback({ type, text })
  }

  const [parts, setParts]     = useState([])
  const [showAddPart, setShowAddPart] = useState(false)
  const [showCatalogSearch, setShowCatalogSearch] = useState(false)
  const [partForm, setPartForm] = useState({ part_name:'', part_number:'', vendor:'', quantity:1, unit_cost:'', expected_date:'', notes:'', tracking_number:'' })
  const [savingPart, setSavingPart] = useState(false)
  const [refreshingPart, setRefreshingPart] = useState(null)  // partId being refreshed

  const [claimLink, setClaimLink] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [sendingCustomerLinks, setSendingCustomerLinks] = useState(false)
  const [generatingPaymentLink, setGeneratingPaymentLink] = useState(false)
  const [trackingLink, setTrackingLink] = useState('')
  const [paymentLink, setPaymentLink] = useState('')

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
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [markingPaid, setMarkingPaid] = useState(false)
  const [showTotalLossModal, setShowTotalLossModal] = useState(false)
  const [totalLossNote, setTotalLossNote] = useState('')
  const [markingTotalLoss, setMarkingTotalLoss] = useState(false)
  const [comms, setComms] = useState([])
  const [showCommForm, setShowCommForm] = useState(false)
  const [commForm, setCommForm] = useState({ channel: 'call', direction: 'outbound', summary: '' })
  const [savingComm, setSavingComm] = useState(false)
  const [internalNotes, setInternalNotes] = useState([])
  const [internalNoteText, setInternalNoteText] = useState('')
  const [savingInternalNote, setSavingInternalNote] = useState(false)
  const [deletingInternalNote, setDeletingInternalNote] = useState(null)
  const [preDropoffPhotos, setPreDropoffPhotos] = useState([])
  const [preDropoffUploading, setPreDropoffUploading] = useState(false)
  const [preDropoffUploadProgress, setPreDropoffUploadProgress] = useState('')
  const [preDropoffUploadError, setPreDropoffUploadError] = useState('')
  const [preDropoffExpanded, setPreDropoffExpanded] = useState(true)
  const [preDropoffLightbox, setPreDropoffLightbox] = useState(null)
  const [failedPreDropoffPhotoIds, setFailedPreDropoffPhotoIds] = useState({})
  const [inspectionSummary, setInspectionSummary] = useState([])
  const [creatingInspection, setCreatingInspection] = useState(false)

  // SMS thread state
  const [smsThread, setSmsThread] = useState([])
  const [smsCustomerPhone, setSmsCustomerPhone] = useState('')
  const [smsMessage, setSmsMessage] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [smsLoading, setSmsLoading] = useState(false)

  const [supplements, setSupplements] = useState([])
  const [totalApproved, setTotalApproved] = useState(0)
  const [showSuppForm, setShowSuppForm] = useState(false)
  const [suppForm, setSuppForm] = useState({ description: '', amount: '', status: 'Pending', submitted_date: '', notes: '' })
  const [savingSupp, setSavingSupp] = useState(false)
  const [updatingSupp, setUpdatingSupp] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [overviewTab, setOverviewTab] = useState('core')
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [printingRepairOrder, setPrintingRepairOrder] = useState(false)
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    insurance_company: '',
    policy_number: '',
  })
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [estimateImport, setEstimateImport] = useState({ items: [], summary: null, loading: false })
  const [supplementAudit, setSupplementAudit] = useState({ loading: false, error: '', data: null, copiedKey: '' })
  const [quickNoteText, setQuickNoteText] = useState('')
  const [savingQuickNote, setSavingQuickNote] = useState(false)
  const [storageForm, setStorageForm] = useState({
    storage_hold: false,
    storage_rate_per_day: '',
    storage_start_date: '',
    storage_company: '',
    storage_contact: '',
    storage_notes: '',
  })
  const [storageCharges, setStorageCharges] = useState([])
  const [storageSaving, setStorageSaving] = useState(false)
  const [showStorageBillModal, setShowStorageBillModal] = useState(false)
  const [billingStorage, setBillingStorage] = useState({ days: 0, rate_per_day: 0, billed_to: '', notes: '' })
  const [billingStorageSaving, setBillingStorageSaving] = useState(false)
  const [vehicleHistoryExpanded, setVehicleHistoryExpanded] = useState(false)
  const [vehicleHistory, setVehicleHistory] = useState([])
  const [vehicleHistoryLoading, setVehicleHistoryLoading] = useState(false)
  const [vehicleHistoryError, setVehicleHistoryError] = useState('')
  const [inlineEdit, setInlineEdit] = useState({ field: null, value: '' })

  const userIsAdmin = isAdmin()
  const userIsEmployee = isEmployee()
  const userIsAssistant = isAssistant()
  const canViewPreDropoff = userIsEmployee || userIsAdmin
  const canUploadPreDropoff = !userIsAssistant && canViewPreDropoff
  // Admin and assistant can always edit (including closed ROs). Employees can edit open ROs only.
  const canEditRo = userIsAdmin || userIsAssistant || userIsEmployee
  const currentUser = getTokenPayload()
  const currentUserId = currentUser?.id || null
  const currentUserRole = String(currentUser?.role || '').toLowerCase()
  const currentUserIsTechRole = ['technician', 'employee', 'staff'].includes(currentUserRole)

  // useMemo must be before any early return — moved here from line 635
  const damagedPanels = useMemo(() => {
    try {
      return JSON.parse(ro?.damaged_panels || '[]')
    } catch {
      return []
    }
  }, [ro?.damaged_panels])

  function buildFormFromRo(roData) {
    return {
      ...roData,
      vin: roData?.vehicle?.vin || '',
      vehicle_year: roData?.vehicle?.year ?? '',
      vehicle_make: roData?.vehicle?.make || '',
      vehicle_model: roData?.vehicle?.model || '',
      vehicle_color: roData?.vehicle?.color || '',
      vehicle_plate: roData?.vehicle?.plate || '',
      vehicle_mileage: roData?.vehicle?.mileage ?? '',
    }
  }

  const load = async () => {
    try {
      const r = await api.get(`/ros/${id}`)
      setRo(r.data)
      setForm(buildFormFromRo(r.data))
      setParts(r.data.parts || [])
      setTechNotes(r.data.tech_notes || '')
      setStorageForm({
        storage_hold: !!r.data.storage_hold,
        storage_rate_per_day: r.data.storage_rate_per_day ?? '',
        storage_start_date: r.data.storage_start_date || '',
        storage_company: r.data.storage_company || '',
        storage_contact: r.data.storage_contact || '',
        storage_notes: r.data.storage_notes || '',
      })
    } catch (err) {
      console.error('Failed to load RO:', err)
    }
  }
  const loadPartsRequests = () => api.get(`/parts-requests/${id}`).then(r => setPartsRequests(r.data.requests || [])).catch(() => {})
  const loadComms = () => api.get(`/comms/${id}`).then(r => setComms(r.data.comms || [])).catch(() => setComms([]))
  const loadInternalNotes = () => api.get(`/ros/${id}/notes`).then(r => setInternalNotes(r.data.notes || [])).catch(() => setInternalNotes([]))

  const loadSmsThread = () => {
    setSmsLoading(true)
    api.get(`/sms/thread/${id}`)
      .then(r => {
        setSmsThread(r.data.messages || [])
        if (r.data.customer_phone) setSmsCustomerPhone(r.data.customer_phone)
      })
      .catch(() => {})
      .finally(() => setSmsLoading(false))
  }
  const loadPreDropoffPhotos = () => api.get(`/photos/ro/${id}/predropoff`).then(r => setPreDropoffPhotos(r.data.photos || [])).catch(() => setPreDropoffPhotos([]))
  const loadInspections = () => api.get(`/inspections/ro/${id}`).then(r => setInspectionSummary(r.data.inspections || [])).catch(() => setInspectionSummary([]))
  const loadSupplements = () => api.get(`/ros/${id}/supplements`).then(r => { setSupplements(r.data.supplements || []); setTotalApproved(r.data.totalApproved || 0) }).catch(() => {})
  const loadStorageCharges = () => api.get(`/storage/${id}/charges`).then(r => setStorageCharges(r.data.charges || [])).catch(() => setStorageCharges([]))
  const loadEstimateImport = () => {
    setEstimateImport((prev) => ({ ...prev, loading: true }))
    api.get(`/estimate-items/${id}`)
      .then((r) => setEstimateImport({ items: r.data.items || [], summary: r.data.summary || null, loading: false }))
      .catch(() => setEstimateImport({ items: [], summary: null, loading: false }))
  }

  useEffect(() => { load() }, [id])
  useEffect(() => {
    api.get(`/claim-links/ro/${id}`).then(r => setClaimLink(r.data)).catch(() => {})
  }, [id])
  useEffect(() => {
    api.get('/users').then(r => setShopUsers(r.data.users || [])).catch(() => {})
  }, [])
  useEffect(() => { loadPartsRequests() }, [id])
  useEffect(() => { loadComms() }, [id])
  useEffect(() => {
    if (!userIsAdmin) return
    loadInternalNotes()
  }, [id, userIsAdmin])
  useEffect(() => {
    if (!canViewPreDropoff) return
    loadPreDropoffPhotos()
  }, [id, canViewPreDropoff])
  useEffect(() => { loadInspections() }, [id])
  useEffect(() => { loadSupplements() }, [id])
  useEffect(() => { loadStorageCharges() }, [id])
  useEffect(() => { loadEstimateImport() }, [id])
  useEffect(() => { loadSmsThread() }, [id])
  useEffect(() => {
    if (!vehicleHistoryExpanded || !ro?.customer?.id) return

    let cancelled = false
    setVehicleHistoryLoading(true)
    setVehicleHistoryError('')

    api.get(`/customers/${ro.customer.id}/history`, {
      params: { limit: 10, exclude_ro_id: id }
    })
      .then((r) => {
        if (cancelled) return
        setVehicleHistory(r.data.history || [])
      })
      .catch((err) => {
        if (cancelled) return
        setVehicleHistoryError(err?.response?.data?.error || 'Could not load history')
      })
      .finally(() => {
        if (cancelled) return
        setVehicleHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [vehicleHistoryExpanded, ro?.customer?.id, id])

  useEffect(() => {
    setCustomerForm({
      name: ro?.customer?.name || '',
      phone: ro?.customer?.phone || '',
      email: ro?.customer?.email || '',
      address: ro?.customer?.address || '',
      insurance_company: ro?.customer?.insurance_company || '',
      policy_number: ro?.customer?.policy_number || '',
    })
  }, [
    ro?.customer?.id,
    ro?.customer?.name,
    ro?.customer?.phone,
    ro?.customer?.email,
    ro?.customer?.address,
    ro?.customer?.insurance_company,
    ro?.customer?.policy_number,
  ])

  async function addPart(e) {
    e.preventDefault(); setSavingPart(true)
    try {
      await api.post(`/parts/ro/${id}`, partForm)
      load()
      setShowAddPart(false)
      setPartForm({ part_name:'', part_number:'', vendor:'', quantity:1, unit_cost:'', expected_date:'', notes:'', tracking_number:'' })
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not add part')
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
      showFeedback('error', e?.response?.data?.error || 'Could not refresh tracking')
    } finally {
      setRefreshingPart(null)
    }
  }

  async function updatePartStatus(partId, status) {
    try {
      await api.put(`/parts/${partId}`, { status }); load()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not update part status')
    }
  }

  async function deletePart(partId) {
    try {
      await api.delete(`/parts/${partId}`); load()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not delete part')
    }
  }

  function handleCatalogPartAdded(part) {
    setParts((prev) => [...prev, part])
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
      showFeedback('error', e?.response?.data?.error || 'Could not generate claim link')
    } finally {
      setGeneratingLink(false)
    }
  }

  async function copyClaimLink() {
    try {
      const url = `${window.location.origin}/claim/${claimLink.token}`
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 3000)
    } catch (err) {
      showFeedback('error', 'Could not copy link. Clipboard access was denied.')
    }
  }

  async function generateCustomerLinks() {
    setSendingCustomerLinks(true)
    try {
      const { data } = await api.post(`/portal/magic-link/${id}`)
      setTrackingLink(data.trackingUrl)
      setPaymentLink(data.paymentUrl || '')
      await navigator.clipboard.writeText(data.trackingUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 3000)
    } catch (e) {
      showFeedback('error', e?.response?.data?.error || 'Could not generate tracking link')
    } finally {
      setSendingCustomerLinks(false)
    }
  }

  async function generatePaymentLinkOnly() {
    setGeneratingPaymentLink(true)
    try {
      const { data } = await api.post(`/payments/link/${id}`)
      setPaymentLink(data.checkoutUrl)
      await navigator.clipboard.writeText(data.checkoutUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 3000)
    } catch (e) {
      showFeedback('error', e?.response?.data?.error || 'Could not generate payment link')
    } finally {
      setGeneratingPaymentLink(false)
    }
  }

  async function advance() {
    const idx = STAGES.indexOf(ro.status)
    if (idx < STAGES.length - 1) {
      try {
        await api.put(`/ros/${id}/status`, { status: STAGES[idx+1] })
        load()
      } catch (err) {
        showFeedback('error', err?.response?.data?.error || 'Failed to advance status')
      }
    }
  }

  async function goBack() {
    const idx = STAGES.indexOf(ro.status)
    if (idx > 0) {
      if (!window.confirm(`Move back to "${STATUS_LABELS[STAGES[idx-1]]}"?`)) return
      await api.put(`/ros/${id}/status`, { status: STAGES[idx-1] })
      load()
    }
  }

  async function markTotalLoss() {
    setMarkingTotalLoss(true)
    try {
      const note = totalLossNote.trim()
      const { data } = await api.put(`/ros/${id}/status`, {
        status: 'total_loss',
        note: note || undefined,
      })
      setRo(data)
      setForm(buildFormFromRo(data))
      setShowTotalLossModal(false)
      setTotalLossNote('')
      load()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not mark this RO as total loss')
    } finally {
      setMarkingTotalLoss(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const roPayload = {
        parts_cost: +form.parts_cost || 0,
        labor_cost: +form.labor_cost || 0,
        sublet_cost: +form.sublet_cost || 0,
        tax: +form.tax || 0,
        total: +form.total || 0,
        deductible: +form.deductible || 0,
        deductible_waived: +form.deductible_waived || 0,
        referral_fee: +form.referral_fee || 0,
        goodwill_repair_cost: +form.goodwill_repair_cost || 0,
        estimated_delivery: form.estimated_delivery,
        notes: form.notes,
        vin: form.vin,
        vehicle_year: form.vehicle_year,
        vehicle_make: form.vehicle_make,
        vehicle_model: form.vehicle_model,
        vehicle_color: form.vehicle_color,
        vehicle_plate: form.vehicle_plate,
        vehicle_mileage: form.vehicle_mileage,
      }
      const { data } = await api.put(`/ros/${id}`, roPayload)
      setRo(data)
      setForm(buildFormFromRo(data))
      setEditing(false)
    } finally { setSaving(false) }
  }

  async function assignTech(userId) {
    try {
      const nextUserId = userId || null
      const assignedToSomeoneElse = currentUserIsTechRole && !!ro?.assigned_to && ro.assigned_to !== currentUserId
      if (assignedToSomeoneElse) {
        const currentlyAssignedName = ro?.assigned_tech?.name || 'another tech'
        const proceed = window.confirm(
          `This RO is assigned to ${currentlyAssignedName}, not you. Continue anyway? Admin will be notified.`
        )
        if (!proceed) return
      }

      await api.patch(`/ros/${id}/assign`, { user_id: nextUserId })
      load()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not assign technician')
    }
  }

  async function saveTechNotes() {
    setSavingNotes(true)
    try {
      await api.patch(`/ros/${id}`, { tech_notes: techNotes })
    } finally {
      setSavingNotes(false)
    }
  }

  async function saveCustomerInfo() {
    if (!ro?.customer?.id) {
      showFeedback('warning', 'No customer is linked to this RO.')
      return
    }
    if (!customerForm.name.trim()) {
      showFeedback('warning', 'Customer name is required.')
      return
    }

    setSavingCustomer(true)
    try {
      const payload = {
        name: customerForm.name.trim(),
        phone: customerForm.phone?.trim() || '',
        email: customerForm.email?.trim() || '',
        address: customerForm.address?.trim() || '',
        insurance_company: customerForm.insurance_company?.trim() || '',
        policy_number: customerForm.policy_number?.trim() || '',
      }
      const { data } = await api.put(`/customers/${ro.customer.id}`, payload)
      setRo((prev) => (prev ? { ...prev, customer: { ...(prev.customer || {}), ...data } } : prev))
      setSmsCustomerPhone(data?.phone || '')
      showFeedback('success', 'Customer updated.')
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not update customer')
    } finally {
      setSavingCustomer(false)
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
      showFeedback('error', err?.response?.data?.error || 'Could not submit request')
    } finally {
      setSubmittingPartsReq(false)
    }
  }

  async function updatePartsReqStatus(reqId, status) {
    try {
      await api.patch(`/parts-requests/${reqId}`, { status })
      loadPartsRequests()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Failed to update parts request')
    }
  }

  async function approveEstimate() {
    setApprovingEstimate(true)
    try {
      await api.post(`/ros/${id}/approve-estimate`)
      load()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not approve estimate')
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
      const copied = await tryCopyToClipboard(url)
      showFeedback('success', copied ? 'Approval link copied to clipboard.' : 'Approval link generated. Copy it from the highlighted box below.')
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not generate approval link')
    } finally {
      setSendingForApproval(false)
    }
  }

  async function downloadRepairOrderPdf() {
    setShowActionMenu(false)
    setPrintingRepairOrder(true)
    try {
      const response = await api.get(`/invoice/${id}/repair-order`, { responseType: 'blob' })
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `repair-order-${ro?.ro_number || id}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (err) {
      showFeedback('error', safeExternalErrorMessage(err, 'Could not download the repair order PDF.'))
    } finally {
      setPrintingRepairOrder(false)
    }
  }

  async function submitComm(e) {
    e.preventDefault()
    if (!commForm.summary.trim()) return
    setSavingComm(true)
    try {
      await api.post(`/comms/ro/${id}`, commForm)
      setCommForm({ channel: 'call', direction: 'outbound', summary: '' })
      setShowCommForm(false)
      loadComms()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not log communication')
    } finally {
      setSavingComm(false)
    }
  }

  async function deleteComm(commId) {
    if (!confirm('Delete this communication log entry?')) return
    try {
      await api.delete(`/comms/${commId}`)
      loadComms()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not delete communication entry')
    }
  }

  async function submitInternalNote(e) {
    e.preventDefault()
    const note = internalNoteText.trim()
    if (!note) return
    setSavingInternalNote(true)
    try {
      await api.post(`/ros/${id}/notes`, { note })
      setInternalNoteText('')
      loadInternalNotes()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not save internal note')
    } finally {
      setSavingInternalNote(false)
    }
  }

  async function sendSmsMessage(e) {
    e.preventDefault()
    const body = smsMessage.trim()
    if (!body || !smsCustomerPhone.trim()) return
    setSmsSending(true)
    try {
      await api.post('/sms/send', { ro_id: id, to_phone: smsCustomerPhone.trim(), message: body })
      setSmsMessage('')
      loadSmsThread()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not send text message')
    } finally {
      setSmsSending(false)
    }
  }

  async function deleteInternalNote(noteId) {
    if (!confirm('Delete this internal note?')) return
    setDeletingInternalNote(noteId)
    try {
      await api.delete(`/ros/${id}/notes/${noteId}`)
      loadInternalNotes()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not delete note')
    } finally {
      setDeletingInternalNote(null)
    }
  }

  async function uploadPreDropoffPhoto(e) {
    const input = e.currentTarget
    const files = Array.from(input.files || [])
    if (!files.length) return

    setPreDropoffUploading(true)
    setPreDropoffUploadError('')
    let uploadedCount = 0
    const failures = []

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      if (!String(file.type || '').startsWith('image/')) {
        failures.push({ file, message: 'File is not an image.' })
        continue
      }

      try {
        setPreDropoffUploadProgress(`Uploading ${index + 1} of ${files.length}…`)
        const preparedFile = await optimizeImageForUpload(file, {
          maxDimension: 2048,
          targetBytes: 3 * 1024 * 1024,
        })
        const fd = new FormData()
        fd.append('photo', preparedFile)
        await api.post(`/photos/ro/${id}/predropoff`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        uploadedCount += 1
      } catch (err) {
        failures.push({
          file,
          message: safeExternalErrorMessage(err, 'Could not upload photo'),
        })
      }
    }

    if (uploadedCount > 0) {
      await loadPreDropoffPhotos()
    }
    if (failures.length > 0) {
      const firstFailure = failures[0]
      setPreDropoffUploadError(
        `${failures.length} of ${files.length} pre-dropoff photos could not be uploaded. ${firstFailure.file.name}: ${firstFailure.message}`
      )
    }

    setPreDropoffUploading(false)
    setPreDropoffUploadProgress('')
    input.value = ''
  }

  async function deletePreDropoffPhoto(photoId) {
    if (!confirm('Delete this pre-dropoff photo?')) return
    try {
      await api.delete(`/photos/${photoId}`)
      setPreDropoffPhotos((current) => current.filter((photo) => photo.id !== photoId))
      setPreDropoffLightbox((current) => current?.id === photoId ? null : current)
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not delete photo')
    }
  }

  async function markPaid() {
    setMarkingPaid(true)
    try {
      await api.post(`/ros/${id}/mark-paid`, { payment_method: paymentMethod })
      load()
      setShowMarkPaidModal(false)
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not mark as paid')
    } finally {
      setMarkingPaid(false)
    }
  }

  async function submitSupplement(e) {
    e.preventDefault()
    if (!suppForm.description.trim()) return
    setSavingSupp(true)
    try {
      await api.post(`/ros/${id}/supplements`, {
        description: suppForm.description,
        amount: parseFloat(suppForm.amount) || 0,
        status: suppForm.status,
        submitted_date: suppForm.submitted_date || undefined,
        notes: suppForm.notes || undefined,
      })
      setSuppForm({ description: '', amount: '', status: 'Pending', submitted_date: '', notes: '' })
      setShowSuppForm(false)
      loadSupplements()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not add supplement')
    } finally {
      setSavingSupp(false)
    }
  }

  async function updateSuppStatus(suppId, status) {
    setUpdatingSupp(suppId)
    try {
      await api.patch(`/ros/${id}/supplements/${suppId}`, { status })
      loadSupplements()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not update supplement')
    } finally {
      setUpdatingSupp(null)
    }
  }

  async function startInspection() {
    setCreatingInspection(true)
    try {
      const { data } = await api.post('/inspections', { ro_id: id })
      navigate(`/ros/${id}/inspection/${data.inspection.id}`)
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not start inspection')
    } finally {
      setCreatingInspection(false)
    }
  }

  async function saveStorageFields(nextValues) {
    setStorageSaving(true)
    try {
      await api.patch(`/storage/${id}`, nextValues)
      await load()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not update storage settings')
    } finally {
      setStorageSaving(false)
    }
  }

  async function toggleStorageHold(enabled) {
    const payload = { storage_hold: enabled }
    if (enabled && !storageForm.storage_start_date) {
      payload.storage_start_date = new Date().toISOString().slice(0, 10)
    }
    await saveStorageFields(payload)
    setStorageForm((prev) => ({ ...prev, storage_hold: enabled, ...payload }))
  }

  async function billStorage(e) {
    e.preventDefault()
    setBillingStorageSaving(true)
    try {
      await api.post(`/storage/${id}/charges`, {
        days: Number(billingStorage.days),
        rate_per_day: Number(billingStorage.rate_per_day),
        billed_to: billingStorage.billed_to,
        notes: billingStorage.notes,
      })
      setShowStorageBillModal(false)
      await loadStorageCharges()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not create storage charge')
    } finally {
      setBillingStorageSaving(false)
    }
  }

  async function markStorageChargePaid(chargeId) {
    try {
      await api.patch(`/storage/${id}/charges/${chargeId}`)
      await loadStorageCharges()
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not mark charge as paid')
    }
  }

  if (!ro) return <div className="flex items-center justify-center h-64 text-faint">{t('common.loading')}</div>

  const currentIdx = STAGES.indexOf(ro.status)
  const isClosedTotalLoss = ro.status === 'closed' && String(ro.claim_status || '').toLowerCase() === 'total_loss'
  const closedRoAdminOverride = userIsAdmin && ro.status === 'closed'
  const isTerminalStatus = ['total_loss', 'siu_hold'].includes(ro.status) || (ro.status === 'closed' && !userIsAdmin)
  const canStepBack = currentIdx > 0 && !isTerminalStatus
  const canAdvance = currentIdx >= 0 && currentIdx < STAGES.indexOf('delivery') && !userIsAssistant && !(ro.status === 'closed' && !userIsAdmin)
  const paymentStatus = normalizePaymentStatus(ro.payment_status, ro.payment_received)
  const paymentAmount = Number(ro.total || ro.parts_cost || 0)
  const canMarkPaymentFromRo = userIsAdmin && !userIsAssistant
  const hideHeaderFinancialForTech = currentUserIsTechRole
  const techAssignmentMismatch = currentUserIsTechRole && !!ro.assigned_to && ro.assigned_to !== currentUserId
  const latestInspection = inspectionSummary[0] || null
  const inspectionStatusMeta = latestInspection
    ? latestInspection.status === 'viewed'
      ? { label: 'Viewed', cls: 'bg-good/10 border-good/40 text-good' }
      : latestInspection.status === 'sent'
        ? { label: 'Sent', cls: 'bg-brand/10 border-brand/40 text-brand' }
        : { label: 'Draft', cls: 'bg-raised border-line-2 text-muted' }
    : { label: 'No Inspection', cls: 'bg-raised border-line-2 text-muted' }
  const showStripePanel = (ro.status === 'delivery' || ro.status === 'closed') && paymentStatus === 'unpaid'
  const daysIn = ro.intake_date ? Math.floor((Date.now() - new Date(ro.intake_date)) / 86400000) : 0
  const daysColor = daysIn > 14 ? 'text-crit' : daysIn > 7 ? 'text-brand' : 'text-good'
  const partsSubtotal = parts.reduce((sum, part) => sum + (Number(part.quantity || 0) * Number(part.unit_cost || 0)), 0)
  const storageDays = storageForm.storage_start_date
    ? Math.max(0, Math.floor((Date.now() - new Date(storageForm.storage_start_date).getTime()) / 86400000))
    : 0
  const storageAccrued = storageDays * Number(storageForm.storage_rate_per_day || 0)
  const storageBilledTotal = storageCharges.reduce((sum, charge) => sum + Number(charge.total_amount || 0), 0)
  const storageUnpaidTotal = storageCharges
    .filter((charge) => !charge.paid)
    .reduce((sum, charge) => sum + Number(charge.total_amount || 0), 0)
  const importedItemsCount = estimateImport.items.length
  const importedLastAt = estimateImport.items.reduce((latest, item) => {
    const stamp = new Date(item?.updated_at || item?.created_at || 0).getTime()
    return Number.isFinite(stamp) && stamp > latest ? stamp : latest
  }, 0)
  const noteItems = String(ro?.notes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const inp = 'w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none'
  // damagedPanels useMemo moved above the if(!ro) early return to avoid hook violation

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function persistQuickNotes(nextItems) {
    setSavingQuickNote(true)
    try {
      const nextNotes = nextItems.join('\n')
      const { data } = await api.patch(`/ros/${id}`, { notes: nextNotes || null })
      setRo(data)
      setForm((prev) => ({ ...prev, notes: data?.notes || '' }))
    } catch (err) {
      showFeedback('error', err?.response?.data?.error || 'Could not update notes')
    } finally {
      setSavingQuickNote(false)
    }
  }

  async function addQuickNote() {
    const next = quickNoteText.trim()
    if (!next || userIsAssistant) return
    await persistQuickNotes([...noteItems, next])
    setQuickNoteText('')
  }

  async function saveInlineField(fieldKey, value) {
    try {
      const { data } = await api.patch(`/ros/${id}`, { [fieldKey]: value })
      setRo(data)
    } catch (err) {
      console.error('[RODetail] Inline field save failed:', err.message)
    }
    setInlineEdit({ field: null, value: '' })
  }

  async function removeQuickNote(idx) {
    if (userIsAssistant) return
    const next = noteItems.filter((_, i) => i !== idx)
    await persistQuickNotes(next)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <ROFeedbackPortal feedback={feedback} onDismiss={() => setFeedback(null)} />
      {/* Header */}
      <div className="relative rounded-instrument border border-line bg-panel p-4 shadow-[0_16px_48px_rgba(0,0,0,0.18)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              aria-label="Back to repair orders"
              onClick={() => navigate('/ros')}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted transition-colors hover:border-brand/50 hover:text-ink"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Repair order</p>
              <h1 className="font-display text-2xl font-semibold text-ink">{ro.ro_number}</h1>
              <p className="truncate text-sm text-muted">
                {[ro.vehicle?.year, ro.vehicle?.make, ro.vehicle?.model].filter(Boolean).join(' ') || 'Vehicle not set'}
              </p>
              <p className="mt-1 font-mono text-xs text-faint">
                Claim {ro.claim_number || ro.insurance_claim_number || 'not assigned'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!hideHeaderFinancialForTech && <StatusBadge status={ro.status} claimStatus={ro.claim_status} />}
                {!hideHeaderFinancialForTech && <PaymentStatusBadge status={paymentStatus} paymentReceived={ro.payment_received} />}
                <span className={`rounded-full border border-line px-2.5 py-1 font-mono text-xs ${daysColor}`}>{daysIn}d in shop</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {editing ? (
              <>
                <button type="button" onClick={save} disabled={saving} className="revv-btn revv-btn-primary">
                  <Save size={14} /> {saving ? 'Saving...' : t('common.save')}
                </button>
                <button type="button" onClick={() => { setEditing(false); setForm(buildFormFromRo(ro)) }} className="revv-btn revv-btn-secondary" aria-label="Cancel editing">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                {canAdvance && (
                  <button type="button" onClick={advance} className="revv-btn revv-btn-primary">
                    Advance <ChevronRight size={14} /> {STATUS_LABELS[STAGES[currentIdx + 1]]}
                  </button>
                )}
                {ro.status === 'delivery' && !userIsAssistant && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Close this ticket and mark vehicle as delivered?')) return
                      await api.put(`/ros/${id}/status`, { status: 'closed' })
                      load()
                    }}
                    className="revv-btn revv-btn-primary"
                  >
                    <CheckCircle size={14} /> Close ticket
                  </button>
                )}
                {userIsAdmin && (ro.payment_type === 'insurance' || ro.claim_number || ro.insurance_claim_number) && (
                  <button
                    type="button"
                    onClick={() => { setActiveTab('overview'); setOverviewTab('insurance') }}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-gold/40 bg-gold/10 px-3 text-xs font-semibold text-gold transition-colors hover:bg-gold/15"
                  >
                    <Plus size={13} /> Supplement
                  </button>
                )}
              </>
            )}

            <div
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setShowActionMenu(false)
              }}
            >
              <button
                type="button"
                aria-label="More repair order actions"
                aria-expanded={showActionMenu}
                onClick={() => setShowActionMenu((open) => !open)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted hover:border-brand/50 hover:text-ink"
              >
                <MoreHorizontal size={17} />
              </button>
              {showActionMenu && (
                <div className="absolute right-0 top-11 z-30 w-56 rounded-instrument border border-line bg-raised p-1.5 shadow-2xl" role="menu">
                  {ro.status === 'estimate_sent' && !ro.estimate_approved_at && !userIsAssistant && (
                    <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); approveEstimate() }} disabled={approvingEstimate} className="revv-menu-item">Approve estimate</button>
                  )}
                  {ro.status === 'estimate' && !userIsAssistant && (
                    <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); sendForApproval() }} disabled={sendingForApproval} className="revv-menu-item">Send for approval</button>
                  )}
                  {!ro.payment_received && canMarkPaymentFromRo && (
                    <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); setShowMarkPaidModal(true) }} className="revv-menu-item">Mark payment received</button>
                  )}
                  {canStepBack && <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); goBack() }} className="revv-menu-item">Move to previous stage</button>}
                  <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); setActiveTab('storage') }} className="revv-menu-item">Storage hold</button>
                  <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); window.open(`/invoice/${id}`, '_blank') }} className="revv-menu-item">Open invoice</button>
                  <button type="button" role="menuitem" onClick={downloadRepairOrderPdf} disabled={printingRepairOrder} className="revv-menu-item">
                    {printingRepairOrder ? 'Preparing repair order…' : 'Print repair order'}
                  </button>
                  {canEditRo && !editing && <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); setEditing(true) }} className="revv-menu-item">Edit RO details</button>}
                  {ro.status !== 'total_loss' && !isClosedTotalLoss && !userIsAssistant && (
                    <button type="button" role="menuitem" onClick={() => { setShowActionMenu(false); setShowTotalLossModal(true) }} className="revv-menu-item text-crit">Mark total loss</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-instrument border border-line bg-panel px-3 py-3" aria-label="Repair order progress">
        <div className="min-w-[620px]">
          <div className="flex items-start">
            {STAGES.slice(0, -1).map((stage, index) => {
              const complete = index < currentIdx
              const current = index === currentIdx
              const canClick = !userIsAssistant && stage !== ro.status && !(ro.status === 'closed' && !userIsAdmin)
              return (
                <button
                  key={stage}
                  type="button"
                  disabled={!canClick}
                  onClick={() => canClick && api.put(`/ros/${id}/status`, { status: stage }).then(() => load())}
                  className="group relative flex min-w-0 flex-1 flex-col items-center gap-2 px-1 text-center"
                >
                  {index > 0 && <span className={`absolute right-1/2 top-2.5 h-px w-full ${complete || current ? 'bg-brand' : 'bg-line-2'}`} aria-hidden="true" />}
                  <span className={`relative z-10 h-5 w-5 rounded-full border-4 ${complete ? 'border-brand bg-brand' : current ? 'border-gold bg-panel shadow-[0_0_0_3px_color-mix(in_srgb,var(--gold)_18%,transparent)]' : 'border-line-2 bg-panel'}`} />
                  <span className={`text-[10px] ${current ? 'font-semibold text-gold' : complete ? 'text-brand-lit' : 'text-faint'}`}>{STATUS_LABELS[stage] || stage}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-line">
        <div className="flex min-w-max items-center gap-5 px-1" role="tablist" aria-label="Repair order sections">
          {[
            ['core', 'Overview'],
            ['insurance', 'Insurance'],
            ['parts', 'Parts'],
            ['customer', 'Customer'],
            ['communication', 'Comms'],
            ['photos', 'Photos'],
          ].map(([key, label]) => {
            const selected = activeTab === 'overview' && overviewTab === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => { setActiveTab('overview'); setOverviewTab(key) }}
                className={`border-b-2 px-1 py-3 text-sm font-semibold transition-colors ${selected ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {activeTab === 'storage' && (
        <div className="space-y-4">
          <div className="bg-panel border border-line-2 rounded-instrument p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Storage Hold</h2>
                <p className="text-xs text-faint">Track rental vehicle storage and billing.</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={!!storageForm.storage_hold}
                  disabled={userIsAssistant || storageSaving}
                  onChange={(e) => toggleStorageHold(e.target.checked)}
                  className="accent-brand"
                />
                This vehicle is in storage hold
              </label>
            </div>

            {storageForm.storage_hold && (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-faint block mb-1">Rental Company</label>
                    <input className={inp} value={storageForm.storage_company} onChange={(e) => setStorageForm((f) => ({ ...f, storage_company: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div>
                    <label className="text-[11px] text-faint block mb-1">Contact</label>
                    <input className={inp} value={storageForm.storage_contact} onChange={(e) => setStorageForm((f) => ({ ...f, storage_contact: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div>
                    <label className="text-[11px] text-faint block mb-1">Daily Rate</label>
                    <input type="number" min="0" step="0.01" className={inp} value={storageForm.storage_rate_per_day} onChange={(e) => setStorageForm((f) => ({ ...f, storage_rate_per_day: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div>
                    <label className="text-[11px] text-faint block mb-1">Storage Start Date</label>
                    <input type="date" className={inp} value={storageForm.storage_start_date || ''} onChange={(e) => setStorageForm((f) => ({ ...f, storage_start_date: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-faint block mb-1">Notes</label>
                    <textarea rows={3} className={inp} value={storageForm.storage_notes} onChange={(e) => setStorageForm((f) => ({ ...f, storage_notes: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!userIsAssistant && (
                    <button
                      onClick={() => saveStorageFields({
                        storage_rate_per_day: storageForm.storage_rate_per_day,
                        storage_start_date: storageForm.storage_start_date,
                        storage_company: storageForm.storage_company,
                        storage_contact: storageForm.storage_contact,
                        storage_notes: storageForm.storage_notes,
                      })}
                      disabled={storageSaving}
                      className="text-xs bg-brand hover:bg-brand-lit text-on-brand px-3 py-1.5 rounded-lg disabled:opacity-60"
                    >
                      {storageSaving ? 'Saving...' : 'Save Storage Details'}
                    </button>
                  )}
                  {!userIsAssistant && (
                    <button
                      onClick={() => {
                        setBillingStorage({
                          days: storageDays || 1,
                          rate_per_day: Number(storageForm.storage_rate_per_day || 0),
                          billed_to: storageForm.storage_company || ro.customer?.name || '',
                          notes: '',
                        })
                        setShowStorageBillModal(true)
                      }}
                      className="text-xs bg-gold hover:bg-gold-lit text-on-gold font-semibold px-3 py-1.5 rounded-lg"
                    >
                      Bill Storage
                    </button>
                  )}
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="bg-void border border-line-2 rounded-lg p-3">
                    <div className="text-xs text-faint">Days Stored</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-ink">{storageDays}</div>
                  </div>
                  <div className="bg-void border border-line-2 rounded-lg p-3">
                    <div className="text-xs text-faint">Total Accrued</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-gold">${storageAccrued.toFixed(2)}</div>
                  </div>
                  <div className="bg-void border border-line-2 rounded-lg p-3">
                    <div className="text-xs text-faint">Unpaid Charges</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-gold">${storageUnpaidTotal.toFixed(2)}</div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="bg-panel border border-line-2 rounded-instrument p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink">Storage Charges History</h3>
              <span className="font-mono text-xs tabular-nums text-gold">Total billed: ${storageBilledTotal.toFixed(2)}</span>
            </div>
            {storageCharges.length === 0 ? (
              <p className="text-sm text-faint">No storage charges yet.</p>
            ) : (
              <div className="overflow-x-auto border border-line-2 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-void text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Billed Date</th>
                      <th className="px-3 py-2 text-left">Days</th>
                      <th className="px-3 py-2 text-left">Rate</th>
                      <th className="px-3 py-2 text-left">Amount</th>
                      <th className="px-3 py-2 text-left">Billed To</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storageCharges.map((charge) => (
                      <tr key={charge.id} className="border-t border-line-2">
                        <td className="px-3 py-2 text-ink">{charge.billed_date || '—'}</td>
                        <td className="px-3 py-2 text-ink">{charge.days}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-ink">${Number(charge.rate_per_day || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-gold">${Number(charge.total_amount || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-ink">{charge.billed_to || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-1 rounded-full border ${charge.paid ? 'text-good border-good/40 bg-good/10' : 'text-gold border-gold/40 bg-gold/10'}`}>
                            {charge.paid ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!charge.paid && !userIsAssistant && (
                            <button
                              onClick={() => markStorageChargePaid(charge.id)}
                              className="text-xs bg-good hover:bg-good text-white px-2 py-1 rounded"
                            >
                              Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'overview' && (
        <>
      {overviewTab === 'core' && (
        <>
      {(ro.status === 'total_loss' || isClosedTotalLoss) && (
        <div className="bg-crit/15 border border-crit/50 rounded-instrument p-4 text-sm text-crit">
          This RO is closed as a total loss. Repair workflow steps are skipped, and financials remain editable for teardown, storage, and administrative billing.
        </div>
      )}

      {approvalLink && (
        <div className="rounded-instrument border border-brand/40 bg-brand/10 p-3 text-xs text-brand">
          Approval link ready: <span className="font-mono break-all">{approvalLink}</span>
        </div>
      )}

      <div className={`grid gap-4 ${userIsAdmin && (ro.payment_type === 'insurance' || ro.claim_number || ro.insurance_claim_number) ? 'xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]' : ''}`}>
        <section className="rounded-instrument border border-line bg-panel p-4" aria-labelledby="job-money-heading">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Overview</p>
              <h2 id="job-money-heading" className="font-display text-lg font-semibold text-ink">Job &amp; money</h2>
            </div>
            <StatusBadge status={ro.status} claimStatus={ro.claim_status} />
          </div>
          <dl className="mt-5 divide-y divide-line">
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs text-muted">Amount owed</dt>
              <dd><Money cents={ro.amount_owed_cents ?? 0} className="text-xl font-semibold text-ink" /></dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs text-muted">Amount paid</dt>
              <dd><Money cents={ro.amount_paid_cents ?? 0} className="text-base font-semibold text-good" /></dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs text-muted">Promised</dt>
              <dd className="font-mono text-sm text-ink">{ro.estimated_delivery ? new Date(`${String(ro.estimated_delivery).slice(0, 10)}T12:00:00`).toLocaleDateString() : 'Not set'}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs text-muted">Assigned</dt>
              <dd className="text-sm font-medium text-ink">{ro.assigned_tech?.name || 'Unassigned'}</dd>
            </div>
          </dl>
        </section>
        {userIsAdmin && (ro.payment_type === 'insurance' || ro.claim_number || ro.insurance_claim_number) && (
          <SupplementFinderPanel
            roId={id}
            importedItems={estimateImport.items}
            importedSummary={estimateImport.summary}
            variant="hero"
            onFileSupplement={() => setOverviewTab('insurance')}
          />
        )}
      </div>

      {showStripePanel && (
        <PaymentPanel
          roId={id}
          totalAmount={paymentAmount}
          onSuccess={load}
          onMarkManual={canMarkPaymentFromRo ? () => setShowMarkPaidModal(true) : null}
        />
      )}

      {(ro.status === 'delivery' || ro.status === 'closed') && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3">Delivery Info</h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-faint">Date Delivered</label>
              {canEditRo ? (
                <input
                  type="date"
                  value={ro.actual_delivery || ''}
                  onChange={async (e) => {
                    await api.patch(`/ros/${id}`, { actual_delivery: e.target.value || null })
                    load()
                  }}
                  className="bg-void border border-line-2 text-ink text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand"
                />
              ) : (
                <span className="text-sm text-ink">{ro.actual_delivery ? new Date(ro.actual_delivery + 'T12:00:00').toLocaleDateString() : '—'}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-faint">Picked Up By</label>
              <div className="flex gap-1">
                <button
                  disabled={!canEditRo}
                  onClick={async () => {
                    if (!canEditRo) return
                    await api.patch(`/ros/${id}`, { pickup_type: 'customer' })
                    load()
                  }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${(ro.pickup_type || 'customer') === 'customer' ? 'bg-brand text-on-brand' : 'bg-raised text-muted hover:bg-raised'} ${!canEditRo ? 'cursor-default' : ''}`}
                >
                  Customer
                </button>
                <button
                  disabled={!canEditRo}
                  onClick={async () => {
                    if (!canEditRo) return
                    await api.patch(`/ros/${id}`, { pickup_type: 'insurance' })
                    load()
                  }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${ro.pickup_type === 'insurance' ? 'bg-brand text-on-brand' : 'bg-raised text-muted hover:bg-raised'} ${!canEditRo ? 'cursor-default' : ''}`}
                >
                  Insurance
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-panel border border-line-2 rounded-instrument p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide">Digital Inspection</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${inspectionStatusMeta.cls}`}>
              {inspectionStatusMeta.label}
            </span>
            {latestInspection?.status && (
              <span className="text-xs text-faint">
                Last updated {new Date(latestInspection.updated_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {latestInspection && (
            <button
              onClick={() => navigate(`/ros/${id}/inspection/${latestInspection.id}`)}
              className="text-xs bg-raised hover:bg-raised text-ink font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Open Latest
            </button>
          )}
          <button
            onClick={startInspection}
            disabled={creatingInspection}
            className="text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {creatingInspection ? 'Starting...' : 'Start Inspection'}
          </button>
        </div>
      </div>

      {canViewPreDropoff && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <button
            type="button"
            onClick={() => setPreDropoffExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <h2 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
              <Camera size={12} /> Pre-Dropoff Condition
            </h2>
            <span className="text-faint">
              {preDropoffExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          <p className="text-xs text-faint mt-2">
            These photos document vehicle condition before work begins
          </p>

          {preDropoffExpanded && (
            <div className="mt-3 space-y-3">
              {canUploadPreDropoff && (
                <label
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                    preDropoffUploading
                      ? 'bg-brand-deep text-brand opacity-50 pointer-events-none'
                      : 'bg-brand hover:bg-brand-lit text-on-brand'
                  }`}
                >
                  <Camera size={12} /> {preDropoffUploading ? preDropoffUploadProgress : 'Upload Pre-Dropoff Photos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    aria-label="Pre-dropoff photos"
                    className="hidden"
                    disabled={preDropoffUploading}
                    onChange={uploadPreDropoffPhoto}
                  />
                </label>
              )}

              {preDropoffUploadError && (
                <p role="alert" className="rounded-lg border border-crit/50 bg-crit/15 px-3 py-2 text-xs text-crit">
                  {preDropoffUploadError}
                </p>
              )}

              {preDropoffPhotos.length === 0 ? (
                <p className="text-sm text-faint">No pre-dropoff photos added yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {preDropoffPhotos.map((photo) => {
                    const photoUrl = resolveUploadedMediaUrl(photo.photo_url)
                    const photoFailed = !!failedPreDropoffPhotoIds[photo.id]

                    return (
                      <div
                        key={photo.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`View pre-dropoff photo${photo.caption ? `: ${photo.caption}` : ''}`}
                        onClick={() => setPreDropoffLightbox(photo)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setPreDropoffLightbox(photo)
                          }
                        }}
                        className="relative group rounded-instrument overflow-hidden border border-line-2 aspect-video bg-void cursor-zoom-in"
                      >
                        {photoUrl && !photoFailed ? (
                          <img
                            src={photoUrl}
                            alt="Pre-dropoff"
                            className="w-full h-full object-cover"
                            onError={() => setFailedPreDropoffPhotoIds((prev) => ({ ...prev, [photo.id]: true }))}
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-faint">
                            <Camera size={20} className="text-faint" />
                            <span className="text-xs font-medium">Photo unavailable</span>
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/75">
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-semibold text-brand bg-brand/10 border-brand/40">
                            Pre-Dropoff
                          </span>
                        </div>
                        {canUploadPreDropoff && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              deletePreDropoffPhoto(photo.id)
                            }}
                            className="absolute right-1.5 top-1.5 z-20 rounded-md border border-crit/40 bg-black/75 p-1.5 text-crit hover:bg-crit/20 hover:text-crit"
                            aria-label="Delete pre-dropoff photo"
                            title="Delete photo"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {preDropoffLightbox && (
        <PhotoLightbox
          src={resolveUploadedMediaUrl(preDropoffLightbox.photo_url)}
          alt="Pre-dropoff full view"
          title={preDropoffLightbox.caption || 'Pre-dropoff photo'}
          unavailable={!!failedPreDropoffPhotoIds[preDropoffLightbox.id]}
          onError={() => setFailedPreDropoffPhotoIds((prev) => ({ ...prev, [preDropoffLightbox.id]: true }))}
          onClose={() => setPreDropoffLightbox(null)}
          onDelete={canUploadPreDropoff ? () => deletePreDropoffPhoto(preDropoffLightbox.id) : undefined}
        />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Vehicle Info */}
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-1.5"><Car size={12} /> {t('common.vehicle')}</h2>
          <div className="space-y-2">
            <div className="flex justify-between items-start gap-3 text-xs">
              <span className="text-faint">{t('common.year')}/{t('common.make')}/{t('common.model')}</span>
              {editing ? (
                <div className="grid grid-cols-3 gap-1.5 w-[320px] max-w-full">
                  <input
                    value={form.vehicle_year ?? ''}
                    onChange={e => set('vehicle_year', e.target.value)}
                    className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand"
                    placeholder="Year"
                  />
                  <input
                    value={form.vehicle_make ?? ''}
                    onChange={e => set('vehicle_make', e.target.value)}
                    className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand"
                    placeholder="Make"
                  />
                  <input
                    value={form.vehicle_model ?? ''}
                    onChange={e => set('vehicle_model', e.target.value)}
                    className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand"
                    placeholder="Model"
                  />
                </div>
              ) : inlineEdit.field === 'vehicle_ymm' ? (
                <div className="flex items-center gap-1">
                  <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { const parts = inlineEdit.value.trim().split(/\s+/); api.patch(`/ros/${id}`, { vehicle_year: parts[0]||'', vehicle_make: parts[1]||'', vehicle_model: parts.slice(2).join(' ')||'' }).then(r => { setRo(r.data); setInlineEdit({ field: null, value: '' }) }).catch(err => { console.error('[RODetail] inline save:', err.message); setInlineEdit({ field: null, value: '' }) }) } else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-48" placeholder="Year Make Model" />
                  <button type="button" onClick={() => { const parts = inlineEdit.value.trim().split(/\s+/); api.patch(`/ros/${id}`, { vehicle_year: parts[0]||'', vehicle_make: parts[1]||'', vehicle_model: parts.slice(2).join(' ')||'' }).then(r => { setRo(r.data); setInlineEdit({ field: null, value: '' }) }).catch(err => { console.error('[RODetail] inline save:', err.message); setInlineEdit({ field: null, value: '' }) }) }} className="text-good hover:text-good"><CheckCircle size={13} /></button>
                  <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-faint hover:text-crit"><X size={13} /></button>
                </div>
              ) : (
                <span className="text-ink font-medium capitalize flex items-center gap-1.5">
                  {[ro.vehicle?.year, ro.vehicle?.make, ro.vehicle?.model].filter(Boolean).join(' ') || '—'}
                  {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_ymm', value: [ro.vehicle?.year, ro.vehicle?.make, ro.vehicle?.model].filter(Boolean).join(' ') })} className="text-faint hover:text-ink ml-0.5"><Pencil size={10} /></button>}
                </span>
              )}
            </div>
            <div className="flex justify-between text-xs gap-3">
              <span className="text-faint">Color</span>
              {editing
                ? <input value={form.vehicle_color || ''} onChange={e => set('vehicle_color', e.target.value)} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-52 max-w-full" placeholder="Color" />
                : inlineEdit.field === 'vehicle_color' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vehicle_color', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-40" placeholder="Color" />
                    <button type="button" onClick={() => saveInlineField('vehicle_color', inlineEdit.value)} className="text-good hover:text-good"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-faint hover:text-crit"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-ink font-medium capitalize flex items-center gap-1.5">
                    {ro.vehicle?.color || '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_color', value: ro.vehicle?.color || '' })} className="text-faint hover:text-ink ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs gap-3">
              <span className="text-faint">Plate</span>
              {editing
                ? <input value={form.vehicle_plate || ''} onChange={e => set('vehicle_plate', e.target.value)} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-52 max-w-full" placeholder="Plate" />
                : inlineEdit.field === 'vehicle_plate' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vehicle_plate', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-40" placeholder="Plate" />
                    <button type="button" onClick={() => saveInlineField('vehicle_plate', inlineEdit.value)} className="text-good hover:text-good"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-faint hover:text-crit"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-ink font-medium flex items-center gap-1.5">
                    {ro.vehicle?.plate || '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_plate', value: ro.vehicle?.plate || '' })} className="text-faint hover:text-ink ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs gap-3">
              <span className="text-faint">Mileage</span>
              {editing
                ? <input type="number" min="0" value={form.vehicle_mileage ?? ''} onChange={e => set('vehicle_mileage', e.target.value)} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-40 max-w-full" placeholder="Mileage" />
                : inlineEdit.field === 'vehicle_mileage' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus type="number" min="0" value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vehicle_mileage', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-32" placeholder="Mileage" />
                    <button type="button" onClick={() => saveInlineField('vehicle_mileage', inlineEdit.value)} className="text-good hover:text-good"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-faint hover:text-crit"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-ink font-medium flex items-center gap-1.5">
                    {ro.vehicle?.mileage ? Number(ro.vehicle.mileage).toLocaleString() : '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_mileage', value: ro.vehicle?.mileage ?? '' })} className="text-faint hover:text-ink ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-faint">{t('common.vin')}</span>
              {editing
                ? <input value={form.vin || ''} onChange={e => set('vin', e.target.value)} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-52 max-w-full" placeholder="VIN" />
                : inlineEdit.field === 'vehicle_vin' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vin', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand w-52" placeholder="VIN" />
                    <button type="button" onClick={() => saveInlineField('vin', inlineEdit.value)} className="text-good hover:text-good"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-faint hover:text-crit"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-ink font-medium flex items-center gap-1.5">
                    {ro.vehicle?.vin || '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_vin', value: ro.vehicle?.vin || '' })} className="text-faint hover:text-ink ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-faint">Job Type</span>
              <span className="text-ink font-medium capitalize">{ro.job_type || '—'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-faint">Intake Date</span>
              <span className="text-ink font-medium capitalize">{ro.intake_date || '—'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-faint">{t('portal.estimatedCompletion')}</span>
              {editing
                ? <input type="date" value={form.estimated_delivery || ''} onChange={e => set('estimated_delivery', e.target.value)} className="bg-void border border-line-2 rounded px-2 py-0.5 text-xs text-ink focus:outline-none focus:border-brand" />
                : <span className="text-ink font-medium">{ro.estimated_delivery || '—'}</span>
              }
            </div>
            {!ro.estimated_delivery && (
              <TurnaroundEstimator
                jobType={ro.job_type}
                onAccept={isAdmin() ? (date) => {
                  api.patch(`/ros/${ro.id}`, { estimated_delivery: date }).then(r => setRo(r.data))
                } : undefined}
              />
            )}
          </div>
        </div>

        {/* Vehicle History */}
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <button
            type="button"
            onClick={() => setVehicleHistoryExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <h2 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
              <Car size={12} /> Vehicle History
            </h2>
            <span className="text-faint">
              {vehicleHistoryExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          <p className="text-xs text-faint mt-2">
            Last 10 visits for {ro.customer?.name || 'this customer'}
          </p>

          {vehicleHistoryExpanded && (
            <div className="mt-3">
              {vehicleHistoryLoading ? (
                <p className="text-sm text-faint">Loading history…</p>
              ) : vehicleHistoryError ? (
                <p className="text-sm text-crit">{vehicleHistoryError}</p>
              ) : vehicleHistory.length === 0 ? (
                <p className="text-sm text-faint">No prior visits found.</p>
              ) : (
                <div className="space-y-2">
                  {vehicleHistory.map((visit) => (
                    <div key={visit.id} className="bg-void border border-line-2 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            onClick={() => navigate(`/ros/${visit.id}`)}
                            className="text-sm font-semibold text-ink hover:text-brand"
                          >
                            {visit.ro_number || 'RO'}
                          </button>
                          <p className="text-[11px] text-faint truncate">
                            {[visit.year, visit.make, visit.model].filter(Boolean).join(' ') || 'Vehicle not set'}
                          </p>
                          <p className="text-[11px] text-faint">
                            Opened: {visit.created_at ? new Date(visit.created_at).toLocaleDateString() : '—'}
                            {visit.actual_delivery ? ` · Closed: ${new Date(visit.actual_delivery).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                        <StatusBadge status={visit.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Damage Diagram */}
        <div className="bg-panel rounded-instrument border border-line-2 p-4 col-span-full">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-4 flex items-center gap-1.5">
            <Car size={12} /> Damage Diagram
          </h2>
          <div className="overflow-auto w-full">
            <div className="min-w-[580px] sm:min-w-0">
              <VehicleDiagram
                value={damagedPanels}
                onChange={async (panels) => {
                  const nextPanels = JSON.stringify(panels)
                  setRo(prev => (prev ? { ...prev, damaged_panels: nextPanels } : prev))
                  try {
                    const { data } = await api.patch(`/ros/${ro.id}`, { damaged_panels: nextPanels })
                    setRo(data)
                  } catch {
                    load()
                  }
                }}
                readOnly={!isAdmin() && !isEmployee()}
              />
            </div>
          </div>
        </div>

        {/* Profit Breakdown */}
        {userIsAdmin && (
          <div className="bg-panel rounded-instrument border border-line-2 p-4 col-span-full">
            <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-1.5"><DollarSign size={12} /> Profit (NY Market)</h2>
            {editing ? (
              <div className="space-y-2">
                {[
                  ['Parts Cost ($)', 'parts_cost'],
                  ['Labor Cost ($)', 'labor_cost'],
                  ['Sublet Cost ($)', 'sublet_cost'],
                  ['Tax ($)', 'tax'],
                  ['Gross Estimate ($)', 'total'],
                  ['Deductible ($)', 'deductible'],
                  ['Deductible Waived ($)', 'deductible_waived'],
                  ['Referral Fee ($)', 'referral_fee'],
                  ['Goodwill Repair ($)', 'goodwill_repair_cost'],
                ].map(([label, key]) => (
                  <div key={key}>
                    <label className="text-[10px] text-faint">{label}</label>
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
                  ['Tax', `$${parseFloat(ro.tax||0).toFixed(2)}`],
                  ['Gross Estimate', `$${parseFloat(ro.total||0).toFixed(2)}`],
                  ['Deductible', `-$${parseFloat(ro.deductible||0).toFixed(2)}`],
                  ['Net Estimate', `$${Math.max(0, parseFloat(ro.total||0) - parseFloat(ro.deductible||0)).toFixed(2)}`],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-faint">{k}</span><span className="font-mono tabular-nums text-gold">{v}</span>
                  </div>
                ))}
                {/* Editable profit adjustment fields */}
                {[
                  ['Gross Estimate', 'total', ro.total],
                  ['Deductible', 'deductible', ro.deductible],
                  ['Deductible Waived', 'deductible_waived', ro.deductible_waived],
                  ['Referral Fee', 'referral_fee', ro.referral_fee],
                  ['Goodwill Repair', 'goodwill_repair_cost', ro.goodwill_repair_cost],
                ].map(([label, fieldKey, val]) => (
                  parseFloat(val || 0) > 0 || inlineEdit.field === fieldKey ? (
                    <div key={fieldKey} className="flex justify-between items-center text-xs">
                      <span className={fieldKey === 'total' ? 'text-ink' : 'text-crit'}>{label}</span>
                      {inlineEdit.field === fieldKey ? (
                        <span className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="number"
                            min="0"
                            step="0.01"
                            value={inlineEdit.value}
                            onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveInlineField(fieldKey, parseFloat(inlineEdit.value) || 0); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }}
                            onBlur={() => saveInlineField(fieldKey, parseFloat(inlineEdit.value) || 0)}
                            className="w-24 rounded border border-line-2 bg-void px-2 py-0.5 font-mono text-xs tabular-nums text-ink focus:border-brand focus:outline-none"
                          />
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className={`font-mono tabular-nums ${fieldKey === 'total' ? 'text-gold' : 'text-crit'}`}>{fieldKey === 'total' ? '' : '-'}${parseFloat(val || 0).toFixed(2)}</span>
                          {userIsAdmin && <button type="button" onClick={() => setInlineEdit({ field: fieldKey, value: String(parseFloat(val || 0)) })} className="text-faint hover:text-ink"><Pencil size={10} /></button>}
                        </span>
                      )}
                    </div>
                  ) : (
                    userIsAdmin ? (
                      <div key={fieldKey} className="flex justify-between items-center text-xs">
                        <span className="text-faint">{label}</span>
                        <button type="button" onClick={() => setInlineEdit({ field: fieldKey, value: '0' })} className="text-faint hover:text-muted text-[10px]">+ set</button>
                      </div>
                    ) : null
                  )
                ))}
                <div className="border-t border-line-2 pt-2 flex justify-between items-center text-sm font-bold">
                  <span className="text-gold">True Profit</span>
                  {inlineEdit.field === 'true_profit' ? (
                    <span className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        value={inlineEdit.value}
                        onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') saveInlineField('true_profit', parseFloat(inlineEdit.value) || 0); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }}
                        onBlur={() => saveInlineField('true_profit', parseFloat(inlineEdit.value) || 0)}
                        className="w-28 rounded border border-gold/50 bg-void px-2 py-0.5 font-mono text-sm tabular-nums text-gold focus:border-brand focus:outline-none"
                      />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <span className="font-mono tabular-nums text-gold">${parseFloat(ro.true_profit||0).toFixed(2)}</span>
                      {userIsAdmin && <button type="button" onClick={() => setInlineEdit({ field: 'true_profit', value: String(parseFloat(ro.true_profit || 0)) })} className="text-faint hover:text-ink"><Pencil size={10} /></button>}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Timeline */}
      <div className="bg-panel rounded-instrument border border-line-2 p-4">
        <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-1.5"><ClipboardList size={12} /> Timeline</h2>
        <div className="space-y-2.5">
          {ro.log?.map((entry, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{background: STATUS_COLORS[entry.to_status]}} />
              <div className="flex-1">
                <div className="text-xs text-ink font-medium">{STATUS_LABELS[entry.to_status]}</div>
                <div className="text-[10px] text-faint">{new Date(entry.created_at).toLocaleString()}</div>
                {entry.note && <div className="text-[10px] text-muted italic">{entry.note}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-panel rounded-instrument border border-line-2 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide">{t('common.notes')}</h2>
          {savingQuickNote && <span className="text-[10px] text-faint">Saving...</span>}
        </div>

        {noteItems.length === 0 ? (
          <p className="text-sm text-faint mb-3">No notes yet.</p>
        ) : (
          <div className="space-y-2 mb-3">
            {noteItems.map((note, idx) => (
              <div key={`${idx}-${note.slice(0, 16)}`} className="bg-void border border-line-2 rounded-lg p-3 flex items-start justify-between gap-3">
                <p className="text-sm text-ink whitespace-pre-wrap">{note}</p>
                {!userIsAssistant && (
                  <button
                    type="button"
                    onClick={() => removeQuickNote(idx)}
                    disabled={savingQuickNote}
                    className="text-faint hover:text-crit disabled:opacity-50"
                    title="Delete note"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!userIsAssistant && (
          <div className="flex gap-2">
            <input
              value={quickNoteText}
              onChange={(e) => setQuickNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addQuickNote()
                }
              }}
              placeholder="Add a note..."
              className="flex-1 bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={addQuickNote}
              disabled={savingQuickNote || !quickNoteText.trim()}
              className="text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
      </div>

      </>
      )}

      {overviewTab === 'customer' && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
                <User size={12} /> Customer
              </h2>
              <p className="text-xs text-faint mt-1">Edit customer details without leaving this RO.</p>
            </div>
            {!userIsAssistant && (
              <button
                type="button"
                onClick={saveCustomerInfo}
                disabled={savingCustomer}
                className="text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {savingCustomer ? 'Saving...' : 'Save Customer'}
              </button>
            )}
          </div>

          {!ro.customer?.id ? (
            <p className="text-sm text-crit">No customer is linked to this RO yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] text-faint block mb-1">Full Name *</label>
                <input
                  className={inp}
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-faint block mb-1">Phone</label>
                <input
                  className={inp}
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, phone: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-faint block mb-1">Email</label>
                <input
                  type="email"
                  className={inp}
                  value={customerForm.email}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, email: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[11px] text-faint block mb-1">Address</label>
                <input
                  className={inp}
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, address: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-faint block mb-1">Insurance Company</label>
                <input
                  className={inp}
                  value={customerForm.insurance_company}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, insurance_company: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-faint block mb-1">Policy Number</label>
                <input
                  className={inp}
                  value={customerForm.policy_number}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, policy_number: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {overviewTab === 'insurance' && (
        <>
      <div className="bg-panel border border-line-2 rounded-instrument p-4 space-y-2">
        <h2 className="text-xs font-bold text-muted uppercase tracking-wide">Imported Estimate</h2>
        {estimateImport.loading ? (
          <p className="text-sm text-faint">Checking imported estimate data...</p>
        ) : importedItemsCount > 0 ? (
          <>
            <p className="text-sm text-ink">
              {importedItemsCount} line item{importedItemsCount !== 1 ? 's' : ''} imported
              {importedLastAt > 0 ? ` · last import ${new Date(importedLastAt).toLocaleString()}` : ''}
            </p>
            <p className="text-xs text-muted">
              Estimate total in REVV: <span className="font-mono tabular-nums text-gold">${Number(estimateImport.summary?.grand_total || 0).toFixed(2)}</span>
            </p>
          </>
        ) : (
          <p className="text-sm text-faint">No imported estimate items found yet for this RO.</p>
        )}
        <p className="text-[11px] text-faint">
          REVV currently stores extracted line items from the upload. The original PDF file itself is not yet saved in the RO.
        </p>
        <button
          onClick={() => navigate(`/estimate-builder/${id}`)}
          className="text-xs bg-brand hover:bg-brand-lit text-on-brand px-3 py-1.5 rounded-lg"
        >
          Open Estimate Builder
        </button>
      </div>

      {ro.payment_type === 'insurance' && (
        <ClaimStatusCard
          ro={ro}
          onUpdate={(updatedRo) => {
            setRo(updatedRo)
            setStorageForm((prev) => ({
              ...prev,
              storage_hold: !!updatedRo.storage_hold,
              storage_rate_per_day: updatedRo.storage_rate_per_day ?? prev.storage_rate_per_day,
              storage_start_date: updatedRo.storage_start_date || prev.storage_start_date,
              storage_company: updatedRo.storage_company ?? prev.storage_company,
              storage_contact: updatedRo.storage_contact ?? prev.storage_contact,
              storage_notes: updatedRo.storage_notes ?? prev.storage_notes,
            }))
          }}
          isAdmin={isAdmin()}
          onOpenStorage={() => setActiveTab('storage')}
        />
      )}

      {(ro.payment_type === 'insurance' || ro.claim_number || ro.insurance_claim_number) && (
        <InsurancePanel roId={id} ro={ro} onUpdated={() => { load(); loadEstimateImport() }} />
      )}

      {(ro.payment_type === 'insurance' || ro.claim_number || ro.insurance_claim_number) && (
        <ClaimTrackerPanel roId={id} canEdit={!userIsAssistant} />
      )}

      <div className="bg-panel border border-line-2 rounded-instrument p-5 space-y-4">
        <h3 className="font-semibold text-ink text-sm flex items-center gap-2">
          Insurance Adjustor
        </h3>
        {!claimLink ? (
          <div>
            <p className="text-xs text-faint mb-3">Generate a secure link to share with the insurance adjustor. They can view the RO details and submit their assessment without creating an account.</p>
            <button onClick={generateClaimLink} disabled={generatingLink} className="bg-brand hover:bg-brand-lit text-on-brand text-xs font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
              {generatingLink ? 'Generating...' : 'Generate Adjustor Link'}
            </button>
          </div>
        ) : claimLink.submitted_at ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-good text-xs font-medium"><CheckCircle size={14} /> Assessment Received</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div><span className="text-faint">Adjustor</span><p className="text-ink">{claimLink.adjustor_name} — {claimLink.adjustor_company}</p></div>
              <div><span className="text-faint">Submitted</span><p className="text-ink">{new Date(claimLink.submitted_at).toLocaleDateString()}</p></div>
              <div><span className="text-faint">Approved Labor</span><p className="font-mono tabular-nums text-gold">${(claimLink.approved_labor||0).toLocaleString()}</p></div>
              <div><span className="text-faint">Approved Parts</span><p className="font-mono tabular-nums text-gold">${(claimLink.approved_parts||0).toLocaleString()}</p></div>
              {claimLink.supplement_amount > 0 && <div><span className="text-faint">Supplement</span><p className="font-mono font-medium tabular-nums text-gold">${claimLink.supplement_amount.toLocaleString()}</p></div>}
              {claimLink.adjustor_notes && <div className="col-span-2"><span className="text-faint">Notes</span><p className="text-ink">{claimLink.adjustor_notes}</p></div>}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-faint">Link sent — waiting for adjustor assessment.</p>
            <div className="flex gap-2">
              <button onClick={copyClaimLink} className="bg-void border border-line-2 text-ink text-xs px-3 py-2 rounded-lg hover:border-brand transition-colors flex items-center gap-1.5">
                <Copy size={13} />
                {linkCopied ? 'Copied!' : 'Copy Link'}
              </button>
              <button onClick={generateClaimLink} className="text-faint text-xs px-3 py-2 rounded-lg hover:text-ink transition-colors">
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {overviewTab === 'core' && userIsAdmin && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3">🔒 Internal Notes</h2>
          <form onSubmit={submitInternalNote} className="space-y-2 mb-3">
            <textarea
              rows={3}
              value={internalNoteText}
              onChange={(e) => setInternalNoteText(e.target.value)}
              placeholder="Add private staff note..."
              className={`${inp} w-full`}
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingInternalNote}
                className="text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {savingInternalNote ? 'Adding...' : 'Add Note'}
              </button>
            </div>
          </form>

          {internalNotes.length === 0 ? (
            <p className="text-sm text-faint">No internal notes yet.</p>
          ) : (
            <div className="space-y-2">
              {internalNotes.map((entry) => (
                <div key={entry.id} className="bg-void border border-line-2 rounded-instrument p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[11px] text-muted">
                      {new Date(entry.created_at).toLocaleString()} · {entry.author_name || 'Unknown'}
                    </div>
                    {userIsAdmin && (
                      <button
                        type="button"
                        onClick={() => deleteInternalNote(entry.id)}
                        disabled={deletingInternalNote === entry.id}
                        className="text-crit hover:text-crit disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-ink whitespace-pre-wrap">{entry.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SMS Thread */}
      {overviewTab === 'communication' && (
      <div className="bg-panel rounded-instrument border border-line-2 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
            <MessageSquare size={13} /> Customer Text Messages
          </h2>
          {smsThread.some(m => m.direction === 'inbound') && (
            <span className="text-[10px] bg-brand text-on-brand px-2 py-0.5 rounded-full font-semibold">
              {smsThread.filter(m => m.direction === 'inbound').length} reply
            </span>
          )}
        </div>

        {/* Phone input */}
        <div className="mb-3 flex items-center gap-2">
          <input
            type="tel"
            placeholder="Customer phone (e.g. +13015550123)"
            value={smsCustomerPhone}
            onChange={e => setSmsCustomerPhone(e.target.value)}
            className="flex-1 text-xs bg-void border border-line-2 rounded-lg px-3 py-2 text-ink placeholder:text-faint focus:outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={loadSmsThread}
            disabled={smsLoading}
            className="text-xs text-muted hover:text-ink border border-line-2 rounded-lg px-2 py-2"
          >
            <RefreshCw size={13} className={smsLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Thread messages */}
        <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
          {smsThread.length === 0 && !smsLoading && (
            <p className="text-xs text-faint italic">No messages yet. Send the first text below.</p>
          )}
          {smsThread.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-instrument px-3 py-2 text-sm ${
                  msg.direction === 'outbound'
                    ? 'bg-brand text-on-brand rounded-br-sm'
                    : 'bg-void border border-line-2 text-ink rounded-bl-sm'
                }`}
              >
                <p className="whitespace-pre-wrap leading-snug">{msg.body}</p>
                <p className={`text-[10px] mt-1 ${msg.direction === 'outbound' ? 'text-brand' : 'text-faint'}`}>
                  {msg.direction === 'inbound' ? '← Customer' : '→ Sent'} · {new Date(msg.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Compose */}
        <form onSubmit={sendSmsMessage} className="flex gap-2">
          <textarea
            rows={2}
            placeholder="Type a message to the customer..."
            value={smsMessage}
            onChange={e => setSmsMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSmsMessage(e) } }}
            className="flex-1 text-sm bg-void border border-line-2 rounded-lg px-3 py-2 text-ink placeholder:text-faint focus:outline-none focus:border-brand resize-none"
          />
          <button
            type="submit"
            disabled={smsSending || !smsMessage.trim() || !smsCustomerPhone.trim()}
            className="self-end px-3 py-2 bg-brand hover:bg-brand-lit disabled:opacity-50 text-on-brand rounded-lg text-xs font-semibold flex items-center gap-1"
          >
            <Phone size={13} /> {smsSending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
      )}

      {/* Photos */}
      {overviewTab === 'photos' && <ROPhotos roId={ro.id} isAdmin={userIsAdmin} canDelete={!userIsAssistant} />}

      {/* Assigned Tech */}
      {overviewTab === 'core' && userIsEmployee && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <User size={12} /> {t('ro.technician')}
          </h2>
          {techAssignmentMismatch && (
            <div className="mb-3 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs text-brand">
              You are not the currently assigned tech on this RO. You can still update assignment, and admin will be notified.
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-ink font-medium">
              {ro.assigned_tech ? ro.assigned_tech.name : <span className="text-faint italic">Unassigned</span>}
            </span>
            {!userIsAssistant && (
              <select
                value={ro.assigned_to || ''}
                onChange={e => assignTech(e.target.value)}
                className="bg-void border border-line-2 rounded-lg px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-brand"
              >
                <option value="">Unassigned</option>
                {shopUsers
                  .filter(u => ['owner', 'admin', 'technician', 'employee', 'staff'].includes(u.role))
                  .map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Job Operations — multi-tech assignment */}
      {overviewTab === 'core' && userIsEmployee && (
        <ROOperations
          roId={ro.id}
          technicians={shopUsers.filter(u => ['owner', 'admin', 'technician', 'employee', 'staff'].includes(u.role))}
          readOnly={userIsAssistant}
        />
      )}

      {/* Tech Notes */}
      {overviewTab === 'core' && userIsEmployee && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
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
          {savingNotes && <p className="text-[10px] text-faint mt-1">Saving...</p>}
        </div>
      )}

      {overviewTab === 'communication' && (
      <div className="bg-panel rounded-instrument border border-line-2 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
            <MessageSquare size={12} /> Communication Log
          </h2>
          <button
            onClick={() => setShowCommForm(true)}
            className="text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            Log Communication
          </button>
        </div>

        {comms.length === 0 ? (
          <p className="text-faint text-sm">No communication entries yet.</p>
        ) : (
          <div className="space-y-2">
            {comms.map((entry) => {
              const meta = COMM_TYPE_META[entry.channel] || COMM_TYPE_META.call
              const Icon = meta.Icon
              return (
                <div key={entry.id} className="bg-void border border-line-2 rounded-instrument p-3">
                  <div className="flex items-center gap-2 text-xs text-muted mb-1">
                    <Icon size={12} className="text-brand" />
                    <span className="text-ink font-medium">{meta.label}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                      entry.direction === 'inbound'
                        ? 'bg-good/10 text-good border-good/40'
                        : 'bg-brand/10 text-brand border-brand/40'
                    }`}>
                      {entry.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                    </span>
                    <span>·</span>
                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                    <span>·</span>
                    <span>{entry.logged_by || 'System'}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-ink whitespace-pre-wrap">{entry.summary}</p>
                    {!userIsAssistant && (
                      <button
                        type="button"
                        onClick={() => deleteComm(entry.id)}
                        className="text-faint hover:text-crit transition-colors"
                        title="Delete communication entry"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* Parts Requests */}
      {overviewTab === 'parts' && userIsEmployee && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
              <Package size={12} /> Parts Requests
            </h2>
            <button
              onClick={() => setShowPartsReqForm(s => !s)}
              className="flex items-center gap-1.5 text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={12} /> Request Part
            </button>
          </div>

          {showPartsReqForm && (
            <form onSubmit={submitPartsRequest} className="bg-void rounded-instrument p-4 border border-line-2 mb-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-faint block mb-1">Part Name *</label>
                  <input
                    className={inp + ' w-full'}
                    required
                    value={partsReqForm.part_name}
                    onChange={e => setPartsReqForm(f => ({ ...f, part_name: e.target.value }))}
                    placeholder="Front bumper cover"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-faint block mb-1">Part Number</label>
                  <input
                    className={inp + ' w-full'}
                    value={partsReqForm.part_number}
                    onChange={e => setPartsReqForm(f => ({ ...f, part_number: e.target.value }))}
                    placeholder="OEM-12345"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-faint block mb-1">Qty</label>
                  <input
                    type="number"
                    min="1"
                    className={inp + ' w-full'}
                    value={partsReqForm.quantity}
                    onChange={e => setPartsReqForm(f => ({ ...f, quantity: +e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-faint block mb-1">Notes</label>
                  <input
                    className={inp + ' w-full'}
                    value={partsReqForm.notes}
                    onChange={e => setPartsReqForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="OEM only, urgent, etc."
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowPartsReqForm(false)} className="flex-1 bg-panel text-muted rounded-lg py-2 text-xs border border-line-2">Cancel</button>
                <button type="submit" disabled={submittingPartsReq} className="flex-1 bg-brand hover:bg-brand-lit text-on-brand font-semibold rounded-lg py-2 text-xs disabled:opacity-50">
                  {submittingPartsReq ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          )}

          {partsRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 border border-dashed border-line-2 rounded-instrument">
              <Package size={24} className="text-faint mb-2" />
              <p className="text-faint text-sm">No parts requested yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {partsRequests.map(req => {
                const meta = REQ_STATUS_META[req.status] || REQ_STATUS_META.pending
                const Icon = meta.Icon
                return (
                  <div key={req.id} className="flex items-start gap-3 bg-void rounded-instrument p-3 border border-line-2">
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.cls}`}>
                      <Icon size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-ink font-medium">{req.part_name}</span>
                        {req.part_number && <span className="text-[10px] text-faint">#{req.part_number}</span>}
                        {req.quantity > 1 && <span className="text-[10px] text-faint">× {req.quantity}</span>}
                      </div>
                      {req.notes && <p className="text-[10px] text-faint mt-0.5">{req.notes}</p>}
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

      {/* Customer Updates + Links */}
      {overviewTab === 'communication' && (
      <div className="bg-panel rounded-instrument border border-line-2 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
              <Smartphone size={12} /> Customer Updates
            </h2>
            <p className="text-xs text-faint mt-0.5">
              No customer portal account needed. Send direct tracking and payment links.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={generateCustomerLinks}
              disabled={sendingCustomerLinks}
              className="flex items-center gap-1.5 bg-brand hover:bg-brand-lit text-on-brand text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {sendingCustomerLinks ? 'Sending...' : 'Send Tracking Link'}
            </button>
            <button
              onClick={generatePaymentLinkOnly}
              disabled={generatingPaymentLink}
              className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50"
            >
              {generatingPaymentLink ? 'Generating...' : 'Generate Payment Link'}
            </button>
          </div>
        </div>

        {!ro.customer?.phone && (
          <p className="flex items-center gap-1.5 text-xs text-crit">
            <AlertTriangle size={12} /> No customer phone on file. Add a phone number to send SMS links.
          </p>
        )}
        {!ro.customer?.email && (
          <p className="flex items-center gap-1.5 text-xs text-crit">
            <AlertTriangle size={12} /> No customer email on file. Auto invoice emails require customer email.
          </p>
        )}

        {trackingLink && (
          <div className="bg-void border border-line-2 rounded-lg p-3">
            <p className="text-[11px] text-faint mb-2">Tracking Link</p>
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                readOnly
                value={trackingLink}
                className="flex-1 bg-transparent text-xs text-ink font-mono truncate"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(trackingLink)
                  setLinkCopied(true)
                  setTimeout(() => setLinkCopied(false), 3000)
                }}
                className="text-xs text-brand hover:text-brand flex items-center gap-1"
              >
                {linkCopied ? <><CheckCircle size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        )}

        {paymentLink && (
          <div className="bg-void border border-line-2 rounded-lg p-3">
            <p className="text-[11px] text-faint mb-2">Payment Link</p>
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                readOnly
                value={paymentLink}
                className="flex-1 bg-transparent text-xs text-ink font-mono truncate"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(paymentLink)
                  setLinkCopied(true)
                  setTimeout(() => setLinkCopied(false), 3000)
                }}
                className="text-xs text-brand hover:text-brand flex items-center gap-1"
              >
                {linkCopied ? <><CheckCircle size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {showCommForm && (
        <AppOverlay label="Log communication" onClose={() => setShowCommForm(false)} className="bg-black/50 p-4">
          <form onSubmit={submitComm} className="w-full max-w-lg bg-panel border border-line-2 rounded-instrument p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-ink font-semibold text-sm">Log Communication</h3>
              <button
                type="button"
                onClick={() => setShowCommForm(false)}
                className="text-faint hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="text-[11px] text-faint block mb-1">Channel</label>
              <select
                value={commForm.channel}
                onChange={(e) => setCommForm((f) => ({ ...f, channel: e.target.value }))}
                className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand"
              >
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="in-person">In Person</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-faint block mb-1">Direction</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCommForm((f) => ({ ...f, direction: 'outbound' }))}
                  className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border ${
                    commForm.direction === 'outbound'
                      ? 'bg-brand/10 text-brand border-brand/40'
                      : 'bg-void text-muted border-line-2'
                  }`}
                >
                  Outbound
                </button>
                <button
                  type="button"
                  onClick={() => setCommForm((f) => ({ ...f, direction: 'inbound' }))}
                  className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border ${
                    commForm.direction === 'inbound'
                      ? 'bg-good/10 text-good border-good/40'
                      : 'bg-void text-muted border-line-2'
                  }`}
                >
                  Inbound
                </button>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-faint block mb-1">Summary</label>
              <textarea
                rows={4}
                value={commForm.summary}
                onChange={(e) => setCommForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="Communication summary..."
                className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCommForm(false)}
                className="flex-1 bg-void border border-line-2 text-ink py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingComm}
                className="flex-1 bg-brand hover:bg-brand-lit text-on-brand py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {savingComm ? 'Saving...' : 'Save Communication'}
              </button>
            </div>
          </form>
        </AppOverlay>
      )}

      {/* Mark as Paid Modal */}
      {showMarkPaidModal && (
        <AppOverlay label="Mark as paid" onClose={() => setShowMarkPaidModal(false)} className="bg-black/50 p-4">
          <div className="bg-panel border border-line-2 rounded-instrument p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign size={20} className="text-good" />
              <h2 className="text-lg font-bold text-ink">Mark as Paid</h2>
            </div>
            <p className="text-sm text-muted">Select payment method and confirm. This will mark the RO as paid and close it.</p>
            <div className="space-y-2">
              <label className="text-xs text-faint block">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-good"
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
                className="flex-1 bg-raised text-ink text-sm font-medium px-4 py-2 rounded-lg hover:bg-raised transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={markPaid}
                disabled={markingPaid}
                className="flex-1 bg-good hover:bg-good text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {markingPaid ? 'Processing...' : <>
                  <DollarSign size={14} /> Mark Paid
                </>}
              </button>
            </div>
          </div>
        </AppOverlay>
      )}

      {showTotalLossModal && (
        <AppOverlay label="Mark total loss" onClose={() => !markingTotalLoss && setShowTotalLossModal(false)} className="bg-black/50 p-4">
          <div className="bg-panel border border-crit/60 rounded-instrument p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={20} className="text-crit" />
              <h2 className="text-lg font-bold text-ink">Mark Total Loss</h2>
            </div>
            <p className="text-sm text-ink">
              This closes the RO immediately and skips parts, repair, paint, QC, and delivery. Financials stay editable for teardown, storage, and administrative charges.
            </p>
            <div className="space-y-2">
              <label htmlFor="total-loss-note" className="text-xs text-faint block">Internal Note</label>
              <textarea
                id="total-loss-note"
                value={totalLossNote}
                onChange={e => setTotalLossNote(e.target.value)}
                rows={3}
                className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crit"
                placeholder="Optional reason or claim note"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowTotalLossModal(false)}
                disabled={markingTotalLoss}
                className="flex-1 bg-raised text-ink text-sm font-medium px-4 py-2 rounded-lg hover:bg-raised transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={markTotalLoss}
                disabled={markingTotalLoss}
                className="flex-1 bg-crit hover:bg-crit text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {markingTotalLoss ? 'Closing...' : <>
                  <AlertTriangle size={14} /> Confirm Total Loss
                </>}
              </button>
            </div>
          </div>
        </AppOverlay>
      )}

      {/* Parts Tracking */}
      {overviewTab === 'parts' && (
      <div className="bg-panel rounded-instrument border border-line-2 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package size={15} className="text-brand" />
            <h2 className="text-xs font-bold text-muted uppercase tracking-wide">{t('ro.parts')}</h2>
            {parts.filter(p => p.status === 'backordered').length > 0 && (
              <span className="text-[10px] bg-crit/15 text-crit border border-crit/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <AlertTriangle size={11} /> {parts.filter(p=>p.status==='backordered').length} backordered
              </span>
            )}
            {parts.length > 0 && parts.every(p=>p.status==='received') && (
              <span className="text-[10px] bg-good/15 text-good border border-good/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <CheckCircle size={11} /> All parts in
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCatalogSearch(true)}
              className="flex items-center gap-1.5 text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Search size={12} /> Search Catalog
            </button>
            <button onClick={() => setShowAddPart(s=>!s)}
              className="flex items-center gap-1.5 text-xs bg-brand hover:bg-brand-lit text-on-brand font-semibold px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={12}/> {t('common.add')} {t('ro.parts')}
            </button>
          </div>
        </div>

        {/* Add Part Form */}
        {showAddPart && (
          <form onSubmit={addPart} className="bg-void rounded-instrument p-4 border border-line-2 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="sm:col-span-2">
                <label className="text-[10px] text-faint block mb-1">Part Name *</label>
                <input className={inp} required value={partForm.part_name} onChange={e=>setPartForm(f=>({...f,part_name:e.target.value}))} placeholder="Front bumper assembly" />
              </div>
              <div>
                <label className="text-[10px] text-faint block mb-1">Part Number</label>
                <input className={inp} value={partForm.part_number} onChange={e=>setPartForm(f=>({...f,part_number:e.target.value}))} placeholder="OEM-12345" />
              </div>
              <div>
                <label className="text-[10px] text-faint block mb-1">Vendor</label>
                <LibraryAutocomplete
                  value={partForm.vendor || ''}
                  onChange={v => setPartForm(f => ({...f, vendor: v}))}
                  onSelect={v => setPartForm(f => ({...f, vendor: v.name}))}
                  searchFn={searchVendors}
                  placeholder="LKQ, NAPA, PPG..."
                  renderItem={v => (
                    <div>
                      <div className="text-xs text-ink font-medium">{v.name}</div>
                      <div className="text-[10px] text-muted">{v.type}{v.phone ? ` · ${v.phone}` : ''}</div>
                    </div>
                  )}
                />
              </div>
              <div>
                <label className="text-[10px] text-faint block mb-1">Expected Date</label>
                <input type="date" className={inp} value={partForm.expected_date} onChange={e=>setPartForm(f=>({...f,expected_date:e.target.value}))} />
              </div>
              <div>
                <label className="text-[10px] text-faint block mb-1">Qty</label>
                <input type="number" min="1" className={inp} value={partForm.quantity} onChange={e=>setPartForm(f=>({...f,quantity:e.target.value}))} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] text-faint block mb-1">Tracking Number (optional — UPS / FedEx / USPS / DHL)</label>
                <input className={inp} value={partForm.tracking_number} onChange={e=>setPartForm(f=>({...f,tracking_number:e.target.value}))} placeholder="1Z999AA10123456784 or 94001116990045349715" />
                <p className="text-[9px] text-faint mt-0.5">Carrier is auto-detected. Status updates automatically when you have a tracking API key in Settings.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={()=>setShowAddPart(false)} className="flex-1 bg-panel text-muted rounded-lg py-2 text-xs border border-line-2">Cancel</button>
              <button type="submit" disabled={savingPart} className="flex-1 bg-brand hover:bg-brand-lit text-on-brand font-semibold rounded-lg py-2 text-xs disabled:opacity-50">
                {savingPart ? 'Adding...' : 'Add Part'}
              </button>
            </div>
          </form>
        )}

        {parts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed border-line-2 rounded-instrument">
            <img src="/empty-parts.png" alt="No parts ordered" className="w-40 h-40 opacity-80 object-contain" />
            <p className="text-muted text-sm font-medium">Parts board is clear.</p>
            <p className="text-faint text-xs">No parts ordered yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-line-2 rounded-instrument">
            <table className="w-full text-xs">
              <thead className="bg-void text-muted uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Part #</th>
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-left font-semibold">Brand</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Unit Cost</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => {
                  const meta = PART_STATUS_META[p.status] || PART_STATUS_META.ordered
                  const qty = Number(p.quantity || 0)
                  const unit = Number(p.unit_cost || 0)
                  const rowTotal = qty * unit

                  return (
                    <tr key={p.id} className="border-t border-line-2 align-top">
                      <td className="px-3 py-2 text-ink font-mono">{p.part_number || '—'}</td>
                      <td className="px-3 py-2 text-ink">
                        <div className="font-medium">{p.part_name || '—'}</div>
                        {p.tracking_number && (
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-faint flex-wrap">
                            <Truck size={10} className="text-faint" />
                            <span>{CARRIER_LABELS[p.carrier] || 'Track'}: {p.tracking_number}</span>
                            {p.tracking_status && TRACKING_META[p.tracking_status] && (
                              <span className={`font-semibold ${TRACKING_META[p.tracking_status].cls}`}>
                                {TRACKING_META[p.tracking_status].label}
                              </span>
                            )}
                            <a
                              href={`/api/tracking/url?carrier=${p.carrier||''}&num=${encodeURIComponent(p.tracking_number)}`}
                              target="_blank"
                              rel="noopener"
                              onClick={(e) => {
                                e.preventDefault()
                                api.get(`/tracking/url?carrier=${p.carrier||''}&num=${encodeURIComponent(p.tracking_number)}`).then(r => window.open(r.data.url, '_blank'))
                              }}
                              className="text-brand hover:text-brand inline-flex items-center gap-0.5"
                            >
                              <ExternalLink size={9} /> Track
                            </a>
                            <button
                              onClick={() => refreshTracking(p.id)}
                              disabled={refreshingPart === p.id}
                              className="inline-flex items-center gap-0.5 text-faint hover:text-brand disabled:opacity-50"
                            >
                              <RefreshCw size={9} className={refreshingPart === p.id ? 'animate-spin' : ''} /> Refresh
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink">{p.vendor || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{qty || 1}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-gold">${unit.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-gold">${rowTotal.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === 'ordered' && (
                            <>
                              <button onClick={()=>updatePartStatus(p.id,'backordered')} className="text-[10px] bg-crit/10 text-crit border border-crit/40 px-2 py-1 rounded-lg hover:bg-crit/20 transition-colors">Backorder</button>
                              <button onClick={()=>updatePartStatus(p.id,'received')} className="text-[10px] bg-good/10 text-good border border-good/40 px-2 py-1 rounded-lg hover:bg-good/20 transition-colors">Received</button>
                            </>
                          )}
                          {p.status === 'backordered' && (
                            <button onClick={()=>updatePartStatus(p.id,'received')} className="text-[10px] bg-good/10 text-good border border-good/40 px-2 py-1 rounded-lg hover:bg-good/20 transition-colors inline-flex items-center gap-1">Received <CheckCircle size={10} /></button>
                          )}
                          <button onClick={()=>deletePart(p.id)} className="text-faint hover:text-crit transition-colors ml-1">
                            <X size={13}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-2 bg-void">
                  <td colSpan={5} className="px-3 py-2 text-right text-ink font-semibold">Parts Subtotal</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-gold">${partsSubtotal.toFixed(2)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      )}
      </>
      )}

      {showStorageBillModal && (
        <AppOverlay label="Bill storage" onClose={() => setShowStorageBillModal(false)} className="bg-black/60 p-4">
          <form onSubmit={billStorage} className="w-full max-w-md bg-panel border border-line-2 rounded-instrument p-5 space-y-3">
            <h3 className="text-ink font-semibold text-sm">Bill Storage</h3>
            <div>
              <label className="text-[11px] text-faint block mb-1">Days</label>
              <input type="number" min="1" required className={inp} value={billingStorage.days} onChange={(e) => setBillingStorage((f) => ({ ...f, days: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] text-faint block mb-1">Rate Per Day</label>
              <input type="number" min="0" step="0.01" required className={inp} value={billingStorage.rate_per_day} onChange={(e) => setBillingStorage((f) => ({ ...f, rate_per_day: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] text-faint block mb-1">Billed To</label>
              <input className={inp} value={billingStorage.billed_to} onChange={(e) => setBillingStorage((f) => ({ ...f, billed_to: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] text-faint block mb-1">Notes</label>
              <textarea rows={2} className={inp} value={billingStorage.notes} onChange={(e) => setBillingStorage((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="font-mono text-sm font-semibold tabular-nums text-gold">
              Total: ${(Number(billingStorage.days || 0) * Number(billingStorage.rate_per_day || 0)).toFixed(2)}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowStorageBillModal(false)} className="flex-1 bg-void border border-line-2 text-ink py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button type="submit" disabled={billingStorageSaving} className="flex-1 bg-gold hover:bg-gold-lit text-on-gold py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                {billingStorageSaving ? 'Saving...' : 'Create Charge'}
              </button>
            </div>
          </form>
        </AppOverlay>
      )}

      {showCatalogSearch && (
        <PartsSearch
          roId={id}
          initialVehicle={ro.vehicle || {}}
          onClose={() => setShowCatalogSearch(false)}
          onPartAdded={handleCatalogPartAdded}
        />
      )}
    </div>
  )
}
