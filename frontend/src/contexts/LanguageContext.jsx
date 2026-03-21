import { createContext, useContext, useState, useEffect } from 'react'
import en from '../i18n/en.json'
import es from '../i18n/es.json'

const translations = { en, es }
const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('revv_lang') || 'en'
    return translations[saved] ? saved : 'en'
  })

  useEffect(() => {
    if (!translations[lang]) {
      setLang('en')
      return
    }
    localStorage.setItem('revv_lang', lang)
  }, [lang])

  const t = (key) => {
    const keys = key.split('.')
    let val = translations[lang] || translations.en
    for (const k of keys) val = val?.[k]
    if (val != null) return val
    let fallback = translations.en
    for (const k of keys) fallback = fallback?.[k]
    return fallback || key
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
