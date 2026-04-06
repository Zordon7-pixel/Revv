import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Save, X, Package, PackageCheck, PackageX, Plus, CheckCircle, AlertCircle, Clock, Truck, RefreshCw, ExternalLink, Car, DollarSign, ClipboardList, Smartphone, AlertTriangle, Copy, Printer, User, Phone, MessageSquare, Mail, Users, CreditCard, Search, Camera, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../lib/api'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'
import StatusBadge from '../components/StatusBadge'
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
import ROOperations from '../components/ROOperations'
import ClaimTrackerPanel from '../components/ClaimTrackerPanel'
import { optimizeImageForUpload } from '../lib/imageUpload'

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
  sms: { label: 'SMS', Icon: MessageSquare },
  text: { label: 'SMS', Icon: MessageSquare },
  email: { label: 'Email', Icon: Mail },
  'in-person': { label: 'In Person', Icon: Users },
}

const SUPP_STATUS_META = {
  Pending:  { cls: 'text-amber-400 bg-amber-900/30 border-amber-700/40' },
  Approved: { cls: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40' },
  Denied:   { cls: 'text-red-400 bg-red-900/30 border-red-700/40' },
}

const AUDIT_PRIORITY_META = {
  HIGH: { emoji: '🔴', cls: 'text-red-300 border-red-700/40 bg-red-900/20' },
  MEDIUM: { emoji: '🟡', cls: 'text-amber-300 border-amber-700/40 bg-amber-900/20' },
  LOW: { emoji: '🟢', cls: 'text-emerald-300 border-emerald-700/40 bg-emerald-900/20' },
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
  const [preDropoffExpanded, setPreDropoffExpanded] = useState(true)
  const [preDropoffLightbox, setPreDropoffLightbox] = useState(null)
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
      alert(err?.response?.data?.error || 'Could not add part')
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
    try {
      await api.put(`/parts/${partId}`, { status }); load()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not update part status')
    }
  }

  async function deletePart(partId) {
    try {
      await api.delete(`/parts/${partId}`); load()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete part')
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
      alert('Error generating link')
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
      alert('Could not copy link — clipboard access denied')
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
      alert(e?.response?.data?.error || 'Could not generate tracking link')
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
      alert(e?.response?.data?.error || 'Could not generate payment link')
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
        alert(err?.response?.data?.error || 'Failed to advance status')
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

  async function save() {
    setSaving(true)
    try {
      const roPayload = {
        parts_cost: +form.parts_cost || 0,
        labor_cost: +form.labor_cost || 0,
        sublet_cost: +form.sublet_cost || 0,
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
      alert(err?.response?.data?.error || 'Could not assign technician')
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
      alert('No customer linked to this RO.')
      return
    }
    if (!customerForm.name.trim()) {
      alert('Customer name is required.')
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
      alert('Customer updated.')
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not update customer')
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
      alert(err?.response?.data?.error || 'Could not submit request')
    } finally {
      setSubmittingPartsReq(false)
    }
  }

  async function updatePartsReqStatus(reqId, status) {
    try {
      await api.patch(`/parts-requests/${reqId}`, { status })
      loadPartsRequests()
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to update parts request')
    }
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
    if (!commForm.summary.trim()) return
    setSavingComm(true)
    try {
      await api.post(`/comms/ro/${id}`, commForm)
      setCommForm({ channel: 'call', direction: 'outbound', summary: '' })
      setShowCommForm(false)
      loadComms()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not log communication')
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
      alert(err?.response?.data?.error || 'Could not delete communication entry')
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
      alert(err?.response?.data?.error || 'Could not save internal note')
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
      alert(err?.response?.data?.error || 'Could not send text message')
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
      alert(err?.response?.data?.error || 'Could not delete note')
    } finally {
      setDeletingInternalNote(null)
    }
  }

  async function uploadPreDropoffPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPreDropoffUploading(true)
    try {
      const preparedFile = await optimizeImageForUpload(file, {
        maxDimension: 2048,
        targetBytes: 3 * 1024 * 1024,
      })
      const fd = new FormData()
      fd.append('photo', preparedFile)
      await api.post(`/photos/ro/${id}/predropoff`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      loadPreDropoffPhotos()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not upload photo')
    } finally {
      setPreDropoffUploading(false)
      e.target.value = ''
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
      alert(err?.response?.data?.error || 'Could not add supplement')
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
      alert(err?.response?.data?.error || 'Could not update supplement')
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
      alert(err?.response?.data?.error || 'Could not start inspection')
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
      alert(err?.response?.data?.error || 'Could not update storage settings')
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
      alert(err?.response?.data?.error || 'Could not create storage charge')
    } finally {
      setBillingStorageSaving(false)
    }
  }

  async function markStorageChargePaid(chargeId) {
    try {
      await api.patch(`/storage/${id}/charges/${chargeId}`)
      await loadStorageCharges()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not mark charge as paid')
    }
  }

  if (!ro) return <div className="flex items-center justify-center h-64 text-slate-500">{t('common.loading')}</div>

  const currentIdx = STAGES.indexOf(ro.status)
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
      ? { label: 'Viewed', cls: 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' }
      : latestInspection.status === 'sent'
        ? { label: 'Sent', cls: 'bg-blue-900/30 border-blue-700/40 text-blue-300' }
        : { label: 'Draft', cls: 'bg-yellow-900/30 border-yellow-700/40 text-yellow-300' }
    : { label: 'No Inspection', cls: 'bg-slate-900/30 border-slate-700/40 text-slate-300' }
  const showStripePanel = (ro.status === 'delivery' || ro.status === 'closed') && paymentStatus === 'unpaid'
  const daysIn = ro.intake_date ? Math.floor((Date.now() - new Date(ro.intake_date)) / 86400000) : 0
  const daysColor = daysIn > 14 ? 'text-red-400' : daysIn > 7 ? 'text-yellow-400' : 'text-emerald-400'
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
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'
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
      alert(err?.response?.data?.error || 'Could not update notes')
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
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-[#2a2d3e] bg-[#161a2b] p-4 sm:p-5 shadow-[0_12px_40px_rgba(2,6,23,0.35)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_20%,rgba(59,130,246,0.16),transparent_40%),radial-gradient(circle_at_86%_78%,rgba(16,185,129,0.12),transparent_46%)]" />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <button
              onClick={() => navigate('/ros')}
              className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#2f344a] bg-[#111526] text-slate-300 transition-colors hover:border-indigo-400/60 hover:text-white"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Repair Order</p>
              <h1 className="text-xl font-bold text-white">{ro.ro_number}</h1>
              <p className="text-sm text-slate-400 truncate">{ro.vehicle?.year} {ro.vehicle?.make} {ro.vehicle?.model} · {ro.customer?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border border-[#334155] bg-[#0f1322] ${daysColor}`}>{daysIn}d in shop</span>
            {ro.status === 'closed' && (
              <span className="flex items-center gap-1.5 text-slate-300 text-xs font-bold bg-slate-700/60 border border-slate-600 px-3 py-1.5 rounded-lg tracking-wide">TICKET CLOSED</span>
            )}
            {!hideHeaderFinancialForTech && <StatusBadge status={ro.status} />}
            {!hideHeaderFinancialForTech && <PaymentStatusBadge status={paymentStatus} paymentReceived={ro.payment_received} />}
            {ro.payment_received === 1 && (
              <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium bg-emerald-900/30 border border-emerald-700/40 px-3 py-1.5 rounded-lg">
                <CheckCircle size={12} /> Paid {ro.payment_received_at && `· ${new Date(ro.payment_received_at).toLocaleDateString()}`}
              </span>
            )}
            {ro.status === 'estimate_sent' && !ro.estimate_approved_at && !userIsAssistant && (
              <button onClick={approveEstimate} disabled={approvingEstimate} className="w-full sm:w-auto flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                <CheckCircle size={12} /> {approvingEstimate ? 'Approving...' : `${t('portal.approveBtn')} ${t('ro.estimate')}`}
              </button>
            )}
            {ro.status === 'estimate' && !userIsAssistant && (
              <button
                onClick={sendForApproval}
                disabled={sendingForApproval}
                className="w-full sm:w-auto flex items-center justify-center gap-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <Mail size={12} /> {sendingForApproval ? 'Generating Link...' : 'Send for Approval'}
              </button>
            )}
            {!ro.payment_received && canMarkPaymentFromRo && (
              <button onClick={() => setShowMarkPaidModal(true)} className="w-full sm:w-auto flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <DollarSign size={12} /> {t('ro.paymentReceived')}
              </button>
            )}
            {canStepBack && (
              <button onClick={goBack} className="w-full sm:w-auto flex items-center justify-center gap-1 bg-slate-600 hover:bg-slate-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <ArrowLeft size={12} /> ← Back
              </button>
            )}
            {canAdvance && (
              <button onClick={advance} className="w-full sm:w-auto flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                → {STATUS_LABELS[STAGES[currentIdx+1]]}
              </button>
            )}
            {ro.status === 'delivery' && !userIsAssistant && (
              <button
                onClick={async () => {
                  if (!window.confirm('Close this ticket and mark vehicle as delivered?')) return
                  await api.put(`/ros/${id}/status`, { status: 'closed' })
                  load()
                }}
                className="w-full sm:w-auto flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <CheckCircle size={12} /> Mark Delivered &amp; Close Ticket
              </button>
            )}
            <button onClick={() => window.open(`/invoice/${id}`, '_blank')}
              className="w-full sm:w-auto flex items-center justify-center gap-1 bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
              <Printer size={12} /> {t('ro.invoice')}
            </button>
            {canEditRo && (!editing
              ? <button onClick={() => setEditing(true)} className="w-full sm:w-auto flex items-center justify-center gap-1 bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                  <Pencil size={12} /> {t('common.edit')}
                </button>
              : <div className="flex gap-1 w-full sm:w-auto">
                  <button onClick={save} disabled={saving} className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    <Save size={12} /> {saving ? 'Saving...' : t('common.save')}
                  </button>
                  <button onClick={() => { setEditing(false); setForm(buildFormFromRo(ro)) }} className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-1 bg-[#2a2d3e] text-slate-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    <X size={12} />
                  </button>
                </div>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-1 flex items-center gap-1 w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${activeTab === 'overview' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('storage')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${activeTab === 'storage' ? 'bg-amber-400 text-[#0f1117]' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Storage Hold
        </button>
      </div>
      </div>

      {activeTab === 'storage' && (
        <div className="space-y-4">
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Storage Hold</h2>
                <p className="text-xs text-slate-500">Track rental vehicle storage and billing.</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={!!storageForm.storage_hold}
                  disabled={userIsAssistant || storageSaving}
                  onChange={(e) => toggleStorageHold(e.target.checked)}
                  className="accent-amber-400"
                />
                This vehicle is in storage hold
              </label>
            </div>

            {storageForm.storage_hold && (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Rental Company</label>
                    <input className={inp} value={storageForm.storage_company} onChange={(e) => setStorageForm((f) => ({ ...f, storage_company: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Contact</label>
                    <input className={inp} value={storageForm.storage_contact} onChange={(e) => setStorageForm((f) => ({ ...f, storage_contact: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Daily Rate</label>
                    <input type="number" min="0" step="0.01" className={inp} value={storageForm.storage_rate_per_day} onChange={(e) => setStorageForm((f) => ({ ...f, storage_rate_per_day: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Storage Start Date</label>
                    <input type="date" className={inp} value={storageForm.storage_start_date || ''} onChange={(e) => setStorageForm((f) => ({ ...f, storage_start_date: e.target.value }))} disabled={userIsAssistant} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-slate-500 block mb-1">Notes</label>
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
                      className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-60"
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
                      className="text-xs bg-amber-400 hover:bg-amber-300 text-[#0f1117] font-semibold px-3 py-1.5 rounded-lg"
                    >
                      Bill Storage
                    </button>
                  )}
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
                    <div className="text-xs text-slate-500">Days Stored</div>
                    <div className="text-xl text-white font-bold mt-1">{storageDays}</div>
                  </div>
                  <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
                    <div className="text-xs text-slate-500">Total Accrued</div>
                    <div className="text-xl text-emerald-300 font-bold mt-1">${storageAccrued.toFixed(2)}</div>
                  </div>
                  <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
                    <div className="text-xs text-slate-500">Unpaid Charges</div>
                    <div className="text-xl text-amber-300 font-bold mt-1">${storageUnpaidTotal.toFixed(2)}</div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Storage Charges History</h3>
              <span className="text-xs text-slate-400">Total billed: ${storageBilledTotal.toFixed(2)}</span>
            </div>
            {storageCharges.length === 0 ? (
              <p className="text-sm text-slate-500">No storage charges yet.</p>
            ) : (
              <div className="overflow-x-auto border border-[#2a2d3e] rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-[#0f1117] text-slate-400">
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
                      <tr key={charge.id} className="border-t border-[#2a2d3e]">
                        <td className="px-3 py-2 text-slate-300">{charge.billed_date || '—'}</td>
                        <td className="px-3 py-2 text-slate-300">{charge.days}</td>
                        <td className="px-3 py-2 text-slate-300">${Number(charge.rate_per_day || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-white">${Number(charge.total_amount || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-slate-300">{charge.billed_to || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-1 rounded-full border ${charge.paid ? 'text-emerald-300 border-emerald-700/40 bg-emerald-900/20' : 'text-amber-300 border-amber-700/40 bg-amber-900/20'}`}>
                            {charge.paid ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!charge.paid && !userIsAssistant && (
                            <button
                              onClick={() => markStorageChargePaid(charge.id)}
                              className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-1 rounded"
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
      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-1 flex items-center gap-1 w-fit">
        <button
          onClick={() => setOverviewTab('core')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${overviewTab === 'core' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Core
        </button>
        <button
          onClick={() => setOverviewTab('insurance')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${overviewTab === 'insurance' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Insurance
        </button>
        <button
          onClick={() => setOverviewTab('customer')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${overviewTab === 'customer' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Customer
        </button>
        <button
          onClick={() => setOverviewTab('technician')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${overviewTab === 'technician' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Technician
        </button>
        <button
          onClick={() => setOverviewTab('parts')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${overviewTab === 'parts' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Parts
        </button>
        <button
          onClick={() => setOverviewTab('communication')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${overviewTab === 'communication' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-[#2a2d3e]'}`}
        >
          Communication
        </button>
      </div>

      {overviewTab === 'core' && (
        <>
      {approvalLink && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3 text-xs text-yellow-200">
          Approval link ready: <span className="font-mono break-all">{approvalLink}</span>
        </div>
      )}

      {/* Progress */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[640px] flex items-start justify-between gap-1">
            {STAGES.slice(0, -1).map((s, i) => {
              const isActive = i === currentIdx
              const isComplete = i < currentIdx
              const isFuture = i > currentIdx
              const canClick = !userIsAssistant && s !== ro.status && !(ro.status === 'closed' && !userIsAdmin)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    if (!canClick) return
                    api.put(`/ros/${id}/status`, { status: s }).then(() => load())
                  }}
                  disabled={!canClick}
                  className={`flex flex-col items-center gap-1.5 flex-1 min-w-0 group ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0 transition-all"
                    style={{
                      background: isActive || isComplete ? STATUS_COLORS[s] : '#2a2d3e',
                      boxShadow: isActive ? `0 0 0 2px white` : undefined,
                    }}
                  />
                  <span className={`text-[9px] text-center leading-tight ${isActive ? 'text-white font-semibold' : isFuture ? 'text-slate-600' : 'text-slate-400'}`}>
                    {STATUS_LABELS[s] || s}
                  </span>
                  {isActive && <span className="text-[8px] text-slate-500 text-center leading-tight">You are here</span>}
                </button>
              )
            })}
          </div>
        </div>
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
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Delivery Info</h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Date Delivered</label>
              {canEditRo ? (
                <input
                  type="date"
                  value={ro.actual_delivery || ''}
                  onChange={async (e) => {
                    await api.patch(`/ros/${id}`, { actual_delivery: e.target.value || null })
                    load()
                  }}
                  className="bg-[#0f1322] border border-[#2a2d3e] text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
                />
              ) : (
                <span className="text-sm text-slate-200">{ro.actual_delivery ? new Date(ro.actual_delivery + 'T12:00:00').toLocaleDateString() : '—'}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Picked Up By</label>
              <div className="flex gap-1">
                <button
                  disabled={!canEditRo}
                  onClick={async () => {
                    if (!canEditRo) return
                    await api.patch(`/ros/${id}`, { pickup_type: 'customer' })
                    load()
                  }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${(ro.pickup_type || 'customer') === 'customer' ? 'bg-indigo-600 text-white' : 'bg-[#2a2d3e] text-slate-400 hover:bg-[#3a3d4e]'} ${!canEditRo ? 'cursor-default' : ''}`}
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
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${ro.pickup_type === 'insurance' ? 'bg-blue-600 text-white' : 'bg-[#2a2d3e] text-slate-400 hover:bg-[#3a3d4e]'} ${!canEditRo ? 'cursor-default' : ''}`}
                >
                  Insurance
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Digital Inspection</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${inspectionStatusMeta.cls}`}>
              {inspectionStatusMeta.label}
            </span>
            {latestInspection?.status && (
              <span className="text-xs text-slate-500">
                Last updated {new Date(latestInspection.updated_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {latestInspection && (
            <button
              onClick={() => navigate(`/ros/${id}/inspection/${latestInspection.id}`)}
              className="text-xs bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-200 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Open Latest
            </button>
          )}
          <button
            onClick={startInspection}
            disabled={creatingInspection}
            className="text-xs bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {creatingInspection ? 'Starting...' : 'Start Inspection'}
          </button>
        </div>
      </div>

      {canViewPreDropoff && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <button
            type="button"
            onClick={() => setPreDropoffExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Camera size={12} /> Pre-Dropoff Condition
            </h2>
            <span className="text-slate-500">
              {preDropoffExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          <p className="text-xs text-slate-500 mt-2">
            These photos document vehicle condition before work begins
          </p>

          {preDropoffExpanded && (
            <div className="mt-3 space-y-3">
              {canUploadPreDropoff && (
                <label
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                    preDropoffUploading
                      ? 'bg-indigo-800 text-indigo-300 opacity-50 pointer-events-none'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  <Camera size={12} /> {preDropoffUploading ? 'Uploading...' : 'Upload Pre-Dropoff Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={preDropoffUploading}
                    onChange={uploadPreDropoffPhoto}
                  />
                </label>
              )}

              {preDropoffPhotos.length === 0 ? (
                <p className="text-sm text-slate-500">No pre-dropoff photos added yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {preDropoffPhotos.map((photo) => (
                    <button
                      type="button"
                      key={photo.id}
                      onClick={() => setPreDropoffLightbox(photo)}
                      className="relative group rounded-xl overflow-hidden border border-[#2a2d3e] aspect-video bg-[#0f1117]"
                    >
                      <img src={photo.photo_url} alt="Pre-dropoff" className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-semibold text-cyan-300 bg-cyan-900/30 border-cyan-700/40">
                          Pre-Dropoff
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {preDropoffLightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setPreDropoffLightbox(null)}
        >
          <div className="relative max-w-4xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={preDropoffLightbox.photo_url}
              alt="Pre-dropoff full view"
              className="max-h-[85vh] max-w-full object-contain rounded-xl"
            />
            <button
              type="button"
              onClick={() => setPreDropoffLightbox(null)}
              className="absolute -top-3 -right-3 bg-slate-700 hover:bg-slate-600 rounded-full p-1 transition-colors"
            >
              <X size={16} className="text-white" />
            </button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Vehicle Info */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5"><Car size={12} /> {t('common.vehicle')}</h2>
          <div className="space-y-2">
            <div className="flex justify-between items-start gap-3 text-xs">
              <span className="text-slate-500">{t('common.year')}/{t('common.make')}/{t('common.model')}</span>
              {editing ? (
                <div className="grid grid-cols-3 gap-1.5 w-[320px] max-w-full">
                  <input
                    value={form.vehicle_year ?? ''}
                    onChange={e => set('vehicle_year', e.target.value)}
                    className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="Year"
                  />
                  <input
                    value={form.vehicle_make ?? ''}
                    onChange={e => set('vehicle_make', e.target.value)}
                    className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="Make"
                  />
                  <input
                    value={form.vehicle_model ?? ''}
                    onChange={e => set('vehicle_model', e.target.value)}
                    className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="Model"
                  />
                </div>
              ) : inlineEdit.field === 'vehicle_ymm' ? (
                <div className="flex items-center gap-1">
                  <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { const parts = inlineEdit.value.trim().split(/\s+/); api.patch(`/ros/${id}`, { vehicle_year: parts[0]||'', vehicle_make: parts[1]||'', vehicle_model: parts.slice(2).join(' ')||'' }).then(r => { setRo(r.data); setInlineEdit({ field: null, value: '' }) }).catch(err => { console.error('[RODetail] inline save:', err.message); setInlineEdit({ field: null, value: '' }) }) } else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-48" placeholder="Year Make Model" />
                  <button type="button" onClick={() => { const parts = inlineEdit.value.trim().split(/\s+/); api.patch(`/ros/${id}`, { vehicle_year: parts[0]||'', vehicle_make: parts[1]||'', vehicle_model: parts.slice(2).join(' ')||'' }).then(r => { setRo(r.data); setInlineEdit({ field: null, value: '' }) }).catch(err => { console.error('[RODetail] inline save:', err.message); setInlineEdit({ field: null, value: '' }) }) }} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={13} /></button>
                  <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-slate-500 hover:text-red-400"><X size={13} /></button>
                </div>
              ) : (
                <span className="text-white font-medium capitalize flex items-center gap-1.5">
                  {[ro.vehicle?.year, ro.vehicle?.make, ro.vehicle?.model].filter(Boolean).join(' ') || '—'}
                  {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_ymm', value: [ro.vehicle?.year, ro.vehicle?.make, ro.vehicle?.model].filter(Boolean).join(' ') })} className="text-slate-600 hover:text-slate-300 ml-0.5"><Pencil size={10} /></button>}
                </span>
              )}
            </div>
            <div className="flex justify-between text-xs gap-3">
              <span className="text-slate-500">Color</span>
              {editing
                ? <input value={form.vehicle_color || ''} onChange={e => set('vehicle_color', e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-52 max-w-full" placeholder="Color" />
                : inlineEdit.field === 'vehicle_color' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vehicle_color', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-40" placeholder="Color" />
                    <button type="button" onClick={() => saveInlineField('vehicle_color', inlineEdit.value)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-slate-500 hover:text-red-400"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-white font-medium capitalize flex items-center gap-1.5">
                    {ro.vehicle?.color || '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_color', value: ro.vehicle?.color || '' })} className="text-slate-600 hover:text-slate-300 ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs gap-3">
              <span className="text-slate-500">Plate</span>
              {editing
                ? <input value={form.vehicle_plate || ''} onChange={e => set('vehicle_plate', e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-52 max-w-full" placeholder="Plate" />
                : inlineEdit.field === 'vehicle_plate' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vehicle_plate', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-40" placeholder="Plate" />
                    <button type="button" onClick={() => saveInlineField('vehicle_plate', inlineEdit.value)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-slate-500 hover:text-red-400"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-white font-medium flex items-center gap-1.5">
                    {ro.vehicle?.plate || '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_plate', value: ro.vehicle?.plate || '' })} className="text-slate-600 hover:text-slate-300 ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs gap-3">
              <span className="text-slate-500">Mileage</span>
              {editing
                ? <input type="number" min="0" value={form.vehicle_mileage ?? ''} onChange={e => set('vehicle_mileage', e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-40 max-w-full" placeholder="Mileage" />
                : inlineEdit.field === 'vehicle_mileage' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus type="number" min="0" value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vehicle_mileage', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-32" placeholder="Mileage" />
                    <button type="button" onClick={() => saveInlineField('vehicle_mileage', inlineEdit.value)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-slate-500 hover:text-red-400"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-white font-medium flex items-center gap-1.5">
                    {ro.vehicle?.mileage ? Number(ro.vehicle.mileage).toLocaleString() : '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_mileage', value: ro.vehicle?.mileage ?? '' })} className="text-slate-600 hover:text-slate-300 ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('common.vin')}</span>
              {editing
                ? <input value={form.vin || ''} onChange={e => set('vin', e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-52 max-w-full" placeholder="VIN" />
                : inlineEdit.field === 'vehicle_vin' ? (
                  <div className="flex items-center gap-1">
                    <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveInlineField('vin', inlineEdit.value); else if (e.key === 'Escape') setInlineEdit({ field: null, value: '' }) }} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-52" placeholder="VIN" />
                    <button type="button" onClick={() => saveInlineField('vin', inlineEdit.value)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={13} /></button>
                    <button type="button" onClick={() => setInlineEdit({ field: null, value: '' })} className="text-slate-500 hover:text-red-400"><X size={13} /></button>
                  </div>
                ) : (
                  <span className="text-white font-medium flex items-center gap-1.5">
                    {ro.vehicle?.vin || '—'}
                    {canEditRo && !editing && <button type="button" onClick={() => setInlineEdit({ field: 'vehicle_vin', value: ro.vehicle?.vin || '' })} className="text-slate-600 hover:text-slate-300 ml-0.5"><Pencil size={10} /></button>}
                  </span>
                )
              }
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Job Type</span>
              <span className="text-white font-medium capitalize">{ro.job_type || '—'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Intake Date</span>
              <span className="text-white font-medium capitalize">{ro.intake_date || '—'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('portal.estimatedCompletion')}</span>
              {editing
                ? <input type="date" value={form.estimated_delivery || ''} onChange={e => set('estimated_delivery', e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
                : <span className="text-white font-medium">{ro.estimated_delivery || '—'}</span>
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
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <button
            type="button"
            onClick={() => setVehicleHistoryExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Car size={12} /> Vehicle History
            </h2>
            <span className="text-slate-500">
              {vehicleHistoryExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          <p className="text-xs text-slate-500 mt-2">
            Last 10 visits for {ro.customer?.name || 'this customer'}
          </p>

          {vehicleHistoryExpanded && (
            <div className="mt-3">
              {vehicleHistoryLoading ? (
                <p className="text-sm text-slate-500">Loading history…</p>
              ) : vehicleHistoryError ? (
                <p className="text-sm text-red-300">{vehicleHistoryError}</p>
              ) : vehicleHistory.length === 0 ? (
                <p className="text-sm text-slate-500">No prior visits found.</p>
              ) : (
                <div className="space-y-2">
                  {vehicleHistory.map((visit) => (
                    <div key={visit.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            onClick={() => navigate(`/ros/${visit.id}`)}
                            className="text-sm font-semibold text-white hover:text-indigo-300"
                          >
                            {visit.ro_number || 'RO'}
                          </button>
                          <p className="text-[11px] text-slate-500 truncate">
                            {[visit.year, visit.make, visit.model].filter(Boolean).join(' ') || 'Vehicle not set'}
                          </p>
                          <p className="text-[11px] text-slate-500">
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
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4 col-span-full">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4 flex items-center gap-1.5">
            <Car size={12} /> Damage Diagram
          </h2>
          <div className="overflow-auto">
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
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4 col-span-full">
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
                {/* Editable profit adjustment fields */}
                {[
                  ['Deductible Waived', 'deductible_waived', ro.deductible_waived],
                  ['Referral Fee', 'referral_fee', ro.referral_fee],
                  ['Goodwill Repair', 'goodwill_repair_cost', ro.goodwill_repair_cost],
                ].map(([label, fieldKey, val]) => (
                  parseFloat(val || 0) > 0 || inlineEdit.field === fieldKey ? (
                    <div key={fieldKey} className="flex justify-between items-center text-xs">
                      <span className="text-red-400">{label}</span>
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
                            className="bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-24"
                          />
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className="text-red-400">-${parseFloat(val || 0).toFixed(2)}</span>
                          {userIsAdmin && <button type="button" onClick={() => setInlineEdit({ field: fieldKey, value: String(parseFloat(val || 0)) })} className="text-slate-600 hover:text-slate-300"><Pencil size={10} /></button>}
                        </span>
                      )}
                    </div>
                  ) : (
                    userIsAdmin ? (
                      <div key={fieldKey} className="flex justify-between items-center text-xs">
                        <span className="text-slate-600">{label}</span>
                        <button type="button" onClick={() => setInlineEdit({ field: fieldKey, value: '0' })} className="text-slate-600 hover:text-slate-400 text-[10px]">+ set</button>
                      </div>
                    ) : null
                  )
                ))}
                <div className="border-t border-[#2a2d3e] pt-2 flex justify-between items-center text-sm font-bold">
                  <span className="text-emerald-400">True Profit</span>
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
                        className="bg-[#0f1117] border border-emerald-700/50 rounded px-2 py-0.5 text-sm text-emerald-300 focus:outline-none focus:border-emerald-500 w-28"
                      />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <span className="text-emerald-400">${parseFloat(ro.true_profit||0).toFixed(2)}</span>
                      {userIsAdmin && <button type="button" onClick={() => setInlineEdit({ field: 'true_profit', value: String(parseFloat(ro.true_profit || 0)) })} className="text-slate-600 hover:text-slate-300"><Pencil size={10} /></button>}
                    </span>
                  )}
                </div>
              </div>
            )}
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

      {/* Notes */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide">{t('common.notes')}</h2>
          {savingQuickNote && <span className="text-[10px] text-slate-500">Saving...</span>}
        </div>

        {noteItems.length === 0 ? (
          <p className="text-sm text-slate-500 mb-3">No notes yet.</p>
        ) : (
          <div className="space-y-2 mb-3">
            {noteItems.map((note, idx) => (
              <div key={`${idx}-${note.slice(0, 16)}`} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 flex items-start justify-between gap-3">
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{note}</p>
                {!userIsAssistant && (
                  <button
                    type="button"
                    onClick={() => removeQuickNote(idx)}
                    disabled={savingQuickNote}
                    className="text-slate-500 hover:text-red-400 disabled:opacity-50"
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
              className="flex-1 bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={addQuickNote}
              disabled={savingQuickNote || !quickNoteText.trim()}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
      </div>

      </>
      )}

      {overviewTab === 'customer' && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <User size={12} /> Customer
              </h2>
              <p className="text-xs text-slate-500 mt-1">Edit customer details without leaving this RO.</p>
            </div>
            {!userIsAssistant && (
              <button
                type="button"
                onClick={saveCustomerInfo}
                disabled={savingCustomer}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {savingCustomer ? 'Saving...' : 'Save Customer'}
              </button>
            )}
          </div>

          {!ro.customer?.id ? (
            <p className="text-sm text-amber-300">No customer is linked to this RO yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] text-slate-500 block mb-1">Full Name *</label>
                <input
                  className={inp}
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">Phone</label>
                <input
                  className={inp}
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, phone: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">Email</label>
                <input
                  type="email"
                  className={inp}
                  value={customerForm.email}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, email: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[11px] text-slate-500 block mb-1">Address</label>
                <input
                  className={inp}
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, address: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">Insurance Company</label>
                <input
                  className={inp}
                  value={customerForm.insurance_company}
                  onChange={(e) => setCustomerForm((prev) => ({ ...prev, insurance_company: e.target.value }))}
                  disabled={userIsAssistant}
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">Policy Number</label>
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
      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-2">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Imported Estimate</h2>
        {estimateImport.loading ? (
          <p className="text-sm text-slate-500">Checking imported estimate data...</p>
        ) : importedItemsCount > 0 ? (
          <>
            <p className="text-sm text-slate-200">
              {importedItemsCount} line item{importedItemsCount !== 1 ? 's' : ''} imported
              {importedLastAt > 0 ? ` · last import ${new Date(importedLastAt).toLocaleString()}` : ''}
            </p>
            <p className="text-xs text-slate-400">
              Estimate total in REVV: ${Number(estimateImport.summary?.grand_total || 0).toFixed(2)}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">No imported estimate items found yet for this RO.</p>
        )}
        <p className="text-[11px] text-slate-500">
          REVV currently stores extracted line items from the upload. The original PDF file itself is not yet saved in the RO.
        </p>
        <button
          onClick={() => navigate(`/estimate-builder/${id}`)}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg"
        >
          Open Estimate Builder
        </button>
      </div>

      {ro.payment_type === 'insurance' && (
        <ClaimStatusCard ro={ro} onUpdate={setRo} isAdmin={isAdmin()} />
      )}

      {(ro.payment_type === 'insurance' || ro.claim_number || ro.insurance_claim_number) && (
        <InsurancePanel roId={id} ro={ro} onUpdated={() => { load(); loadEstimateImport() }} />
      )}

      {(ro.payment_type === 'insurance' || ro.claim_number || ro.insurance_claim_number) && (
        <ClaimTrackerPanel roId={id} canEdit={!userIsAssistant} />
      )}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
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
      </>
      )}

      {overviewTab === 'technician' && userIsAdmin && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">🔒 Internal Notes</h2>
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
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {savingInternalNote ? 'Adding...' : 'Add Note'}
              </button>
            </div>
          </form>

          {internalNotes.length === 0 ? (
            <p className="text-sm text-slate-500">No internal notes yet.</p>
          ) : (
            <div className="space-y-2">
              {internalNotes.map((entry) => (
                <div key={entry.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[11px] text-slate-400">
                      {new Date(entry.created_at).toLocaleString()} · {entry.author_name || 'Unknown'}
                    </div>
                    {userIsAdmin && (
                      <button
                        type="button"
                        onClick={() => deleteInternalNote(entry.id)}
                        disabled={deletingInternalNote === entry.id}
                        className="text-red-300 hover:text-red-200 disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{entry.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SMS Thread */}
      {overviewTab === 'communication' && (
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <MessageSquare size={13} /> Customer Text Messages
          </h2>
          {smsThread.some(m => m.direction === 'inbound') && (
            <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-semibold">
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
            className="flex-1 text-xs bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={loadSmsThread}
            disabled={smsLoading}
            className="text-xs text-slate-400 hover:text-white border border-[#2a2d3e] rounded-lg px-2 py-2"
          >
            <RefreshCw size={13} className={smsLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Thread messages */}
        <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
          {smsThread.length === 0 && !smsLoading && (
            <p className="text-xs text-slate-500 italic">No messages yet. Send the first text below.</p>
          )}
          {smsThread.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  msg.direction === 'outbound'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-[#0f1117] border border-[#2a2d3e] text-slate-200 rounded-bl-sm'
                }`}
              >
                <p className="whitespace-pre-wrap leading-snug">{msg.body}</p>
                <p className={`text-[10px] mt-1 ${msg.direction === 'outbound' ? 'text-indigo-200' : 'text-slate-500'}`}>
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
            className="flex-1 text-sm bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
          <button
            type="submit"
            disabled={smsSending || !smsMessage.trim() || !smsCustomerPhone.trim()}
            className="self-end px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
          >
            <Phone size={13} /> {smsSending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
      )}

      {/* Photos */}
      {overviewTab === 'technician' && <ROPhotos roId={ro.id} isAdmin={userIsAdmin} />}

      {/* Assigned Tech */}
      {overviewTab === 'technician' && userIsEmployee && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <User size={12} /> {t('ro.technician')}
          </h2>
          {techAssignmentMismatch && (
            <div className="mb-3 text-xs text-amber-200 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
              You are not the currently assigned tech on this RO. You can still update assignment, and admin will be notified.
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-white font-medium">
              {ro.assigned_tech ? ro.assigned_tech.name : <span className="text-slate-500 italic">Unassigned</span>}
            </span>
            {!userIsAssistant && (
              <select
                value={ro.assigned_to || ''}
                onChange={e => assignTech(e.target.value)}
                className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
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
      {overviewTab === 'technician' && userIsEmployee && (
        <ROOperations
          roId={ro.id}
          technicians={shopUsers.filter(u => ['owner', 'admin', 'technician', 'employee', 'staff'].includes(u.role))}
          readOnly={userIsAssistant}
        />
      )}

      {/* Tech Notes */}
      {overviewTab === 'technician' && userIsEmployee && (
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

      {overviewTab === 'communication' && (
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <MessageSquare size={12} /> Communication Log
          </h2>
          <button
            onClick={() => setShowCommForm(true)}
            className="text-xs bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            Log Communication
          </button>
        </div>

        {comms.length === 0 ? (
          <p className="text-slate-500 text-sm">No communication entries yet.</p>
        ) : (
          <div className="space-y-2">
            {comms.map((entry) => {
              const meta = COMM_TYPE_META[entry.channel] || COMM_TYPE_META.call
              const Icon = meta.Icon
              return (
                <div key={entry.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <Icon size={12} className="text-[#EAB308]" />
                    <span className="text-white font-medium">{meta.label}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                      entry.direction === 'inbound'
                        ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40'
                        : 'bg-indigo-900/30 text-indigo-300 border-indigo-700/40'
                    }`}>
                      {entry.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                    </span>
                    <span>·</span>
                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                    <span>·</span>
                    <span>{entry.logged_by || 'System'}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-slate-200 whitespace-pre-wrap">{entry.summary}</p>
                    {!userIsAssistant && (
                      <button
                        type="button"
                        onClick={() => deleteComm(entry.id)}
                        className="text-slate-500 hover:text-red-400 transition-colors"
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="sm:col-span-2">
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
                <div className="sm:col-span-2">
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

      {/* Customer Updates + Links */}
      {overviewTab === 'communication' && (
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Smartphone size={12} /> Customer Updates
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              No customer portal account needed. Send direct tracking and payment links.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={generateCustomerLinks}
              disabled={sendingCustomerLinks}
              className="flex items-center gap-1.5 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {sendingCustomerLinks ? 'Sending...' : 'Send Tracking Link'}
            </button>
            <button
              onClick={generatePaymentLinkOnly}
              disabled={generatingPaymentLink}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {generatingPaymentLink ? 'Generating...' : 'Generate Payment Link'}
            </button>
          </div>
        </div>

        {!ro.customer?.phone && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> No customer phone on file. Add a phone number to send SMS links.
          </p>
        )}
        {!ro.customer?.email && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> No customer email on file. Auto invoice emails require customer email.
          </p>
        )}

        {trackingLink && (
          <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
            <p className="text-[11px] text-slate-500 mb-2">Tracking Link</p>
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

        {paymentLink && (
          <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
            <p className="text-[11px] text-slate-500 mb-2">Payment Link</p>
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                readOnly
                value={paymentLink}
                className="flex-1 bg-transparent text-xs text-slate-300 font-mono truncate"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(paymentLink)
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

      {showCommForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={submitComm} className="w-full max-w-lg bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">Log Communication</h3>
              <button
                type="button"
                onClick={() => setShowCommForm(false)}
                className="text-slate-500 hover:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Channel</label>
              <select
                value={commForm.channel}
                onChange={(e) => setCommForm((f) => ({ ...f, channel: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
              >
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="in-person">In Person</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Direction</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCommForm((f) => ({ ...f, direction: 'outbound' }))}
                  className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border ${
                    commForm.direction === 'outbound'
                      ? 'bg-indigo-900/30 text-indigo-300 border-indigo-700/40'
                      : 'bg-[#0f1117] text-slate-400 border-[#2a2d3e]'
                  }`}
                >
                  Outbound
                </button>
                <button
                  type="button"
                  onClick={() => setCommForm((f) => ({ ...f, direction: 'inbound' }))}
                  className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border ${
                    commForm.direction === 'inbound'
                      ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40'
                      : 'bg-[#0f1117] text-slate-400 border-[#2a2d3e]'
                  }`}
                >
                  Inbound
                </button>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Summary</label>
              <textarea
                rows={4}
                value={commForm.summary}
                onChange={(e) => setCommForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="Communication summary..."
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCommForm(false)}
                className="flex-1 bg-[#0f1117] border border-[#2a2d3e] text-slate-300 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingComm}
                className="flex-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {savingComm ? 'Saving...' : 'Save Communication'}
              </button>
            </div>
          </form>
        </div>
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
      {overviewTab === 'parts' && (
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCatalogSearch(true)}
              className="flex items-center gap-1.5 text-xs bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Search size={12} /> Search Catalog
            </button>
            <button onClick={() => setShowAddPart(s=>!s)}
              className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={12}/> {t('common.add')} {t('ro.parts')}
            </button>
          </div>
        </div>

        {/* Add Part Form */}
        {showAddPart && (
          <form onSubmit={addPart} className="bg-[#0f1117] rounded-xl p-4 border border-[#2a2d3e] mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="sm:col-span-2">
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
              <div className="sm:col-span-2">
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
          <div className="overflow-x-auto border border-[#2a2d3e] rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-[#0f1117] text-slate-400 uppercase">
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
                    <tr key={p.id} className="border-t border-[#2a2d3e] align-top">
                      <td className="px-3 py-2 text-slate-300 font-mono">{p.part_number || '—'}</td>
                      <td className="px-3 py-2 text-white">
                        <div className="font-medium">{p.part_name || '—'}</div>
                        {p.tracking_number && (
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                            <Truck size={10} className="text-slate-500" />
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
                              className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5"
                            >
                              <ExternalLink size={9} /> Track
                            </a>
                            <button
                              onClick={() => refreshTracking(p.id)}
                              disabled={refreshingPart === p.id}
                              className="text-slate-500 hover:text-amber-400 inline-flex items-center gap-0.5 disabled:opacity-50"
                            >
                              <RefreshCw size={9} className={refreshingPart === p.id ? 'animate-spin' : ''} /> Refresh
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{p.vendor || '—'}</td>
                      <td className="px-3 py-2 text-right text-white">{qty || 1}</td>
                      <td className="px-3 py-2 text-right text-white">${unit.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-white">${rowTotal.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === 'ordered' && (
                            <>
                              <button onClick={()=>updatePartStatus(p.id,'backordered')} className="text-[10px] bg-red-900/30 text-red-400 border border-red-700/40 px-2 py-1 rounded-lg hover:bg-red-900/50 transition-colors">Backorder</button>
                              <button onClick={()=>updatePartStatus(p.id,'received')} className="text-[10px] bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 px-2 py-1 rounded-lg hover:bg-emerald-900/50 transition-colors">Received</button>
                            </>
                          )}
                          {p.status === 'backordered' && (
                            <button onClick={()=>updatePartStatus(p.id,'received')} className="text-[10px] bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 px-2 py-1 rounded-lg hover:bg-emerald-900/50 transition-colors inline-flex items-center gap-1">Received <CheckCircle size={10} /></button>
                          )}
                          <button onClick={()=>deletePart(p.id)} className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                            <X size={13}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#2a2d3e] bg-[#0f1117]">
                  <td colSpan={5} className="px-3 py-2 text-right text-slate-300 font-semibold">Parts Subtotal</td>
                  <td className="px-3 py-2 text-right text-emerald-400 font-semibold">${partsSubtotal.toFixed(2)}</td>
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <form onSubmit={billStorage} className="w-full max-w-md bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-3">
            <h3 className="text-white font-semibold text-sm">Bill Storage</h3>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Days</label>
              <input type="number" min="1" required className={inp} value={billingStorage.days} onChange={(e) => setBillingStorage((f) => ({ ...f, days: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Rate Per Day</label>
              <input type="number" min="0" step="0.01" required className={inp} value={billingStorage.rate_per_day} onChange={(e) => setBillingStorage((f) => ({ ...f, rate_per_day: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Billed To</label>
              <input className={inp} value={billingStorage.billed_to} onChange={(e) => setBillingStorage((f) => ({ ...f, billed_to: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Notes</label>
              <textarea rows={2} className={inp} value={billingStorage.notes} onChange={(e) => setBillingStorage((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="text-sm text-amber-300 font-semibold">
              Total: ${(Number(billingStorage.days || 0) * Number(billingStorage.rate_per_day || 0)).toFixed(2)}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowStorageBillModal(false)} className="flex-1 bg-[#0f1117] border border-[#2a2d3e] text-slate-300 py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button type="submit" disabled={billingStorageSaving} className="flex-1 bg-amber-400 hover:bg-amber-300 text-[#0f1117] py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                {billingStorageSaving ? 'Saving...' : 'Create Charge'}
              </button>
            </div>
          </form>
        </div>
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
