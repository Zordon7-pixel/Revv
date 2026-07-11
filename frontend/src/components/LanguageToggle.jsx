import { useLanguage } from '../contexts/LanguageContext'

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage()

  const isEnglish = lang === 'en'
  const flag = isEnglish ? '🇺🇸' : '🇲🇽'
  const code = isEnglish ? 'EN' : 'ES'

  return (
    <button
      type="button"
      onClick={() => setLang(isEnglish ? 'es' : 'en')}
      data-no-auto-i18n="true"
      className="inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-line-2 bg-panel px-3 text-xs font-semibold text-ink transition-colors hover:border-brand"
    >
      <span
        aria-hidden="true"
        className="inline-block text-sm leading-none"
        style={{ fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
      >
        {flag}
      </span>
      <span>{code}</span>
    </button>
  )
}
