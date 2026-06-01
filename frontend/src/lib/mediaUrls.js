export function resolveUploadedMediaUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw

  const path = raw.startsWith('/') ? raw : `/${raw}`
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : ''

  return origin ? `${origin}${path}` : path
}
