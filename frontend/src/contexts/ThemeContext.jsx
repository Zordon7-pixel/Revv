import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'revv_theme_mode'

function normalizeTheme(input) {
  return input === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => normalizeTheme(localStorage.getItem(STORAGE_KEY) || 'dark'))

  useEffect(() => {
    const mode = normalizeTheme(theme)
    localStorage.setItem(STORAGE_KEY, mode)
    const root = document.documentElement
    root.classList.toggle('theme-light', mode === 'light')
    root.classList.toggle('theme-dark', mode !== 'light')
    root.setAttribute('data-theme', mode)
  }, [theme])

  const value = useMemo(() => ({
    theme: normalizeTheme(theme),
    setTheme: (next) => setTheme(normalizeTheme(next)),
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

