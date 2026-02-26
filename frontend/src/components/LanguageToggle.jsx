import { useLanguage } from '../contexts/LanguageContext'

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage()

  const isEnglish = lang === 'en'
  const label = isEnglish ? '🇺🇸 EN' : '🇲🇽 ES'

  return (
    <button
      type="button"
      onClick={() => setLang(isEnglish ? 'es' : 'en')}
      className="h-7 px-3 inline-flex items-center justify-center rounded-full bg-[#1a1d2e] border border-[#2a2d3e] text-white text-xs font-semibold hover:border-indigo-500 transition-colors"
    >
      {label}
    </button>
  )
}
