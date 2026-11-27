// Typed translation keys: t('some.key') is checked against the English file at build time,
// so a mistyped or missing key fails `npm run typecheck` instead of showing the raw key.
import 'i18next'
import type en from '../locales/en.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
