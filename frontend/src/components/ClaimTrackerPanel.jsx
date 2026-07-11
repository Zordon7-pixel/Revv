import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, FileText, Film, PhoneCall, ShieldAlert, Trash2, Upload } from 'lucide-react'
import api from '../lib/api'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'
import { safeExternalErrorMessage } from '../lib/safeErrors'
import PhotoLightbox from './PhotoLightbox'

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
  const [actionError, setActionError] = useState('')
  const [evidence, setEvidence] = useState([])
  const [failedEvidenceIds, setFailedEvidenceIds] = useState({})
  const [contacts, setContacts] = useState([])
  const [disputes, setDisputes] = useState([])

  const [selectedEvidenceFiles, setSelectedEvidenceFiles] = useState([])
  const [evidenceCaption, setEvidenceCaption] = useState('')
  const [uploadingEvidence, setUploadingEvidence] = useState(false)
  const [evidenceUploadProgress, setEvidenceUploadProgress] = useState('')
  const [deletingEvidenceId, setDeletingEvidenceId] = useState('')
  const [selectedEvidencePhoto, setSelectedEvidencePhoto] = useState(null)

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
      setFailedEvidenceIds({})
      setContacts(data?.contacts || [])
      setDisputes(data?.disputes || [])
      setLoadError('')
    } catch (err) {
      setLoadError(safeExternalErrorMessage(err, 'Could not load claim tracker data'))
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
    const files = selectedEvidenceFiles
    if (!files.length) return

    setUploadingEvidence(true)
    setActionError('')
    let uploadedCount = 0
    const failures = []

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      try {
        setEvidenceUploadProgress(`Uploading ${index + 1} of ${files.length}…`)
        const fd = new FormData()
        fd.append('media', file)
        fd.append('caption', evidenceCaption.trim())
        await api.post(`/claim-tracker/ro/${roId}/evidence`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        uploadedCount += 1
      } catch (err) {
        failures.push({
          file,
          message: safeExternalErrorMessage(err, 'Could not upload evidence file'),
        })
      }
    }

    setSelectedEvidenceFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (uploadedCount > 0) {
      setEvidenceCaption('')
      await loadTracker()
    }
    if (failures.length > 0) {
      const firstFailure = failures[0]
      setActionError(
        `${failures.length} of ${files.length} evidence files could not be uploaded. ${firstFailure.file.name}: ${firstFailure.message}`
      )
    }

    setUploadingEvidence(false)
    setEvidenceUploadProgress('')
  }

  async function removeEvidence(evidenceId) {
    if (!window.confirm('Delete this evidence file?')) return

    setDeletingEvidenceId(evidenceId)
    setActionError('')
    try {
      await api.delete(`/claim-tracker/evidence/${evidenceId}`)
      setSelectedEvidencePhoto((current) => current?.id === evidenceId ? null : current)
      await loadTracker()
    } catch (err) {
      setSelectedEvidencePhoto((current) => current?.id === evidenceId ? null : current)
      setActionError(safeExternalErrorMessage(err, 'Could not delete evidence file'))
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
      setActionError('Contact name and summary are required.')
      return
    }

    setSavingContact(true)
    setActionError('')
    try {
      await api.post(`/claim-tracker/ro/${roId}/contacts`, payload)
      setContactForm(EMPTY_CONTACT_FORM)
      await loadTracker()
    } catch (err) {
      setActionError(safeExternalErrorMessage(err, 'Could not save contact log entry'))
    } finally {
      setSavingContact(false)
    }
  }

  async function removeContact(contactId) {
    if (!window.confirm('Delete this contact log entry?')) return

    setDeletingContactId(contactId)
    setActionError('')
    try {
      await api.delete(`/claim-tracker/contacts/${contactId}`)
      await loadTracker()
    } catch (err) {
      setActionError(safeExternalErrorMessage(err, 'Could not delete contact log entry'))
    } finally {
      setDeletingContactId('')
    }
  }

  async function addDispute(e) {
    e.preventDefault()
    const note = disputeNote.trim()
    if (!note) return

    setSavingDispute(true)
    setActionError('')
    try {
      await api.post(`/claim-tracker/ro/${roId}/disputes`, { note })
      setDisputeNote('')
      await loadTracker()
    } catch (err) {
      setActionError(safeExternalErrorMessage(err, 'Could not save dispute note'))
    } finally {
      setSavingDispute(false)
    }
  }

  async function removeDispute(disputeId) {
    if (!window.confirm('Delete this dispute note?')) return

    setDeletingDisputeId(disputeId)
    setActionError('')
    try {
      await api.delete(`/claim-tracker/disputes/${disputeId}`)
      await loadTracker()
    } catch (err) {
      setActionError(safeExternalErrorMessage(err, 'Could not delete dispute note'))
    } finally {
      setDeletingDisputeId('')
    }
  }

  const inp = 'w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

  if (loading) {
    return (
      <div className="rounded-instrument border border-line-2 bg-panel p-4">
        <p className="text-sm text-faint">Loading claim tracker...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <div role="alert" className="flex items-center gap-2 rounded-instrument border border-crit/30 bg-crit/10 p-3 text-sm text-crit">
          <AlertTriangle size={14} /> {loadError}
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-center gap-2 rounded-instrument border border-crit/30 bg-crit/10 p-3 text-sm text-crit">
          <AlertTriangle size={14} /> {actionError}
        </div>
      )}

      <div className="space-y-3 rounded-instrument border border-line-2 bg-panel p-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <Upload size={12} /> Claim Documentation
          </h3>
          <p className="mt-1 text-xs text-faint">Upload photos, videos, PDFs, and appraisal documents directly to this job.</p>
        </div>

        {canEdit && (
          <form onSubmit={uploadEvidence} className="grid sm:grid-cols-3 gap-2">
            <div className="sm:col-span-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,application/pdf"
                multiple
                aria-label="Claim evidence files"
                onChange={(e) => setSelectedEvidenceFiles(Array.from(e.target.files || []))}
                className={inp}
                disabled={uploadingEvidence}
              />
            </div>
            <div className="sm:col-span-1">
              <input
                value={evidenceCaption}
                onChange={(e) => setEvidenceCaption(e.target.value)}
                placeholder="Caption (optional)"
                aria-label="Evidence caption"
                className={inp}
                disabled={uploadingEvidence}
              />
            </div>
            <button
              type="submit"
              disabled={uploadingEvidence || selectedEvidenceFiles.length === 0}
              className="text-xs bg-brand hover:bg-brand-lit text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              {uploadingEvidence ? evidenceUploadProgress : `Add ${selectedEvidenceFiles.length > 1 ? `${selectedEvidenceFiles.length} Files` : 'Evidence'}`}
            </button>
            {selectedEvidenceFiles.length > 0 && (
              <p aria-live="polite" className="text-xs text-muted sm:col-span-3">
                {selectedEvidenceFiles.length} file{selectedEvidenceFiles.length === 1 ? '' : 's'} selected
              </p>
            )}
          </form>
        )}

        {evidence.length === 0 ? (
          <p className="text-sm text-faint">No claim evidence files yet.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {evidence.map((item) => {
              const mediaUrl = resolveUploadedMediaUrl(item.media_url)
              const mediaFailed = !!failedEvidenceIds[item.id]

              return (
                <div key={item.id} className="rounded-instrument border border-line-2 bg-void p-3">
                  <div className="mb-2 overflow-hidden rounded-lg border border-line-2 bg-black">
                    {mediaUrl && !mediaFailed && item.media_type === 'document' ? (
                      <a href={mediaUrl} target="_blank" rel="noreferrer" className="flex h-40 w-full flex-col items-center justify-center gap-2 text-brand hover:bg-brand/5">
                        <FileText size={28} />
                        <span className="text-xs font-semibold">Open appraisal document</span>
                      </a>
                    ) : mediaUrl && !mediaFailed && item.media_type === 'video' ? (
                      <video
                        src={mediaUrl}
                        controls
                        className="w-full h-40 object-cover"
                        onError={() => setFailedEvidenceIds((prev) => ({ ...prev, [item.id]: true }))}
                      />
                    ) : mediaUrl && !mediaFailed ? (
                      <button
                        type="button"
                        onClick={() => setSelectedEvidencePhoto(item)}
                        className="block h-40 w-full cursor-zoom-in"
                        aria-label={`View ${item.caption || 'claim evidence photo'}`}
                      >
                        <img
                          src={mediaUrl}
                          alt={item.caption || 'Claim evidence'}
                          className="h-full w-full object-cover"
                          onError={() => setFailedEvidenceIds((prev) => ({ ...prev, [item.id]: true }))}
                        />
                      </button>
                    ) : (
                      <div className="flex h-40 w-full flex-col items-center justify-center gap-1 text-faint">
                        {item.media_type === 'document' ? <FileText size={22} className="text-faint" /> : item.media_type === 'video' ? <Film size={22} className="text-faint" /> : <Camera size={22} className="text-faint" />}
                        <span className="text-xs font-medium">Evidence unavailable</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${item.media_type === 'photo' ? 'border-good/40 bg-good/10 text-good' : 'border-brand/40 bg-brand/10 text-brand'}`}>
                      {item.media_type === 'document' ? <span className="inline-flex items-center gap-1"><FileText size={10} /> Document</span> : item.media_type === 'video' ? <span className="inline-flex items-center gap-1"><Film size={10} /> Video</span> : <span className="inline-flex items-center gap-1"><Camera size={10} /> Photo</span>}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeEvidence(item.id)}
                        disabled={deletingEvidenceId === item.id}
                        className="rounded-md p-1 text-faint transition-colors hover:bg-crit/10 hover:text-crit disabled:opacity-50"
                        title="Delete evidence"
                        aria-label={`Delete ${item.caption || 'evidence file'}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {item.caption && <p className="whitespace-pre-wrap text-sm text-ink">{item.caption}</p>}
                  <p className="mt-1 text-[11px] text-faint">
                    Added {formatDateTime(item.created_at)} by {item.uploaded_by_name || 'Unknown'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedEvidencePhoto && (
        <PhotoLightbox
          src={resolveUploadedMediaUrl(selectedEvidencePhoto.media_url)}
          alt={selectedEvidencePhoto.caption || 'Claim evidence'}
          title={selectedEvidencePhoto.caption || 'Claim evidence photo'}
          unavailable={!!failedEvidenceIds[selectedEvidencePhoto.id]}
          onError={() => setFailedEvidenceIds((prev) => ({ ...prev, [selectedEvidencePhoto.id]: true }))}
          onClose={() => setSelectedEvidencePhoto(null)}
          onDelete={canEdit ? () => removeEvidence(selectedEvidencePhoto.id) : undefined}
          deleting={deletingEvidenceId === selectedEvidencePhoto.id}
        />
      )}

      <div className="space-y-3 rounded-instrument border border-line-2 bg-panel p-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <PhoneCall size={12} /> Insurer Contact Log
          </h3>
          <p className="mt-1 text-xs text-faint">Track every adjuster communication and next step.</p>
        </div>

        {canEdit && (
          <form onSubmit={addContact} className="space-y-2">
            <div className="grid sm:grid-cols-3 gap-2">
              <input
                className={inp}
                placeholder="Insurer"
                aria-label="Insurer"
                value={contactForm.insurer_name}
                onChange={(e) => setContactForm((prev) => ({ ...prev, insurer_name: e.target.value }))}
                disabled={savingContact}
              />
              <input
                className={inp}
                placeholder="Contact name *"
                aria-label="Contact name"
                value={contactForm.contact_name}
                onChange={(e) => setContactForm((prev) => ({ ...prev, contact_name: e.target.value }))}
                disabled={savingContact}
              />
              <select
                className={inp}
                aria-label="Contact channel"
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
                aria-label="Contact date and time"
                value={contactForm.contact_at}
                onChange={(e) => setContactForm((prev) => ({ ...prev, contact_at: e.target.value }))}
                disabled={savingContact}
              />
              <input
                className={inp}
                placeholder="Outcome"
                aria-label="Contact outcome"
                value={contactForm.outcome}
                onChange={(e) => setContactForm((prev) => ({ ...prev, outcome: e.target.value }))}
                disabled={savingContact}
              />
            </div>

            <textarea
              rows={3}
              className={inp}
              placeholder="Summary *"
              aria-label="Contact summary"
              value={contactForm.summary}
              onChange={(e) => setContactForm((prev) => ({ ...prev, summary: e.target.value }))}
              disabled={savingContact}
            />

            <input
              className={inp}
              placeholder="Follow-up plan"
              aria-label="Follow-up plan"
              value={contactForm.follow_up}
              onChange={(e) => setContactForm((prev) => ({ ...prev, follow_up: e.target.value }))}
              disabled={savingContact}
            />

            <button
              type="submit"
              disabled={savingContact}
              className="text-xs bg-brand hover:bg-brand-lit text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              {savingContact ? 'Saving...' : 'Add Contact Entry'}
            </button>
          </form>
        )}

        {contacts.length === 0 ? (
          <p className="text-sm text-faint">No insurer contact entries yet.</p>
        ) : (
          <div className="space-y-2">
            {contacts.map((entry) => (
              <div key={entry.id} className="rounded-instrument border border-line-2 bg-void p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      {entry.contact_name}
                      {entry.insurer_name ? ` · ${entry.insurer_name}` : ''}
                    </div>
                    <div className="text-[11px] text-faint">
                      {CHANNEL_LABELS[entry.channel] || entry.channel} · {formatDateTime(entry.contact_at)} · Logged by {entry.logged_by_name || 'Unknown'}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeContact(entry.id)}
                      disabled={deletingContactId === entry.id}
                      className="rounded-md p-1 text-faint transition-colors hover:bg-crit/10 hover:text-crit disabled:opacity-50"
                      title="Delete contact entry"
                      aria-label={`Delete contact entry for ${entry.contact_name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink">{entry.summary}</p>
                {entry.outcome && <p className="mt-1 text-xs text-good">Outcome: {entry.outcome}</p>}
                {entry.follow_up && <p className="mt-1 text-xs text-brand">Follow-up: {entry.follow_up}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-instrument border border-line-2 bg-panel p-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <ShieldAlert size={12} /> Dispute Notes
          </h3>
          <p className="mt-1 text-xs text-faint">Capture denied items, evidence references, and appeal rationale.</p>
        </div>

        {canEdit && (
          <form onSubmit={addDispute} className="space-y-2">
            <textarea
              rows={3}
              className={inp}
              placeholder="Example: Carrier denied blend time on right quarter panel despite adjacent refinish lines in estimate."
              aria-label="Dispute note"
              value={disputeNote}
              onChange={(e) => setDisputeNote(e.target.value)}
              disabled={savingDispute}
            />
            <button
              type="submit"
              disabled={savingDispute || !disputeNote.trim()}
              className="text-xs bg-brand hover:bg-brand-lit text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
            >
              {savingDispute ? 'Saving...' : 'Add Dispute Note'}
            </button>
          </form>
        )}

        {disputes.length === 0 ? (
          <p className="text-sm text-faint">No dispute notes yet.</p>
        ) : (
          <div className="space-y-2">
            {disputes.map((entry) => (
              <div key={entry.id} className="rounded-instrument border border-line-2 bg-void p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[11px] text-faint">{formatDateTime(entry.created_at)} · {entry.created_by_name || 'Unknown'}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeDispute(entry.id)}
                      disabled={deletingDisputeId === entry.id}
                      className="rounded-md p-1 text-faint transition-colors hover:bg-crit/10 hover:text-crit disabled:opacity-50"
                      title="Delete dispute note"
                      aria-label="Delete dispute note"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink">{entry.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
