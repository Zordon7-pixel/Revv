import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'revv_theme_mode'
const LEGACY_STORAGE_KEY = 'revv-theme'

function normalizeTheme(input) {
  return input === 'light' ? 'light' : 'dark'
}

function readStoredTheme() {
  if (typeof window === 'undefined') return 'dark'
  const modern = localStorage.getItem(STORAGE_KEY)
  if (modern === 'light' || modern === 'dark') return modern
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
  return normalizeTheme(legacy)
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => normalizeTheme(readStoredTheme()))

  useEffect(() => {
    const mode = normalizeTheme(theme)
    localStorage.setItem(STORAGE_KEY, mode)
    // Keep legacy key in sync so older PR tooling / bookmarks stay coherent.
    localStorage.setItem(LEGACY_STORAGE_KEY, mode)
    const root = document.documentElement
    root.classList.toggle('theme-light', mode === 'light')
    root.classList.toggle('theme-dark', mode !== 'light')
    root.classList.toggle('dark', mode === 'dark')
    root.classList.toggle('light', mode === 'light')
    root.setAttribute('data-theme', mode)
  }, [theme])

  const value = useMemo(() => ({
    theme: normalizeTheme(theme),
    setTheme: (next) => setThemeState(normalizeTheme(next)),
    toggleTheme: () => setThemeState((prev) => (normalizeTheme(prev) === 'dark' ? 'light' : 'dark')),
    isLight: normalizeTheme(theme) === 'light',
  }), [theme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
