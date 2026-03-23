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
      className="h-7 px-3 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#1a1d2e] border border-[#2a2d3e] text-white text-xs font-semibold hover:border-indigo-500 transition-colors"
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
