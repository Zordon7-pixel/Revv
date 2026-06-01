const SECRET_ERROR_PATTERNS = [
  /sk-(?:proj-)?[A-Za-z0-9_-]+/g,
  /https:\/\/platform\.[A-Za-z]+\.com\/account\/api-keys/gi,
  /incorrect api key provided/gi,
]

const AI_CONFIG_ERROR = 'AI estimate extraction is not configured correctly. Please contact support.'

export function safeExternalErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const raw = String(error?.response?.data?.error || error?.message || error || '').trim()
  if (!raw) return fallback

  const lower = raw.toLowerCase()
  if (
    lower.includes('incorrect api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('openai') ||
    /platform\.[a-z]+\.com\/account\/api-keys/i.test(raw) ||
    /sk-(?:proj-)?[a-z0-9_-]+/i.test(raw)
  ) {
    return AI_CONFIG_ERROR
  }

  return SECRET_ERROR_PATTERNS.reduce((message, pattern) => message.replace(pattern, '[redacted]'), raw)
}

export { AI_CONFIG_ERROR }
