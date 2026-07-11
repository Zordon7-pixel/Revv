import { resolveUploadedMediaUrl } from './mediaUrls'

const APPRAISAL_CAPTION_PREFIX = 'Appraisal quick intake source'

export function findAttachedAppraisalEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : [])
    .filter((item) => ['photo', 'document'].includes(String(item?.media_type || '').toLowerCase()))
    .filter((item) => String(item?.caption || '').startsWith(APPRAISAL_CAPTION_PREFIX))
    .slice(0, 12)
}

function evidenceFilename(item, index) {
  const captionName = String(item?.caption || '').split('·').pop()?.trim()
  if (captionName && captionName !== APPRAISAL_CAPTION_PREFIX) return captionName
  const pathName = String(item?.media_url || '').split('/').pop()
  return pathName || `appraisal-page-${index + 1}`
}

export async function attachedEvidenceToFiles(evidence, fetchImpl = fetch) {
  const items = findAttachedAppraisalEvidence(evidence)
  return Promise.all(items.map(async (item, index) => {
    const response = await fetchImpl(resolveUploadedMediaUrl(item.media_url))
    if (!response.ok) throw new Error(`Could not load attached appraisal page ${index + 1}`)
    const blob = await response.blob()
    return new File([blob], evidenceFilename(item, index), {
      type: blob.type || item.mime_type || (item.media_type === 'document' ? 'application/pdf' : 'image/jpeg'),
    })
  }))
}
