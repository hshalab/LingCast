import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './locales/en'
import { zh } from './locales/zh'

export const LANG_STORAGE_KEY = 'lingcast-lang'

export type Lang = 'zh' | 'en'

export function getInitialLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  const saved = window.localStorage.getItem(LANG_STORAGE_KEY)
  if (saved === 'zh' || saved === 'en') return saved
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function setLang(lang: Lang) {
  void i18n.changeLanguage(lang)
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // private mode / storage full: ignore
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: getInitialLang(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

i18n.on('languageChanged', (lng) => {
  try {
    document.documentElement.lang = lng === 'zh' ? 'zh-CN' : 'en'
  } catch {
    // document unavailable (tests/SSR): ignore
  }
})

export default i18n
