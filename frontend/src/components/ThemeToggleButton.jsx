import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

export default function ThemeToggleButton({ mobile = false }) {
  const themeContext = useTheme()
  const theme = themeContext?.theme === 'light' ? 'light' : 'dark'
  const toggleTheme = themeContext?.toggleTheme || (() => {})
  const themeToggleLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`${mobile ? 'h-8 w-8' : 'h-9 w-9'} grid place-items-center rounded-lg border border-line-2 bg-void text-muted transition-colors hover:border-brand hover:text-ink`}
      aria-label={themeToggleLabel}
      title={themeToggleLabel}
    >
      {theme === 'dark' ? <Sun size={mobile ? 16 : 17} /> : <Moon size={mobile ? 16 : 17} />}
    </button>
  )
}
