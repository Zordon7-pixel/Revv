import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Film, PhoneCall, ShieldAlert, Trash2, Upload } from 'lucide-react'
import api from '../lib/api'

const CHANNEL_OPTIONS = [
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'portal', label: 'Portal' },
  { value: 'in-person', label: 'In Person' },
]

const CHANNEL_LABELS = CHANNEL_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label
  return acc
}, {})

const EMPTY_CONTACT_FORM = {
  insurer_name: '',
  contact_name: '',
  channel: 'phone',
  summary: '',
  outcome: '',
  follow_up: '',
  contact_at: '',
}

function formatDateTime(value) {
  if (!value) return '—'
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return '—'
  return stamp.toLocaleString()
}

export default function ClaimTrackerPanel({ roId, canEdit }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [evidence, setEvidence] = useState([])
  const [contacts, setContacts] = useState([])
  const [disputes, setDisputes] = useState([])

  const [selectedEvidenceFile, setSelectedEvidenceFile] = useState(null)
  const [evidenceCaption, setEvidenceCaption] = useState('')
  const [uploadingEvidence, setUploadingEvidence] = useState(false)
  const [deletingEvidenceId, setDeletingEvidenceId] = useState('')

  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM)
  const [savingContact, setSavingContact] = useState(false)
  const [deletingContactId, setDeletingContactId] = useState('')

  const [disputeNote, setDisputeNote] = useState('')
  const [savingDispute, setSavingDispute] = useState(false)
  const [deletingDisputeId, setDeletingDisputeId] = useState('')

  const fileInputRef = useRef(null)

  const loadTracker = async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/claim-tracker/ro/${roId}`)
      setEvidence(data?.evidence || [])
      setContacts(data?.contacts || [])
      setDisputes(data?.disputes || [])
      setLoadError('')
    } catch (err) {
      setLoadError(err?.response?.data?.error || 'Could not load claim tracker data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!roId) return
    loadTracker()
  }, [roId])

  async function uploadEvidence(e) {
    e.preventDefault()
    if (!selectedEvidenceFile) return

    setUploadingEvidence(true)
    try {
      const fd = new FormData()
      fd.append('media', selectedEvidenceFile)
      fd.append('caption', evidenceCaption.trim())
      await api.post(`/claim-tracker/ro/${roId}/evidence`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      setSelectedEvidenceFile(null)
      setEvidenceCaption('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadTracker()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not upload evidence file')
    } finally {
      setUploadingEvidence(false)
    }
  }

  async function removeEvidence(evidenceId) {
    if (!window.confirm('Delete this evidence file?')) return

    setDeletingEvidenceId(evidenceId)
    try {
      await api.delete(`/claim-tracker/evidence/${evidenceId}`)
      await loadTracker()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete evidence file')
    } finally {
      setDeletingEvidenceId('')
    }
  }

  async function addContact(e) {
    e.preventDefault()
    const payload = {
      insurer_name: contactForm.insurer_name.trim(),
      contact_name: contactForm.contact_name.trim(),
      channel: contactForm.channel,
      summary: contactForm.summary.trim(),
      outcome: contactForm.outcome.trim(),
      follow_up: contactForm.follow_up.trim(),
      contact_at: contactForm.contact_at || null,
    }

    if (!payload.contact_name || !payload.summary) {
      alert('Contact name and summary are required.')
      return
    }

    setSavingContact(true)
    try {
      await api.post(`/claim-tracker/ro/${roId}/contacts`, payload)
      setContactForm(EMPTY_CONTACT_FORM)
      await loadTracker()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save contact log entry')
    } finally {
      setSavingContact(false)
    }
  }

  async function removeContact(contactId) {
    if (!window.confirm('Delete this contact log entry?')) return

    setDeletingContactId(contactId)
    try {
      await api.delete(`/claim-tracker/contacts/${contactId}`)
      await loadTracker()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete contact log entry')
    } finally {
      setDeletingContactId('')
    }
  }

  async function addDispute(e) {
    e.preventDefault()
    const note = disputeNote.trim()
    if (!note) return

    setSavingDispute(true)
    try {
      await api.post(`/claim-tracker/ro/${roId}/disputes`, { note })
      setDisputeNote('')
      await loadTracker()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save dispute note')
    } finally {
      setSavingDispute(false)
    }
  }

  async function removeDispute(disputeId) {
    if (!window.confirm('Delete this dispute note?')) return

    setDeletingDisputeId(disputeId)
    try {
      await api.delete(`/claim-tracker/disputes/${disputeId}`)
      await loadTracker()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete dispute note')
    } finally {
      setDeletingDisputeId('')
    }
  }

  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'

  if (loading) {
    return (
      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
        <p className="text-sm text-slate-500">Loading claim tracker...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-3 text-sm text-red-200 flex items-center gap-2">
          <AlertTriangle size={14} /> {loadError}
        </div>
      )}

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <Upload size={12} /> Photo/Video Documentation
          </h3>
          <p className="text-xs text-slate-500 mt-1">Upload evidence files directly to this job for insurance disputes.</p>
        </div>

        {canEdit && (
          <form onSubmit={uploadEvidence} className="grid sm:grid-cols-3 gap-2">
            <div className="sm:col-span-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={(e) => setSelectedEvidenceFile(e.target.files?.[0] || null)}
                className={inp}
                disabled={uploadingEvidence}
              />
            </div>
            <div className="sm:col-span-1">
              <input
                value={evidenceCaption}
                onChange={(e) => setEvidenceCaption(e.target.value)}
                placeholder="Caption (optional)"
                className={inp}
                disabled={uploadingEvidence}
              />
            </div>
            <button
              type="submit"
              disabled={uploadingEvidence || !selectedEvidenceFile}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              {uploadingEvidence ? 'Uploading...' : 'Add Evidence'}
            </button>
          </form>
        )}

        {evidence.length === 0 ? (
          <p className="text-sm text-slate-500">No claim evidence files yet.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {evidence.map((item) => (
              <div key={item.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                <div className="rounded-lg overflow-hidden border border-[#2a2d3e] bg-black mb-2">
                  {item.media_type === 'video' ? (
                    <video src={item.media_url} controls className="w-full h-40 object-cover" />
                  ) : (
                    <img src={item.media_url} alt={item.caption || 'Claim evidence'} className="w-full h-40 object-cover" />
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${item.media_type === 'video' ? 'text-indigo-300 bg-indigo-900/30 border-indigo-700/40' : 'text-emerald-300 bg-emerald-900/20 border-emerald-700/40'}`}>
                    {item.media_type === 'video' ? <span className="inline-flex items-center gap-1"><Film size={10} /> Video</span> : <span className="inline-flex items-center gap-1"><Camera size={10} /> Photo</span>}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeEvidence(item.id)}
                      disabled={deletingEvidenceId === item.id}
                      className="text-slate-500 hover:text-red-400 disabled:opacity-50"
                      title="Delete evidence"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {item.caption && <p className="text-sm text-slate-200 whitespace-pre-wrap">{item.caption}</p>}
                <p className="text-[11px] text-slate-500 mt-1">
                  Added {formatDateTime(item.created_at)} by {item.uploaded_by_name || 'Unknown'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <PhoneCall size={12} /> Insurer Contact Log
          </h3>
          <p className="text-xs text-slate-500 mt-1">Track every adjuster communication and next step.</p>
        </div>

        {canEdit && (
          <form onSubmit={addContact} className="space-y-2">
            <div className="grid sm:grid-cols-3 gap-2">
              <input
                className={inp}
                placeholder="Insurer"
                value={contactForm.insurer_name}
                onChange={(e) => setContactForm((prev) => ({ ...prev, insurer_name: e.target.value }))}
                disabled={savingContact}
              />
              <input
                className={inp}
                placeholder="Contact name *"
                value={contactForm.contact_name}
                onChange={(e) => setContactForm((prev) => ({ ...prev, contact_name: e.target.value }))}
                disabled={savingContact}
              />
              <select
                className={inp}
                value={contactForm.channel}
                onChange={(e) => setContactForm((prev) => ({ ...prev, channel: e.target.value }))}
                disabled={savingContact}
              >
                {CHANNEL_OPTIONS.map((channel) => (
                  <option key={channel.value} value={channel.value}>{channel.label}</option>
                ))}
              </select>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="datetime-local"
                className={inp}
                value={contactForm.contact_at}
                onChange={(e) => setContactForm((prev) => ({ ...prev, contact_at: e.target.value }))}
                disabled={savingContact}
              />
              <input
                className={inp}
                placeholder="Outcome"
                value={contactForm.outcome}
                onChange={(e) => setContactForm((prev) => ({ ...prev, outcome: e.target.value }))}
                disabled={savingContact}
              />
            </div>

            <textarea
              rows={3}
              className={inp}
              placeholder="Summary *"
              value={contactForm.summary}
              onChange={(e) => setContactForm((prev) => ({ ...prev, summary: e.target.value }))}
              disabled={savingContact}
            />

            <input
              className={inp}
              placeholder="Follow-up plan"
              value={contactForm.follow_up}
              onChange={(e) => setContactForm((prev) => ({ ...prev, follow_up: e.target.value }))}
              disabled={savingContact}
            />

            <button
              type="submit"
              disabled={savingContact}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              {savingContact ? 'Saving...' : 'Add Contact Entry'}
            </button>
          </form>
        )}

        {contacts.length === 0 ? (
          <p className="text-sm text-slate-500">No insurer contact entries yet.</p>
        ) : (
          <div className="space-y-2">
            {contacts.map((entry) => (
              <div key={entry.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <div className="text-sm text-white font-medium">
                      {entry.contact_name}
                      {entry.insurer_name ? ` · ${entry.insurer_name}` : ''}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {CHANNEL_LABELS[entry.channel] || entry.channel} · {formatDateTime(entry.contact_at)} · Logged by {entry.logged_by_name || 'Unknown'}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeContact(entry.id)}
                      disabled={deletingContactId === entry.id}
                      className="text-slate-500 hover:text-red-400 disabled:opacity-50"
                      title="Delete contact entry"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{entry.summary}</p>
                {entry.outcome && <p className="text-xs text-emerald-300 mt-1">Outcome: {entry.outcome}</p>}
                {entry.follow_up && <p className="text-xs text-amber-300 mt-1">Follow-up: {entry.follow_up}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <ShieldAlert size={12} /> Dispute Notes
          </h3>
          <p className="text-xs text-slate-500 mt-1">Capture denied items, evidence references, and appeal rationale.</p>
        </div>

        {canEdit && (
          <form onSubmit={addDispute} className="space-y-2">
            <textarea
              rows={3}
              className={inp}
              placeholder="Example: Carrier denied blend time on right quarter panel despite adjacent refinish lines in estimate."
              value={disputeNote}
              onChange={(e) => setDisputeNote(e.target.value)}
              disabled={savingDispute}
            />
            <button
              type="submit"
              disabled={savingDispute || !disputeNote.trim()}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              {savingDispute ? 'Saving...' : 'Add Dispute Note'}
            </button>
          </form>
        )}

        {disputes.length === 0 ? (
          <p className="text-sm text-slate-500">No dispute notes yet.</p>
        ) : (
          <div className="space-y-2">
            {disputes.map((entry) => (
              <div key={entry.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[11px] text-slate-500">{formatDateTime(entry.created_at)} · {entry.created_by_name || 'Unknown'}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeDispute(entry.id)}
                      disabled={deletingDisputeId === entry.id}
                      className="text-slate-500 hover:text-red-400 disabled:opacity-50"
                      title="Delete dispute note"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{entry.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
