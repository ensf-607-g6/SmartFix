/**
 * Internationalisation (i18next + react-i18next). Every visible string lives in
 * src/locales/<lang>.json; components read them with `useTranslation()` / `t('key')`.
 *
 * Language is picked from, in order: `?lng=fr` in the URL, the last choice (saved in
 * localStorage under "smartfix.lang"), then the browser language. English is the fallback.
 */
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import fr from '../locales/fr.json'

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const resources = {
  en: { translation: en },
  fr: { translation: fr },
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true, // fr-CA, fr-FR -> fr
    initAsync: false, // resources are bundled, so translations are ready before the first render
    interpolation: { escapeValue: false }, // React already escapes output
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lng',
      lookupLocalStorage: 'smartfix.lang',
      caches: ['localStorage'],
    },
  })

const syncHtmlLang = (lng: string) => {
  document.documentElement.lang = lng.split('-')[0]
}
syncHtmlLang(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', syncHtmlLang)

export default i18n
