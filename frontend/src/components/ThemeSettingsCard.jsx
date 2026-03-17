import { useTheme } from '../contexts/ThemeContext'

export default function ThemeSettingsCard() {
  const themeContext = useTheme()
  const theme = themeContext?.theme === 'light' ? 'light' : 'dark'
  const toggleTheme = themeContext?.toggleTheme || (() => {})
  return (
    <div className="bg-panel border border-line rounded-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink text-sm">Theme</h2>
          <p className="text-xs text-faint mt-1">Choose how REVV looks across all pages. Preference is saved on this device.</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${theme === 'dark' ? 'bg-brand' : 'bg-raised'}`}
          aria-pressed={theme === 'dark'}
          aria-label="Toggle dark mode"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</p>
    </div>
  )
}
