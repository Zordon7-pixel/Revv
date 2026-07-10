import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, CheckCircle } from 'lucide-react'
import api from '../lib/api'
import AppraisalQuickIntake from './AppraisalQuickIntake'
import LibraryAutocomplete from './LibraryAutocomplete'
import VehicleDiagram from './VehicleDiagram'
import TurnaroundEstimator from './TurnaroundEstimator'
import { searchInsurers } from '../data/insurers'
import { useLanguage } from '../contexts/LanguageContext'
import { isTextEntryTarget } from '../lib/keyboardFocus'
import { findAppraisalClaimMatches, findAppraisalCustomerMatch, findAppraisalVehicleMatch } from '../lib/appraisalIntake'

const JOB_TYPES = ['collision','paint','detailing','glass','towing','key_programming','wheel_recon','car_wrap']
const DAMAGE_TYPES = [
  { value: 'front_impact', label: 'Front Impact' },
  { value: 'rear_impact', label: 'Rear Impact' },
  { value: 'side_damage', label: 'Side Damage' },
  { value: 'hail', label: 'Hail' },
  { value: 'glass', label: 'Glass' },
]

const COMPACT_KEYBOARD_MIN_REDUCTION = 160

export function shouldUseCompactKeyboardEditor(targetWindow = window) {
  const visualViewport = targetWindow?.visualViewport
  if (!visualViewport) return false

  const root = targetWindow?.document?.documentElement
  const touch = root?.dataset?.touch === 'true' || Number(targetWindow?.navigator?.maxTouchPoints || 0) > 0
  const screenWidth = Math.round(Number(targetWindow?.screen?.width || 0))
  const screenHeight = Math.round(Number(targetWindow?.screen?.height || 0))
  const layoutHeight = Math.round(Number(targetWindow?.innerHeight || 0))
  const visualHeight = Math.round(Number(visualViewport.height || 0))
  const visualOffsetTop = Math.round(Number(visualViewport.offsetTop || 0))
  const orientationType = String(targetWindow?.screen?.orientation?.type || '')
  const legacyOrientation = Number(targetWindow?.orientation)
  const landscape = orientationType
    ? orientationType.startsWith('landscape')
    : Number.isFinite(legacyOrientation) && Math.abs(legacyOrientation) === 90
      ? true
      : screenWidth > 0 && screenHeight > 0
        ? screenWidth > screenHeight
        : Number(targetWindow?.innerWidth || 0) > layoutHeight
  const physicalViewportHeight = screenWidth > 0 && screenHeight > 0
    ? landscape
      ? Math.min(screenWidth, screenHeight)
      : Math.max(screenWidth, screenHeight)
    : 0
  const referenceHeight = Math.max(physicalViewportHeight, layoutHeight)
  const keyboardReduction = Math.max(0, referenceHeight - visualHeight - visualOffsetTop)

  return touch && landscape && keyboardReduction >= COMPACT_KEYBOARD_MIN_REDUCTION
}

function findControlLabel(control, boundary) {
  if (control?.labels?.[0]?.textContent) return control.labels[0].textContent.trim()
  let node = control?.parentElement
  while (node && node !== boundary) {
    const directLabel = Array.from(node.children || []).find((child) => child.tagName === 'LABEL')
    if (directLabel?.textContent) return directLabel.textContent.trim()
    node = node.parentElement
  }
  return control?.getAttribute?.('aria-label') || control?.placeholder || 'Field'
}

export default function AddROModal({ onClose, onSaved, presentation = 'modal' }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [customers, setCustomers] = useState([])
  const [customerVehicles, setCustomerVehicles] = useState([])
  const [autoFillLoading, setAutoFillLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [newRoCustomerId, setNewRoCustomerId] = useState('')
  const [entryMode, setEntryMode] = useState('manual')
  const [appraisalFiles, setAppraisalFiles] = useState([])
  const [intakeNotice, setIntakeNotice] = useState('')
  const [intakeClaimMatches, setIntakeClaimMatches] = useState([])
  const [createdRoWithPendingDocuments, setCreatedRoWithPendingDocuments] = useState(null)
  const [failedAppraisalFiles, setFailedAppraisalFiles] = useState([])
  const [form, setForm] = useState({
    // Customer (new or existing)
    customer_id: '', new_customer: false,
    customer_name: '', customer_phone: '', customer_email: '', customer_address: '', sms_consent: true, email_consent: false,
    // Vehicle
    vehicle_id: '', new_vehicle: true,
    year: '', make: '', model: '', vin: '', color: '', plate: '', mileage: '',
    // Job
    job_type: 'collision', payment_type: 'insurance',
    claim_number: '', policy_number: '', insurer: 'Progressive', adjuster_name: '', adjuster_phone: '', adjuster_email: '', deductible: '',
    estimated_delivery: '', notes: '', damage_type: 'front_impact', damaged_panels: []
  })
  const [compactEditor, setCompactEditor] = useState(null)
  const pageRef = useRef(null)
  const compactInputRef = useRef(null)
  const compactOriginalRef = useRef(null)
  const isPage = presentation === 'page'

  useEffect(() => { api.get('/customers').then(r => setCustomers(r.data.customers)) }, [])

  useEffect(() => {
    if (!isPage || !pageRef.current) return undefined

    const timers = new Set()
    const activateCompactEditor = () => {
      const active = document.activeElement
      if (active?.dataset?.roCompactInput === 'true') return true
      if (!shouldUseCompactKeyboardEditor(window)) return false
      if (!pageRef.current?.contains(active) || !isTextEntryTarget(active)) return false
      if (!['INPUT', 'TEXTAREA'].includes(active.tagName)) return false

      if (compactOriginalRef.current === active) return true
      compactOriginalRef.current = active
      setCompactEditor({
        token: `${Date.now()}-${Math.random()}`,
        label: findControlLabel(active, pageRef.current),
        value: active.value || '',
        tagName: active.tagName,
        type: active.type || 'text',
        inputMode: active.inputMode || undefined,
        autoComplete: active.autocomplete || undefined,
        placeholder: active.placeholder || '',
        maxLength: active.maxLength > 0 ? active.maxLength : undefined,
        min: active.min || undefined,
        max: active.max || undefined,
        step: active.step || undefined,
      })
      return true
    }
    const keepFocusedFieldVisible = () => {
      activateCompactEditor()
      const active = document.activeElement
      if (!pageRef.current?.contains(active) || !isTextEntryTarget(active)) return

      const visualViewport = window.visualViewport
      const viewportTop = Math.round(visualViewport?.offsetTop || 0)
      const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || 0)
      const rect = active.getBoundingClientRect()
      const topLimit = viewportTop + 12
      const bottomLimit = viewportTop + viewportHeight - 62

      if (rect.top < topLimit || rect.bottom > bottomLimit) {
        active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
      }
    }
    const scheduleVisibilityCheck = () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
      ;[0, 100, 300].forEach((delay) => {
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          keepFocusedFieldVisible()
        }, delay)
        timers.add(timer)
      })
    }
    const onFocusIn = (event) => {
      if (isTextEntryTarget(event.target)) scheduleVisibilityCheck()
    }
    const onViewportChange = () => {
      if (!shouldUseCompactKeyboardEditor(window)) {
        setCompactEditor(null)
        compactOriginalRef.current = null
      }
      scheduleVisibilityCheck()
    }

    const page = pageRef.current
    page.addEventListener('focusin', onFocusIn)
    window.visualViewport?.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('scroll', onViewportChange)
    window.addEventListener('orientationchange', onViewportChange)

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      page.removeEventListener('focusin', onFocusIn)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('scroll', onViewportChange)
      window.removeEventListener('orientationchange', onViewportChange)
      compactOriginalRef.current = null
    }
  }, [isPage])

  useEffect(() => {
    if (!compactEditor) return undefined
    const frame = window.requestAnimationFrame(() => {
      const input = compactInputRef.current
      input?.focus({ preventScroll: true })
      if (input && typeof input.setSelectionRange === 'function') {
        const end = String(input.value || '').length
        try { input.setSelectionRange(end, end) } catch { /* unsupported input type */ }
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [compactEditor?.token])

  useEffect(() => {
    compactOriginalRef.current = null
    setCompactEditor(null)
  }, [step])

  function updateCompactEditorValue(value) {
    const original = compactOriginalRef.current
    if (!original) return

    const prototype = original.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype
    const nativeSetter = prototype
      ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      : null

    if (nativeSetter) nativeSetter.call(original, value)
    else original.value = value
    original.dispatchEvent(new window.Event('input', { bubbles: true }))
    setCompactEditor((current) => current ? { ...current, value } : current)
  }

  function dismissCompactEditor() {
    compactInputRef.current?.blur()
    compactOriginalRef.current?.blur()
    compactOriginalRef.current = null
    setCompactEditor(null)
  }

  useEffect(() => {
    if (form.new_customer || !form.customer_id) {
      setCustomerVehicles([])
      return
    }
    let canceled = false
    setAutoFillLoading(true)
    api.get(`/customers/${form.customer_id}/autofill`)
      .then(({ data }) => {
        if (canceled) return
        const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : []
        const latestVehicle = data?.latest_vehicle || vehicles[0] || null
        const latestInsurance = data?.latest_insurance || null
        const customer = data?.customer || null
        setCustomerVehicles(vehicles)
        setForm((prev) => {
          if (prev.new_customer || prev.customer_id !== form.customer_id) return prev
          const next = { ...prev }
          if (!next.customer_name && customer?.name) next.customer_name = customer.name
          if (!next.customer_phone && customer?.phone) next.customer_phone = customer.phone
          if (!next.customer_email && customer?.email) next.customer_email = customer.email
          if (!next.customer_address && customer?.address) next.customer_address = customer.address
          next.sms_consent = customer?.sms_consent !== false
          next.email_consent = customer?.email_consent === true
          if (latestVehicle && (!next.vehicle_id || next.new_vehicle)) {
            next.new_vehicle = false
            next.vehicle_id = latestVehicle.id || ''
            next.year = latestVehicle.year || ''
            next.make = latestVehicle.make || ''
            next.model = latestVehicle.model || ''
            next.vin = latestVehicle.vin || ''
            next.color = latestVehicle.color || ''
            next.plate = latestVehicle.plate || ''
            next.mileage = latestVehicle.mileage ?? ''
          }
          const insurerCandidate = latestInsurance?.insurance_company || latestInsurance?.insurer || customer?.insurance_company || ''
          if ((!next.insurer || next.insurer === 'Progressive') && insurerCandidate) {
            next.insurer = insurerCandidate
          }
          if (!next.adjuster_name && latestInsurance?.adjuster_name) next.adjuster_name = latestInsurance.adjuster_name
          if (!next.adjuster_phone && latestInsurance?.adjuster_phone) next.adjuster_phone = latestInsurance.adjuster_phone
          if (!next.adjuster_email && latestInsurance?.adjuster_email) next.adjuster_email = latestInsurance.adjuster_email
          if (!next.policy_number && latestInsurance?.policy_number) next.policy_number = latestInsurance.policy_number
          if (!next.deductible && latestInsurance?.deductible !== null && latestInsurance?.deductible !== undefined) {
            next.deductible = String(latestInsurance.deductible)
          }
          return next
        })
      })
      .catch(() => {
        if (!canceled) setCustomerVehicles([])
      })
      .finally(() => {
        if (!canceled) setAutoFillLoading(false)
      })
    return () => { canceled = true }
  }, [form.new_customer, form.customer_id])

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    if (formError) setFormError('')
  }
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1'

  async function applyAppraisalIntake({ fields, files }) {
    const customerMatch = findAppraisalCustomerMatch(customers, fields)
    let matchedVehicles = []
    let matchedCustomer = customerMatch?.customer || null

    if (matchedCustomer?.id) {
      const { data } = await api.get(`/customers/${matchedCustomer.id}/autofill`)
      matchedVehicles = Array.isArray(data?.vehicles) ? data.vehicles : []
      matchedCustomer = data?.customer || matchedCustomer
      setCustomerVehicles(matchedVehicles)
    } else {
      setCustomerVehicles([])
    }

    const vehicleMatch = matchedCustomer
      ? findAppraisalVehicleMatch(matchedVehicles, fields)
      : null
    const matchedVehicle = vehicleMatch?.vehicle || null
    let claimMatches = []
    if (fields.claim_number) {
      try {
        const { data } = await api.get('/ros', { params: { search: fields.claim_number } })
        claimMatches = findAppraisalClaimMatches(data?.ros || [], fields.claim_number)
      } catch {
        claimMatches = []
      }
    }

    setForm((prev) => ({
      ...prev,
      customer_id: matchedCustomer?.id || '',
      new_customer: !matchedCustomer,
      customer_name: matchedCustomer?.name || fields.customer_name,
      customer_phone: matchedCustomer?.phone || fields.customer_phone,
      customer_email: matchedCustomer?.email || fields.customer_email,
      customer_address: matchedCustomer?.address || fields.customer_address,
      sms_consent: matchedCustomer ? matchedCustomer.sms_consent === true : false,
      email_consent: matchedCustomer ? matchedCustomer.email_consent === true : false,
      vehicle_id: matchedVehicle?.id || '',
      new_vehicle: !matchedVehicle,
      year: matchedVehicle?.year || fields.year,
      make: matchedVehicle?.make || fields.make,
      model: matchedVehicle?.model || fields.model,
      vin: matchedVehicle?.vin || fields.vin,
      color: matchedVehicle?.color || fields.color,
      plate: matchedVehicle?.plate || fields.plate,
      mileage: matchedVehicle?.mileage ?? fields.mileage,
      payment_type: 'insurance',
      insurer: fields.insurer || prev.insurer,
      claim_number: fields.claim_number,
      policy_number: fields.policy_number,
      adjuster_name: fields.adjuster_name,
      adjuster_phone: fields.adjuster_phone,
      adjuster_email: fields.adjuster_email,
      deductible: fields.deductible,
    }))
    setAppraisalFiles(files)
    setIntakeClaimMatches(claimMatches)
    setEntryMode('manual')
    setStep(1)
    setFormError('')
    setIntakeNotice(
      matchedCustomer
        ? `Appraisal details loaded. Matched ${matchedCustomer.name}${matchedVehicle ? ` and the saved vehicle by ${vehicleMatch.reason}` : ''}. Review before creating the RO.`
        : 'Appraisal details loaded for a new customer and vehicle. Confirm the fields and notification consent before creating the RO.'
    )
  }

  async function uploadAppraisalDocuments(roId, files = appraisalFiles) {
    if (!roId || !files.length) return []
    const results = await Promise.allSettled(files.map(async (file) => {
      const data = new FormData()
      data.append('media', file)
      data.append('caption', `Appraisal quick intake source · ${file.name}`)
      await api.post(`/claim-tracker/ro/${roId}/evidence`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return file
    }))
    return results.flatMap((result, index) => result.status === 'rejected' ? [files[index]] : [])
  }

  async function retryPendingDocuments() {
    if (!createdRoWithPendingDocuments) return
    setLoading(true)
    const failed = await uploadAppraisalDocuments(createdRoWithPendingDocuments.id, failedAppraisalFiles)
    setLoading(false)
    if (failed.length) {
      setFailedAppraisalFiles(failed)
      setFormError(`RO ${createdRoWithPendingDocuments.ro_number || ''} is created, but ${failed.length} appraisal document${failed.length === 1 ? '' : 's'} still need to be attached.`)
      return
    }
    onSaved(createdRoWithPendingDocuments)
  }

  function applyVehicleSelection(vehicleId) {
    const selected = customerVehicles.find((v) => v.id === vehicleId)
    setForm((prev) => ({
      ...prev,
      vehicle_id: vehicleId || '',
      new_vehicle: vehicleId ? false : prev.new_vehicle,
      year: selected?.year || '',
      make: selected?.make || '',
      model: selected?.model || '',
      vin: selected?.vin || '',
      color: selected?.color || '',
      plate: selected?.plate || '',
      mileage: selected?.mileage ?? '',
    }))
  }

  function useSavedVehicle() {
    const fallbackVehicle = customerVehicles[0] || null
    setForm((prev) => {
      const selected = customerVehicles.find((v) => v.id === prev.vehicle_id) || fallbackVehicle
      return {
        ...prev,
        new_vehicle: false,
        vehicle_id: selected?.id || prev.vehicle_id || '',
        year: selected?.year || prev.year || '',
        make: selected?.make || prev.make || '',
        model: selected?.model || prev.model || '',
        vin: selected?.vin || prev.vin || '',
        color: selected?.color || prev.color || '',
        plate: selected?.plate || prev.plate || '',
        mileage: selected?.mileage ?? prev.mileage ?? '',
      }
    })
  }

  async function submit() {
    // Validate before hitting the API
    if (autoFillLoading) {
      setFormError('Still loading customer vehicle defaults. Please try again in a moment.')
      return
    }
    if (!form.new_customer && !form.customer_id) {
      setFormError('Please select an existing customer or switch to New customer.')
      return
    }
    if (form.new_customer && !form.customer_name.trim()) {
      setFormError(`${t('common.name')} is required.`)
      return
    }
    if (form.email_consent && !form.customer_email.trim()) {
      setFormError('Customer email is required for email status updates.')
      return
    }
    if (form.new_vehicle && (!form.make.trim() || !form.model.trim() || !form.year)) {
      setFormError(`${t('common.vehicle')} ${t('common.year').toLowerCase()}, ${t('common.make').toLowerCase()}, and ${t('common.model').toLowerCase()} are required.`)
      return
    }
    if (!form.new_vehicle && !form.vehicle_id) {
      setFormError('Please select a saved vehicle or switch to New vehicle.')
      return
    }

    setLoading(true)
    setFormError('')
    setDuplicateWarning(null)
    try {
      let customer_id = form.customer_id
      if (!customer_id || form.new_customer) {
        const { data } = await api.post('/customers', {
          name: form.customer_name,
          phone: form.customer_phone,
          email: form.customer_email,
          address: form.customer_address,
          insurance_company: form.payment_type === 'insurance' ? form.insurer : null,
          policy_number: form.policy_number || null,
          sms_consent: form.sms_consent,
          email_consent: form.email_consent,
          preferred_contact_method: form.sms_consent && form.email_consent ? 'both' : form.email_consent ? 'email' : form.sms_consent ? 'sms' : 'none',
        })
        customer_id = data.id
      }
      let vehicle_id = form.vehicle_id
      if (form.new_vehicle || !vehicle_id) {
        const { data: veh } = await api.post('/vehicles', {
          customer_id, year: +form.year, make: form.make, model: form.model,
          vin: form.vin, color: form.color, plate: form.plate,
          mileage: form.mileage === '' ? null : Number(form.mileage),
        })
        vehicle_id = veh.id
      }
      const { data: ro } = await api.post('/ros', {
        customer_id, vehicle_id, job_type: form.job_type,
        payment_type: form.payment_type, claim_number: form.claim_number,
        policy_number: form.policy_number,
        insurer: form.payment_type === 'insurance' ? form.insurer : null,
        adjuster_name: form.adjuster_name, adjuster_phone: form.adjuster_phone,
        adjuster_email: form.adjuster_email,
        deductible: +form.deductible || 0, estimated_delivery: form.estimated_delivery, notes: form.notes,
        damaged_panels: form.damaged_panels,
        sms_consent: form.sms_consent,
        email_consent: form.email_consent,
        preferred_contact_method: form.sms_consent && form.email_consent ? 'both' : form.email_consent ? 'email' : form.sms_consent ? 'sms' : 'none',
      })
      const failedDocuments = await uploadAppraisalDocuments(ro?.id)
      if (failedDocuments.length) {
        console.error('[AddROModal] appraisal document upload failed:', failedDocuments.map((file) => file.name))
        setCreatedRoWithPendingDocuments(ro)
        setFailedAppraisalFiles(failedDocuments)
        setFormError(`RO ${ro?.ro_number || ''} was created, but ${failedDocuments.length} appraisal document${failedDocuments.length === 1 ? '' : 's'} could not be attached. Retry the documents or open the RO and attach them in Claim Tracker.`)
        return
      }
      if (ro?.duplicate_warning) {
        setDuplicateWarning(ro.duplicate_warning)
        setNewRoCustomerId(customer_id)
        return
      }
      onSaved(ro)
    } catch(e) {
      const msg = e?.response?.data?.error || e?.message || 'Unknown error'
      console.error('[AddROModal] create failed:', e)
      setFormError(`Error creating RO: ${msg}`)
    } finally { setLoading(false) }
  }

  function validateCurrentStep() {
    if (step === 1) {
      if (!form.new_customer && !form.customer_id) return 'Please select a customer or choose New.'
      if (form.new_customer && !form.customer_name.trim()) return `${t('common.name')} is required.`
      if (form.email_consent && !form.customer_email.trim()) return 'Customer email is required for email status updates.'
    }
    if (step === 2) {
      if (autoFillLoading) return 'Still loading customer vehicle defaults. Please try again in a moment.'
      if (!form.new_vehicle && !form.vehicle_id) return 'Select a saved vehicle or switch to New vehicle.'
      if (form.new_vehicle && (!form.year || !form.make.trim() || !form.model.trim())) {
        return `${t('common.year')}, ${t('common.make').toLowerCase()}, and ${t('common.model').toLowerCase()} are required.`
      }
    }
    return ''
  }

  const content = (
      <div className={`sheet-modal-card bg-[#1a1d2e] border border-[#2a2d3e] ${compactEditor ? 'add-ro-compact-active' : ''} ${isPage ? 'rounded-xl shadow-2xl' : 'sm:max-w-2xl sm:rounded-xl rounded-t-2xl'}`}>
        <div className="sheet-modal-header flex items-center justify-between p-5 border-b border-[#2a2d3e]">
          <h2 className="font-bold text-white">{t('ro.addRO')}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close new RO form"><X size={18} /></button>
        </div>
        <div className="sheet-modal-body p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="New repair order entry method">
            <button
              type="button"
              role="tab"
              aria-selected={entryMode === 'manual'}
              onClick={() => setEntryMode('manual')}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${entryMode === 'manual' ? 'bg-[#EAB308] text-[#0f1117]' : 'border border-[#2a2d3e] bg-[#0f1117] text-slate-400 hover:border-[#EAB308]/50'}`}
            >
              Manual Entry
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={entryMode === 'appraisal'}
              onClick={() => setEntryMode('appraisal')}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${entryMode === 'appraisal' ? 'bg-[#EAB308] text-[#0f1117]' : 'border border-[#2a2d3e] bg-[#0f1117] text-slate-400 hover:border-[#EAB308]/50'}`}
            >
              Appraisal Quick Intake
            </button>
          </div>
          {entryMode === 'appraisal' && <AppraisalQuickIntake onApply={applyAppraisalIntake} />}
          {entryMode === 'manual' && intakeNotice && (
            <div role="status" className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">
              {intakeNotice} {appraisalFiles.length > 0 ? `${appraisalFiles.length} source document${appraisalFiles.length === 1 ? '' : 's'} will be attached to the RO.` : ''}
            </div>
          )}
          {entryMode === 'manual' && intakeClaimMatches.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-600/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
              Possible duplicate claim: {intakeClaimMatches.map((ro) => ro.ro_number || ro.id).join(', ')} already uses claim {form.claim_number}. Review that RO before creating another one.
            </div>
          )}
          {duplicateWarning && (
            <div className="bg-amber-500/10 border border-amber-400/40 rounded-lg p-3 space-y-2">
              <p className="text-amber-300 text-sm">
                {`⚠️ Possible duplicate detected — ${duplicateWarning.count} open RO(s) exist for this customer/vehicle. Continue anyway or view existing ROs.`}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSaved()
                    navigate(`/ros?customer_id=${encodeURIComponent(newRoCustomerId)}`)
                  }}
                  className="w-full sm:w-auto bg-[#0f1117] border border-amber-300/40 hover:border-amber-300 text-amber-200 text-xs font-semibold px-3 py-2 rounded-lg"
                >
                  View Existing
                </button>
                <button
                  type="button"
                  onClick={onSaved}
                  className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-[#0f1117] text-xs font-semibold px-3 py-2 rounded-lg"
                >
                  Keep New RO
                </button>
              </div>
            </div>
          )}
          {formError && (
            <div role="alert" className="rounded-lg border border-red-700/50 bg-red-950/30 px-3 py-2 text-sm text-red-100">
              {formError}
            </div>
          )}
          {entryMode === 'manual' && step === 1 && (
            <>
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Step 1 — Customer</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm((prev) => ({ ...prev, new_customer: false }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${!form.new_customer ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}
                >
                  Existing
                </button>
                <button
                  onClick={() => {
                    setCustomerVehicles([])
                    setForm((prev) => ({
                      ...prev,
                      new_customer: true,
                      customer_id: '',
                      new_vehicle: true,
                      vehicle_id: '',
                      year: '',
                      make: '',
                      model: '',
                      vin: '',
                      color: '',
                      plate: '',
                      mileage: '',
                      sms_consent: true,
                    }))
                  }}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${form.new_customer ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}
                >
                  New
                </button>
              </div>
              {!form.new_customer ? (
                <div><label className={lbl}>Select Customer</label>
                  <select
                    value={form.customer_id}
                    onChange={e => {
                      const nextId = e.target.value
                      setCustomerVehicles([])
                      setForm((prev) => ({
                        ...prev,
                        customer_id: nextId,
                        vehicle_id: '',
                        new_vehicle: true,
                        year: '',
                        make: '',
                        model: '',
                        vin: '',
                        color: '',
                        plate: '',
                        mileage: '',
                        sms_consent: true,
                        email_consent: false,
                      }))
                    }}
                    className={inp}
                  >
                    <option value="">— select —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                  </select></div>
              ) : (
                <>
                  <div><label className={lbl}>Full Name *</label><input className={inp} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="John Smith" /></div>
                  <div><label className={lbl}>Phone</label><input className={inp} value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} placeholder="(718) 555-0100" /></div>
                  <div><label className={lbl}>Email</label><input className={inp} type="email" value={form.customer_email} onChange={e => set('customer_email', e.target.value)} placeholder="john@email.com" /></div>
                  <div><label className={lbl}>Address</label><input className={inp} value={form.customer_address} onChange={e => set('customer_address', e.target.value)} placeholder="Customer address" /></div>
                </>
              )}
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={form.sms_consent}
                  onChange={e => set('sms_consent', e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#2a2d3e] bg-[#0f1117] accent-indigo-600"
                />
                Customer consents to receive SMS status updates
              </label>
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={form.email_consent}
                  onChange={e => set('email_consent', e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#2a2d3e] bg-[#0f1117] accent-[#EAB308]"
                />
                Customer consents to receive email status updates
              </label>
            </>
          )}
          {entryMode === 'manual' && step === 2 && (
            <>
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Step 2 - {t('common.vehicle')}</h3>
              {!form.new_customer && customerVehicles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={useSavedVehicle}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${!form.new_vehicle ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}
                    >
                      Saved Vehicle
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, new_vehicle: true, vehicle_id: '' }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${form.new_vehicle ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}
                    >
                      New Vehicle
                    </button>
                  </div>
                  {!form.new_vehicle && (
                    <div>
                      <label className={lbl}>Select Saved Vehicle</label>
                      <select value={form.vehicle_id} onChange={(e) => applyVehicleSelection(e.target.value)} className={inp}>
                        <option value="">— select vehicle —</option>
                        {customerVehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {[v.year, v.make, v.model].filter(Boolean).join(' ')} {v.vin ? `· ${v.vin}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {autoFillLoading && <p className="text-[11px] text-slate-500">Loading customer vehicle defaults…</p>}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className={lbl}>{t('common.year')} *</label><input className={inp} value={form.year} onChange={e => set('year', e.target.value)} placeholder="2021" /></div>
                <div><label className={lbl}>{t('common.make')} *</label><input className={inp} value={form.make} onChange={e => set('make', e.target.value)} placeholder="Toyota" /></div>
                <div><label className={lbl}>{t('common.model')} *</label><input className={inp} value={form.model} onChange={e => set('model', e.target.value)} placeholder="Camry" /></div>
              </div>
              <div><label className={lbl}>{t('common.vin')}</label><input className={inp} value={form.vin} onChange={e => set('vin', e.target.value)} placeholder="1HGCV1F30KA..." /></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className={lbl}>Color</label><input className={inp} value={form.color} onChange={e => set('color', e.target.value)} placeholder="Silver" /></div>
                <div><label className={lbl}>Plate</label><input className={inp} value={form.plate} onChange={e => set('plate', e.target.value)} placeholder="ABC1234" /></div>
                <div><label className={lbl}>Mileage</label><input className={inp} inputMode="numeric" value={form.mileage} onChange={e => set('mileage', e.target.value)} placeholder="45000" /></div>
              </div>
            </>
          )}
          {entryMode === 'manual' && step === 3 && (
            <>
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Step 3 — Job Details</h3>
              <div><label className={lbl}>Job Type</label>
                <select className={inp} value={form.job_type} onChange={e => set('job_type', e.target.value)}>
                  {JOB_TYPES.map(j => <option key={j} value={j}>{j.replace('_',' ')}</option>)}
                </select></div>
              <div>
                <label className={lbl}>Damage Type</label>
                <select className={inp} value={form.damage_type} onChange={e => set('damage_type', e.target.value)}>
                  {DAMAGE_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-4">
                <p className="text-xs font-semibold text-indigo-400 mb-3">Mark Damaged Panels</p>
                <VehicleDiagram
                  value={form.damaged_panels}
                  onChange={panels => set('damaged_panels', panels)}
                />
              </div>
              <div className="flex gap-2">
                {['insurance','cash'].map(t => (
                  <button key={t} onClick={() => set('payment_type', t)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors capitalize ${form.payment_type===t ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}>{t}</button>
                ))}
              </div>
              {form.payment_type === 'insurance' && (
                <>
                  <div>
                    <label className={lbl}>Insurer</label>
                    <LibraryAutocomplete
                      value={form.insurer}
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
                  <div><label className={lbl}>Claim #</label><input className={inp} value={form.claim_number} onChange={e => set('claim_number', e.target.value)} placeholder="CLM-2026-XXXXX" /></div>
                  <div><label className={lbl}>Policy #</label><input className={inp} value={form.policy_number} onChange={e => set('policy_number', e.target.value)} placeholder="Policy number" /></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div><label className={lbl}>Adjuster Name</label><input className={inp} value={form.adjuster_name} onChange={e => set('adjuster_name', e.target.value)} /></div>
                    <div><label className={lbl}>Adjuster Phone</label><input className={inp} value={form.adjuster_phone} onChange={e => set('adjuster_phone', e.target.value)} /></div>
                  </div>
                  <div><label className={lbl}>Adjuster Email</label><input className={inp} type="email" value={form.adjuster_email} onChange={e => set('adjuster_email', e.target.value)} placeholder="adjuster@carrier.com" /></div>
                  <div><label className={lbl}>Deductible ($)</label><input className={inp} type="number" value={form.deductible} onChange={e => set('deductible', e.target.value)} placeholder="500" /></div>
                </>
              )}
              <TurnaroundEstimator
                jobType={form.job_type}
                onAccept={(date) => setForm(f => ({ ...f, estimated_delivery: date }))}
              />
              <div><label className={lbl}>Est. Delivery Date</label><input className={inp} type="date" value={form.estimated_delivery} onChange={e => set('estimated_delivery', e.target.value)} /></div>
              <div><label className={lbl}>Notes</label><textarea className={inp} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional details..." /></div>
            </>
          )}
        </div>
        {compactEditor && (
          <div className="add-ro-compact-editor" role="group" aria-label={`Editing ${compactEditor.label}`}>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="add-ro-compact-input" className="text-sm font-semibold text-slate-100">
                {compactEditor.label}
              </label>
              <button
                type="button"
                onClick={dismissCompactEditor}
                className="shrink-0 rounded-lg border border-[#EAB308]/50 bg-[#EAB308]/10 px-3 py-1.5 text-xs font-semibold text-[#EAB308]"
              >
                Done
              </button>
            </div>
            {compactEditor.tagName === 'TEXTAREA' ? (
              <textarea
                ref={compactInputRef}
                id="add-ro-compact-input"
                data-ro-compact-input="true"
                value={compactEditor.value}
                onChange={(event) => updateCompactEditorValue(event.target.value)}
                placeholder={compactEditor.placeholder}
                maxLength={compactEditor.maxLength}
                rows={2}
                className="w-full rounded-lg border border-[#EAB308] bg-[#0f1117] px-3 py-2 text-base text-white outline-none shadow-[0_0_0_3px_rgba(234,179,8,0.2)]"
              />
            ) : (
              <input
                ref={compactInputRef}
                id="add-ro-compact-input"
                data-ro-compact-input="true"
                type={compactEditor.type}
                inputMode={compactEditor.inputMode}
                autoComplete={compactEditor.autoComplete}
                value={compactEditor.value}
                onChange={(event) => updateCompactEditorValue(event.target.value)}
                placeholder={compactEditor.placeholder}
                maxLength={compactEditor.maxLength}
                min={compactEditor.min}
                max={compactEditor.max}
                step={compactEditor.step}
                className="w-full rounded-lg border border-[#EAB308] bg-[#0f1117] px-3 py-2 text-base text-white outline-none shadow-[0_0_0_3px_rgba(234,179,8,0.2)]"
              />
            )}
          </div>
        )}
        <div className="sheet-modal-footer flex items-center justify-between p-5 border-t border-[#2a2d3e]">
          {entryMode === 'appraisal' ? (
            <>
              <button type="button" onClick={onClose} className="text-sm text-slate-400 transition-colors hover:text-white">{t('common.cancel')}</button>
              <span className="text-xs text-slate-500">Upload · Review · Apply</span>
              <button type="button" onClick={() => setEntryMode('manual')} className="rounded-lg border border-[#2a2d3e] px-3 py-2 text-xs font-semibold text-slate-300 hover:border-[#EAB308]/50">Manual Entry</button>
            </>
          ) : createdRoWithPendingDocuments ? (
            <>
              <button type="button" onClick={() => onSaved(createdRoWithPendingDocuments)} className="text-sm text-slate-400 transition-colors hover:text-white">Open RO without documents</button>
              <span className="text-xs text-amber-300">RO already created</span>
              <button type="button" onClick={retryPendingDocuments} disabled={loading} className="rounded-lg bg-[#EAB308] px-4 py-2 text-sm font-semibold text-[#0f1117] hover:bg-yellow-400 disabled:opacity-50">{loading ? 'Retrying...' : 'Retry Documents'}</button>
            </>
          ) : (
            <>
              <button onClick={() => step > 1 ? setStep(s=>s-1) : onClose()} className="text-slate-400 hover:text-white text-sm transition-colors">
                {step > 1 ? `← ${t('common.back')}` : t('common.cancel')}
              </button>
              <div className="flex items-center gap-2">
                {[1,2,3].map(i => <div key={i} className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${step>=i ? 'bg-[#EAB308]' : 'bg-[#2a2d3e]'}`} />)}
              </div>
              {step < 3 ? (
                <button onClick={() => {
                  const message = validateCurrentStep()
                  if (message) { setFormError(message); return }
                  setFormError('')
                  setStep(s=>s+1)
                }} className="bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">Next →</button>
              ) : (
                <button onClick={submit} disabled={loading} className="bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">{loading ? 'Creating...' : <span className="inline-flex items-center gap-1">{t('ro.addRO')} <CheckCircle size={13} /></span>}</button>
              )}
            </>
          )}
        </div>
      </div>
  )

  if (isPage) {
    return (
      <div ref={pageRef} className={`add-ro-page mx-auto min-h-full w-full max-w-3xl px-3 py-4 sm:px-4 sm:py-6 ${compactEditor ? 'add-ro-compact-mode' : ''}`}>
        {content}
      </div>
    )
  }

  return (
    <div className="sheet-modal-overlay fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-[90] p-0 sm:p-4">
      {content}
    </div>
  )
}
