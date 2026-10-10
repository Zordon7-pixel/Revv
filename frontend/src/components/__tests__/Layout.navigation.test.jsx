import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import Layout from '../Layout.jsx'

// Keep Layout, its back controls and React Router real; only isolate I/O and locale.
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(async () => ({ data: {} })) },
}))
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, lang: 'en', setLang: () => {} }),
}))

function Destination() {
  const { pathname, search, hash } = useLocation()
  return <output data-testid="destination">{pathname}{search}{hash}</output>
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request') }))
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

async function clickBack(storedPath, expected, control = 0) {
  if (storedPath !== null) sessionStorage.setItem('revv_prev_path', storedPath)
  render(
    <MemoryRouter initialEntries={['/customers']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<Destination />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByTestId('destination').textContent).toBe('/customers')
  fireEvent.click(screen.getAllByRole('button', { name: 'Go back' })[control])
  await waitFor(() => expect(screen.getByTestId('destination').textContent).toBe(expected))
}

describe('Layout stored previous destination', () => {
  it.each([
    '/', '/ros', '/ros/synthetic-ro?tab=insurance#details',
    '/ros?status=open&search=Jane%20Doe#results', '/customers?q=100%25',
    '/ros/caf%C3%A9', '/ros/encoded%2Fid', '/ros?next=https%3A%2F%2Fexample.test',
    '/customers?view=recent#top',
  ])('preserves safe internal pathname, query and hash: %s', async (path) => {
    await clickBack(path, path)
  })

  it.each([
    null, '', '/customers', 'ros', '?tab=insurance', '#details',
    'https://evil.example/ros', 'http://evil.example', '//evil.example/ros',
    '///evil.example', 'javascript:alert(1)', 'data:text/html,unsafe',
    '/\\evil.example', '\\evil.example', '/ros\\evil',
    ' /ros', '/ros ', '/\tevil.example', '/ros\n', '/ros\r', '/ros\0', '/ros\u007f',
    '/%2f%2fevil.example', '/%2frevv.invalid/ros', '/%5cevil.example', '/ros?x=%0aevil', '/ros#%00',
    '/%E0%A4%A', '/ros?bad=%', '/%FF', '/a/..//evil.example',
    `/${'x'.repeat(8192)}`,
  ])('falls back to dashboard for unsafe, missing or unchanged path: %s', async (path) => {
    await clickBack(path, '/dashboard')
  })

  it('uses the same validation on the desktop back control', async () => {
    await clickBack('//evil.example', '/dashboard', 1)
  })
})
