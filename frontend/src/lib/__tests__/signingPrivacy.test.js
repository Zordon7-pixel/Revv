import { afterEach, describe, expect, it } from 'vitest'
import { isSigningPage, scrubSigningSecrets } from '../signingPrivacy'
import { beforeSend } from '../sentry'

afterEach(() => window.history.replaceState({}, '', '/'))
describe('agreement signing privacy', () => {
  it('suppresses error reporting on either signing URL spelling', () => {
    for (const path of ['/sign#', '/sign/#']) {
      window.history.replaceState({}, '', path + 'a'.repeat(64))
      expect(isSigningPage()).toBe(true)
      expect(beforeSend({ request: { url: window.location.href } })).toBeNull()
    }
  })
  it('removes signing secrets from retained navigation breadcrumbs after leaving the page', () => {
    const token = 'a'.repeat(64)
    const event = { breadcrumbs: [{ data: { from: `https://revvshop.app/sign#${token}`, to: `https://revvshop.app/sign/#${token}` } }] }
    expect(JSON.stringify(scrubSigningSecrets(event))).not.toContain(token)
    expect(JSON.stringify(beforeSend(event))).not.toContain(token)
    expect(event.breadcrumbs[0].data.from).toContain(token)
  })
  it('scrubs agreement API request bodies and authentication headers', () => {
    const safe = beforeSend({ request: { url: '/api/agreements/public/session/sign', data: { name: 'Customer Name' }, headers: { authorization: 'Bearer secret' } } })
    expect(safe.request.data).toBe('[scrubbed: PII path]')
    expect(safe.request.headers.authorization).toBeUndefined()
  })
})
