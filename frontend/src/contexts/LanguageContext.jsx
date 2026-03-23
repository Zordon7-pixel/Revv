import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import { AUTO_LITERAL_MAPS } from '../i18n/autoLiteralMap'

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
    document.documentElement.lang = lang
  }, [lang])

  const literalMaps = useMemo(() => AUTO_LITERAL_MAPS || {}, [])
  const reverseLiteralMaps = useMemo(() => {
    const out = {}
    Object.entries(literalMaps).forEach(([locale, table]) => {
      const reverse = {}
      Object.entries(table || {}).forEach(([source, translated]) => {
        reverse[translated] = source
      })
      out[locale] = reverse
    })
    return out
  }, [literalMaps])

  const originalTextRef = useRef(new WeakMap())
  const originalAttrRef = useRef(new WeakMap())
  const applyInProgressRef = useRef(false)
  const observerRef = useRef(null)
  const rafRef = useRef(null)

  const mapLiteral = (input, toLang) => {
    const text = String(input ?? '')
    if (!text) return text
    if (toLang === 'en') return text
    const table = literalMaps[toLang]
    if (!table) return text

    if (table[text] != null) return table[text]

    const trimmed = text.trim()
    if (!trimmed) return text
    const translated = table[trimmed]
    if (translated == null) return text

    const lead = text.slice(0, text.indexOf(trimmed))
    const tail = text.slice(text.indexOf(trimmed) + trimmed.length)
    return `${lead}${translated}${tail}`
  }

  const toEnglishLiteral = (input, currentLang) => {
    const text = String(input ?? '')
    if (!text || currentLang === 'en') return text
    const reverse = reverseLiteralMaps[currentLang]
    if (!reverse) return text
    if (reverse[text] != null) return reverse[text]
    const trimmed = text.trim()
    if (!trimmed) return text
    const mapped = reverse[trimmed]
    if (mapped == null) return text
    const lead = text.slice(0, text.indexOf(trimmed))
    const tail = text.slice(text.indexOf(trimmed) + trimmed.length)
    return `${lead}${mapped}${tail}`
  }

  const shouldSkipTextNode = (node) => {
    const parent = node?.parentElement
    if (!parent) return true
    if (parent.closest('[data-no-auto-i18n="true"]')) return true
    const tag = parent.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'CODE' || tag === 'PRE') return true
    return !String(node.nodeValue || '').trim()
  }

  const translateRoot = () => {
    const root = document.getElementById('root')
    if (!root) return
    if (applyInProgressRef.current) return
    applyInProgressRef.current = true
    try {
      const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return shouldSkipTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        },
      })

      let textNode = textWalker.nextNode()
      while (textNode) {
        const existing = originalTextRef.current.get(textNode)
        const base = existing != null ? existing : toEnglishLiteral(textNode.nodeValue, lang)
        if (existing == null) {
          originalTextRef.current.set(textNode, base)
        }
        textNode.nodeValue = lang === 'en' ? base : mapLiteral(base, lang)
        textNode = textWalker.nextNode()
      }

      const elements = root.querySelectorAll('[placeholder], [title], [aria-label], input[value], button[value]')
      const attrs = ['placeholder', 'title', 'aria-label', 'value']
      elements.forEach((el) => {
        if (el.closest('[data-no-auto-i18n="true"]')) return
        const original = originalAttrRef.current.get(el) || {}
        attrs.forEach((attr) => {
          if (!el.hasAttribute(attr)) return
          if (attr === 'value') {
            const tag = el.tagName
            if (tag !== 'INPUT' && tag !== 'BUTTON') return
          }
          if (original[attr] == null) {
            original[attr] = toEnglishLiteral(el.getAttribute(attr), lang)
          }
          const base = original[attr]
          const next = lang === 'en' ? base : mapLiteral(base, lang)
          el.setAttribute(attr, next)
        })
        originalAttrRef.current.set(el, original)
      })
    } finally {
      applyInProgressRef.current = false
    }
  }

  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return undefined

    const scheduleTranslate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        translateRoot()
      })
    }

    scheduleTranslate()
    const observer = new MutationObserver(() => scheduleTranslate())
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    observerRef.current = observer

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      observer.disconnect()
    }
  }, [lang, literalMaps, reverseLiteralMaps])

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
    <LanguageContext.Provider value={{ lang, setLang, t, translateNow: translateRoot }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
