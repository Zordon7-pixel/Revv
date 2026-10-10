import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Privacy from '../../pages/Privacy.jsx'

// Mock only the network boundary. Axios transforms, XHR adapter, errors, and
// the application's request/response interceptors all execute for real.
class OfflineXHR {
  static requests = []
  static reply = { status: 200, body: { ok: true } }
  onloadend = null
  headers = {}
  upload = { addEventListener() {} }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(name, value) { this.headers[name.toLowerCase()] = value }
  getAllResponseHeaders() { return 'content-type: application/json\r\n' }
  addEventListener() {}
  abort() { this.onabort?.() }
  send(body) {
    this.body = body
    OfflineXHR.requests.push(this)
    const reply = OfflineXHR.reply
    queueMicrotask(() => {
      if (reply.networkError) { this.onerror({ message: 'Synthetic network failure' }); return }
      this.status = reply.status
      this.statusText = reply.status === 200 ? 'OK' : 'Synthetic error'
      this.responseText = JSON.stringify(reply.body)
      this.onloadend()
    })
  }
}

let api
beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  OfflineXHR.requests = []
  OfflineXHR.reply = { status: 200, body: { ok: true } }
  vi.stubGlobal('XMLHttpRequest', OfflineXHR)
  // All network primitives fail closed unless handled by OfflineXHR above.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected fetch') }))
  api = (await import('../api.js')).default
  api.defaults.adapter = 'xhr'
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('actual Axios browser adapter and REVV API interceptors', () => {
  it('adds authentication and serializes JSON; a later anonymous request has no stale token', async () => {
    localStorage.setItem('sc_token', 'synthetic-token')
    expect((await api.post('/fixture', { message: 'bounded fixture' })).data).toEqual({ ok: true })
    expect(OfflineXHR.requests[0].url).toBe('/api/fixture')
    expect(OfflineXHR.requests[0].headers.authorization).toBe('Bearer synthetic-token')
    expect(JSON.parse(OfflineXHR.requests[0].body)).toEqual({ message: 'bounded fixture' })
    localStorage.removeItem('sc_token')
    await api.get('/fixture')
    expect(OfflineXHR.requests[1].headers.authorization).toBeUndefined()
  })

  it('passes browser multipart FormData through and lets the browser set its boundary', async () => {
    const data = new FormData()
    data.append('note', 'synthetic')
    data.append('file', new File(['bounded'], 'fixture.txt', { type: 'text/plain' }))
    await api.post('/fixture/upload', data)
    expect(OfflineXHR.requests[0].body).toBe(data)
    expect(OfflineXHR.requests[0].headers['content-type']).toBeUndefined()
    expect(data.get('file').name).toBe('fixture.txt')
  })

  it('rejects 401, removes authentication, and selects login without navigating the real browser', async () => {
    const location = { href: '/fixture' }
    // The interceptor reads window at response time; Axios already captured the DOM platform.
    vi.stubGlobal('window', { location })
    localStorage.setItem('sc_token', 'synthetic-token')
    OfflineXHR.reply = { status: 401, body: { error: 'unauthorized' } }
    await expect(api.get('/fixture')).rejects.toMatchObject({ response: { status: 401 }, isAxiosError: true })
    expect(localStorage.getItem('sc_token')).toBeNull()
    expect(location.href).toBe('/login')
  })

  it('propagates server and network failures without clearing a valid token', async () => {
    localStorage.setItem('sc_token', 'synthetic-token')
    OfflineXHR.reply = { status: 503, body: { error: 'temporarily_unavailable' } }
    await expect(api.get('/fixture')).rejects.toMatchObject({ response: { status: 503, data: { error: 'temporarily_unavailable' } } })
    OfflineXHR.reply = { networkError: true }
    await expect(api.get('/fixture')).rejects.toMatchObject({ code: 'ERR_NETWORK' })
    expect(localStorage.getItem('sc_token')).toBe('synthetic-token')
  })
})

it('the real public Privacy page uses an internal router link even with an untrusted query', () => {
  render(React.createElement(MemoryRouter, { initialEntries: ['/privacy?next=https://example.test'] },
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/privacy', element: React.createElement(Privacy) }),
      React.createElement(Route, { path: '/', element: React.createElement('p', null, 'Synthetic home') }))))
  const link = screen.getByRole('link', { name: /back to REVV/i })
  expect(link.getAttribute('href')).toBe('/')
  fireEvent.click(link)
  expect(screen.getByText('Synthetic home')).toBeInTheDocument()
  expect(OfflineXHR.requests).toHaveLength(0)
})
