import { createContext, useContext, useState, useEffect } from 'react'
import en from '../i18n/en.json'
import es from '../i18n/es.json'

const translations = { en, es }
const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('revv_lang') || 'en')

  useEffect(() => {
    localStorage.setItem('revv_lang', lang)
  }, [lang])

  const t = (key) => {
    const keys = key.split('.')
    let val = translations[lang]
    for (const k of keys) val = val?.[k]
    return val || key
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
