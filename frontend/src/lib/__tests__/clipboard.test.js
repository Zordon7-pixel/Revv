import { describe, it, expect, vi, afterEach } from 'vitest'
import { tryCopyToClipboard } from '../clipboard'

describe('tryCopyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when clipboard write succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(tryCopyToClipboard('https://example.com/approve/token')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://example.com/approve/token')
  })

  it('returns false instead of throwing when clipboard access is denied', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
    })

    await expect(tryCopyToClipboard('https://example.com/approve/token')).resolves.toBe(false)
  })

  it('returns false when the clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {})

    await expect(tryCopyToClipboard('https://example.com/approve/token')).resolves.toBe(false)
  })
})
