import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import appSource from '../../App.jsx?raw'
import { LanguageProvider } from '../../contexts/LanguageContext'
import BookAppointment from '../BookAppointment'
import PublicEstimateRequest, { compressImage, validIntakePhoto } from '../PublicEstimateRequest'
import ShopProfile from '../ShopProfile'
import Settings, { PublicIntakeSettings } from '../Settings'
import qrcode from '../../lib/vendor/qrcode.mjs'
import Dashboard from '../Dashboard'
import Appointments from '../Appointments'

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('../../components/AgreementTemplates', () => ({ default: () => null }))
vi.mock('../../components/AgreementArchive', () => ({ default: () => null }))
import api from '../../lib/api'

const slug = 'abcdefghijklmnop'
const nextSlug = 'qrstuvwxyz234567'
const legacy = '12345678-1234-1234-1234-123456789abc'
const identity = { name: 'Verified Shop', logo_url: '/uploads/logo.png' }
const response = (data = identity, status = 200) => ({ ok: status < 400, status, json: async () => data })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
let navigate
function Navigation() {
  navigate = useNavigate()
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}
function mount(element, entry = '/') {
  return render(<LanguageProvider><MemoryRouter initialEntries={[entry]}>{element}<Navigation /></MemoryRouter></LanguageProvider>)
}
function login(role) { localStorage.setItem('sc_token', `header.${btoa(JSON.stringify({ role }))}.signature`) }
function noForm(container) {
  expect(container.querySelector('form')).toBeNull()
  expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument()
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  localStorage.setItem('revv_lang', 'en')
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

for (const [name, Component, path, endpoint] of [
  ['booking', BookAppointment, '/book', '/api/appointments/request'],
  ['estimate', PublicEstimateRequest, '/estimate-request', '/api/public/estimate-request'],
]) describe(`${name} shop routing`, () => {
  it('blocks missing shop without making any request', () => {
    const { container } = mount(<Component />, path)
    expect(screen.getByRole('heading', { name: 'Shop link required' })).toBeInTheDocument()
    noForm(container)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['garbage!', 'zzzzzzzzzzzz'])('blocks invalid or unknown link %s', async link => {
    fetch.mockResolvedValue(response({ code: 'SHOP_NOT_FOUND' }, 404))
    const { container } = mount(<Component />, `${path}?shop=${encodeURIComponent(link)}`)
    await screen.findByRole('heading', { name: 'Shop link required' })
    noForm(container)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(`/api/public/intake/${encodeURIComponent(link)}`)
  })

  it.each(['network', 'server', 'malformed'])('blocks %s errors and allows retry', async kind => {
    if (kind === 'network') fetch.mockRejectedValueOnce(new Error('Offline'))
    else fetch.mockResolvedValueOnce(response(kind === 'malformed' ? {} : { error: 'failure' }, kind === 'server' ? 500 : 200))
    const { container } = mount(<Component />, `${path}?shop=${slug}`)
    await screen.findByRole('heading', { name: 'Unable to verify shop' })
    noForm(container)
    fetch.mockResolvedValueOnce(response())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText(identity.name)
    expect(container.querySelector('form')).not.toBeNull()
  })

  it('blocks loading and ignores late valid identity after navigating to an invalid link', async () => {
    const pending = deferred()
    fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({}, 404))
    const { container } = mount(<Component />, `${path}?shop=${slug}`)
    expect(screen.getByRole('heading', { name: 'Loading shop…' })).toBeInTheDocument()
    noForm(container)
    await act(async () => navigate(`${path}?shop=invalid`))
    await screen.findByText('Shop link required')
    await act(async () => pending.resolve(response()))
    noForm(container)
    expect(screen.queryByText(identity.name)).not.toBeInTheDocument()
  })

  it('immediately removes an already valid form on query change, including its old submit handler', async () => {
    fetch.mockResolvedValueOnce(response()).mockReturnValueOnce(new Promise(() => {}))
    const { container } = mount(<Component />, `${path}?shop=${slug}`)
    await screen.findByText(identity.name)
    const oldForm = container.querySelector('form')
    expect(oldForm).not.toBeNull()
    await act(async () => navigate(`${path}?shop=unknown`))
    noForm(container)
    fireEvent.submit(oldForm)
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    await act(async () => navigate(path))
    noForm(container)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([slug, legacy])('shows authoritative identity and submits with query %s, no body shop_id', async link => {
    fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ok: true }, 201))
    const { container } = mount(<Component />, `${path}?shop=${link}&name=Spoofed`)
    await screen.findByText(identity.name)
    expect(screen.queryByText('Spoofed')).not.toBeInTheDocument()
    expect(screen.getByAltText('Verified Shop logo')).toHaveAttribute('src', `${window.location.origin}/uploads/logo.png`)
    fireEvent.change(screen.getByLabelText(name === 'booking' ? 'Customer name' : 'Full name'), { target: { value: 'Test Customer' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '5551234567' } })
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch.mock.calls[1][0]).toBe(`${endpoint}?shop=${link}`)
    const body = JSON.parse(fetch.mock.calls[1][1].body)
    expect(body).toMatchObject({ name: 'Test Customer', phone: '5551234567' })
    expect(body).not.toHaveProperty('shop_id')
    await screen.findByRole('heading', { name: name === 'booking' ? 'Request received' : 'Request submitted' })
  })

  it('removes the form when a rotated link is rejected during submission', async () => {
    fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ code: 'SHOP_NOT_FOUND' }, 404))
    const { container } = mount(<Component />, `${path}?shop=${slug}`)
    await screen.findByText(identity.name)
    fireEvent.submit(container.querySelector('form'))
    await screen.findByRole('heading', { name: 'Shop link required' })
    noForm(container)
  })

  it('surfaces server validation without showing success', async () => {
    fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ error: 'Validation failed' }, 400))
    const { container } = mount(<Component />, `${path}?shop=${slug}`)
    await screen.findByText(identity.name)
    fireEvent.submit(container.querySelector('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed')
    expect(container.querySelector('form')).not.toBeNull()
  })
})

describe('photo validation', () => {
  it('checks exact decoded byte boundary, supported types, and canonical base64', () => {
    for (const mime of ['jpeg', 'png', 'webp']) {
      expect(validIntakePhoto(`data:image/${mime};base64,${btoa('x'.repeat(300 * 1024))}`)).toBe(true)
      expect(validIntakePhoto(`data:image/${mime};base64,${btoa('x'.repeat(300 * 1024 + 1))}`)).toBe(false)
    }
    for (const data of ['data:image/gif;base64,eA==', 'data:image/svg+xml;base64,eA==', 'data:image/jpeg;base64,', 'data:image/png;base64,eB==', 'data:image/png;base64,%%%']) expect(validIntakePhoto(data)).toBe(false)
  })

  it('rejects disallowed MIME before decoding and rejects oversized encoded results', async () => {
    await expect(compressImage(new File(['x'], 'photo.gif', { type: 'image/gif' }))).rejects.toThrow('JPEG, PNG or WebP')
    vi.stubGlobal('FileReader', class { readAsDataURL() { this.result = 'data:image/png;base64,eA=='; this.onload() } })
    vi.stubGlobal('Image', class { width = 2000; height = 4000; set src(value) { this.onload() } })
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage })
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/jpeg;base64,${btoa('x'.repeat(300 * 1024 + 1))}`)
    await expect(compressImage(new File(['x'], 'photo.png', { type: 'image/png' }))).rejects.toThrow('300 KB')
    expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 640, 1280])
    encode.mockReturnValue('data:image/jpeg;base64,eA==')
    await expect(compressImage(new File(['x'], 'photo.webp', { type: 'image/webp' }))).resolves.toBe('data:image/jpeg;base64,eA==')
  })

  it('waits for photo encoding and submits at most five validated images to the resolved shop', async () => {
    const readers = []
    vi.stubGlobal('FileReader', class { readAsDataURL() { this.result = 'data:image/png;base64,eA=='; readers.push(this) } })
    vi.stubGlobal('Image', class { width = 600; height = 400; set src(value) { this.onload() } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,eA==')
    fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ok: true }, 201))
    const { container } = mount(<PublicEstimateRequest />, `/estimate-request?shop=${slug}`)
    const input = await screen.findByLabelText('Damage photos')
    fireEvent.change(input, { target: { files: Array.from({ length: 5 }, () => new File(['x'], 'a.png', { type: 'image/png' })) } })
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled()
    fireEvent.submit(container.querySelector('form'))
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => readers.forEach(reader => reader.onload()))
    expect(screen.getAllByAltText(/^Damage \d/)).toHaveLength(5)
    fireEvent.change(input, { target: { files: [new File(['x'], 'sixth.png', { type: 'image/png' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('up to 5')
    expect(screen.getAllByAltText(/^Damage \d/)).toHaveLength(5)
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch.mock.calls[1][0]).toBe(`/api/public/estimate-request?shop=${slug}`)
    expect(JSON.parse(fetch.mock.calls[1][1].body).photos).toEqual(Array(5).fill('data:image/jpeg;base64,eA=='))
  })

  it('surfaces too many files and invalid MIME in the estimate UI', async () => {
    fetch.mockResolvedValue(response())
    mount(<PublicEstimateRequest />, `/estimate-request?shop=${slug}`)
    const input = await screen.findByLabelText('Damage photos')
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    fireEvent.change(input, { target: { files: Array.from({ length: 6 }, () => new File(['x'], 'a.png', { type: 'image/png' })) } })
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 5')
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.svg', { type: 'image/svg+xml' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('JPEG, PNG or WebP')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('profile and staff queue', () => {
  it.each([slug, undefined])('uses data.shop.public_intake_slug safely: %s', async public_intake_slug => {
    api.get.mockResolvedValue({ data: { shop: { name: 'Profile Shop', public_intake_slug } } })
    mount(<Routes><Route path="/shop/:shopId" element={<ShopProfile />} /><Route path="/book" element={<p>Booking destination</p>} /></Routes>, '/shop/shop-id')
    await screen.findByText('Profile Shop')
    expect(api.get).toHaveBeenCalledWith('/public/shop/shop-id')
    const buttons = screen.getAllByRole('button', { name: 'Book appointment' })
    for (const button of buttons) expect(button.disabled).toBe(!public_intake_slug)
    fireEvent.click(buttons[0])
    expect(screen.getByTestId('location')).toHaveTextContent(public_intake_slug ? `/book?shop=${slug}` : '/shop/shop-id')
  })

  it('routes dashboard appointment action to the actual authenticated queue', async () => {
    login('owner')
    api.get.mockImplementation(url => Promise.resolve({ data: url === '/appointments' ? { requests: [{ id: 'request-1', name: 'Queue Customer', phone: '5551234567', service: 'Body Work' }] } : { ros: [], queue: [], byStatus: [] } }))
    api.put.mockResolvedValue({ data: { request: { status: 'confirmed' } } })
    mount(<Routes><Route path="/dashboard" element={<Dashboard />} /><Route path="/appointments" element={<Appointments />} /></Routes>, '/dashboard')
    fireEvent.click(await screen.findByRole('button', { name: /1 appointment request/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/appointments')
    await screen.findByText('Queue Customer')
    fireEvent.click(screen.getByRole('button', { name: 'Mark confirmed' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/appointments/request-1', { status: 'confirmed' }))
    await screen.findByText('No pending appointment requests.')
    const app = appSource
    expect(app).toContain('<Route path="appointments" element={<AdminRoute><Appointments /></AdminRoute>} />')
    expect(app.indexOf('<Route path="appointments"')).toBeGreaterThan(app.indexOf('<Route element={<PrivateRoute><Layout /></PrivateRoute>}>'))
  })

  it('shows queue load and update errors with recovery', async () => {
    api.get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ data: { requests: [{ id: 'r', name: 'Customer' }] } })
    api.put.mockRejectedValue(new Error('Offline'))
    mount(<Appointments />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
    fireEvent.click(screen.getByRole('button', { name: 'Reload requests' }))
    await screen.findByText('Customer')
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not update'))
    expect(screen.getByText('Customer')).toBeInTheDocument()
  })
})

// Provenance: unmodified qrcode-generator@2.0.4 npm package/dist/qrcode.mjs,
// SHA-256 ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0.
// MIT license from upstream official js2.0.4 tag; both supplied by Hermes.
function assertQr(label, path, linkSlug) {
  const url = `${window.location.origin}${path}?shop=${linkSlug}`
  const img = screen.getByRole('img', { name: `${label} link QR code` })
  expect(img.style.width).toBe('100%')
  expect(img.style.maxWidth).toBe('192px')
  expect(screen.getByRole('link', { name: `Open ${label.toLowerCase()} link` })).toHaveAttribute('href', url)
  expect(img.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  const svg = new DOMParser().parseFromString(decodeURIComponent(img.src.split(',')[1]), 'image/svg+xml')
  const code = qrcode(0, 'M')
  // These same-origin URLs are ASCII. Feed exact URL, independently of UI byte conversion.
  code.addData(url, 'Byte')
  code.make()
  const count = code.getModuleCount()
  expect(count).toBeGreaterThanOrEqual(21)
  expect(svg.documentElement.getAttribute('viewBox')).toBe(`0 0 ${count + 8} ${count + 8}`)
  expect(svg.querySelector('rect').getAttribute('fill')).toBe('white')
  expect(svg.querySelector('path').getAttribute('fill')).toBe('black')
  const pathData = svg.querySelector('path').getAttribute('d')
  const cells = [...pathData.matchAll(/M(\d+),(\d+)l1,0 0,1 -1,0 0,-1z /g)]
  expect(cells.map(match => match[0]).join('')).toBe(pathData)
  const dark = new Set(cells.map(([, x, y]) => `${Number(y) - 4},${Number(x) - 4}`))
  // Validate every rendered module against the real encoder for this exact URL.
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) expect(dark.has(`${row},${col}`)).toBe(code.isDark(row, col))
  }
  // No drawn modules intrude into the four-module quiet zone.
  for (const [, x, y] of cells) {
    expect(Number(x)).toBeGreaterThanOrEqual(4)
    expect(Number(y)).toBeGreaterThanOrEqual(4)
    expect(Number(x)).toBeLessThan(count + 4)
    expect(Number(y)).toBeLessThan(count + 4)
  }
  return img.src
}

describe('public link settings', () => {
  function mockSettings() {
    api.get.mockImplementation(url => Promise.resolve({ data: url === '/settings/public-intake' ? { public_intake_slug: slug } : url === '/market/shop' ? { name: 'Shop' } : {} }))
  }

  it.each(['owner', 'admin', 'assistant', 'technician', 'superadmin'])('only owners/admins see and load the links: %s', async role => {
    login(role)
    mockSettings()
    mount(<Settings />)
    await screen.findByText('Shop settings')
    if (['owner', 'admin'].includes(role)) {
      expect(await screen.findByLabelText('Estimate link')).toHaveValue(`${window.location.origin}/estimate-request?shop=${slug}`)
      expect(api.get).toHaveBeenCalledWith('/settings/public-intake')
    } else {
      expect(screen.queryByText('Public shop links')).not.toBeInTheDocument()
      expect(api.get).not.toHaveBeenCalledWith('/settings/public-intake')
    }
  })

  it('copies both same-origin links and confirms rotation before updating both', async () => {
    mockSettings()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText })
    const rotate = deferred()
    api.post.mockReturnValue(rotate.promise)
    const { container } = mount(<PublicIntakeSettings />)
    await screen.findByLabelText('Estimate link')
    const beforeEstimate = assertQr('Estimate', '/estimate-request', slug)
    const beforeBooking = assertQr('Booking', '/book', slug)
    fireEvent.click(screen.getByRole('button', { name: 'Copy estimate link' }))
    await screen.findByText('Estimate link copied.')
    fireEvent.click(screen.getByRole('button', { name: 'Copy booking link' }))
    await screen.findByText('Booking link copied.')
    expect(writeText.mock.calls.map(([text]) => text)).toEqual([`${window.location.origin}/estimate-request?shop=${slug}`, `${window.location.origin}/book?shop=${slug}`])
    fireEvent.click(screen.getByRole('button', { name: 'Rotate public links' }))
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate public links' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace public links' }))
    expect(screen.queryByLabelText('Estimate link')).not.toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/settings/public-intake/rotate')
    await act(async () => rotate.resolve({ data: { public_intake_slug: nextSlug } }))
    expect(screen.getByLabelText('Estimate link')).toHaveValue(`${window.location.origin}/estimate-request?shop=${nextSlug}`)
    expect(screen.getByLabelText('Booking link')).toHaveValue(`${window.location.origin}/book?shop=${nextSlug}`)
    expect(container.innerHTML).not.toContain(slug)
    expect(assertQr('Estimate', '/estimate-request', nextSlug)).not.toBe(beforeEstimate)
    expect(assertQr('Booking', '/book', nextSlug)).not.toBe(beforeBooking)
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })

  it('handles clipboard failure with a manually selectable link', async () => {
    mockSettings()
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText: vi.fn().mockRejectedValue(new Error('Denied')) })
    mount(<PublicIntakeSettings />)
    await screen.findByLabelText('Booking link')
    fireEvent.click(screen.getByRole('button', { name: 'Copy booking link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Select and copy')
    expect(screen.getByLabelText('Booking link')).toHaveValue(`${window.location.origin}/book?shop=${slug}`)
  })

  it('fails closed on load and ambiguous rotation failures; reloads current links', async () => {
    api.get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ data: { public_intake_slug: slug } })
    api.post.mockRejectedValue(new Error('Timeout after possible rotation'))
    mount(<PublicIntakeSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
    expect(screen.queryByLabelText('Estimate link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload public links' }))
    await screen.findByLabelText('Estimate link')
    fireEvent.click(screen.getByRole('button', { name: 'Rotate public links' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace public links' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm link rotation'))
    expect(screen.queryByLabelText('Estimate link')).not.toBeInTheDocument()
    api.get.mockResolvedValue({ data: { public_intake_slug: nextSlug } })
    fireEvent.click(screen.getByRole('button', { name: 'Reload public links' }))
    expect(await screen.findByLabelText('Booking link')).toHaveValue(`${window.location.origin}/book?shop=${nextSlug}`)
  })
})
