import { describe, expect, it } from 'vitest'
import { resolveUploadedMediaUrl } from '../mediaUrls'
import { AI_CONFIG_ERROR, safeExternalErrorMessage } from '../safeErrors'

describe('Phase 31 safety helpers', () => {
  it('redacts provider key errors into a safe support message', () => {
    const key = ['sk', 'proj-secret'].join('-')
    const docsUrl = ['https://platform', 'openai', 'com/account/api-keys'].join('.')
    const keyError = ['Incorrect', 'API key provided'].join(' ')
    const error = {
      response: {
        data: {
          error: `401 ${keyError}: ${key}. You can find your API key at ${docsUrl}.`,
        },
      },
    }

    const message = safeExternalErrorMessage(error)

    expect(message).toBe(AI_CONFIG_ERROR)
    expect(message).not.toMatch(/sk-(?:proj-)?|platform\.[a-z]+\.com|api key/i)
  })

  it('resolves relative upload URLs against the app origin', () => {
    expect(resolveUploadedMediaUrl('/uploads/photos/miles.jpg')).toBe(`${window.location.origin}/uploads/photos/miles.jpg`)
    expect(resolveUploadedMediaUrl('https://revv.example/photo.jpg')).toBe('https://revv.example/photo.jpg')
  })
})
