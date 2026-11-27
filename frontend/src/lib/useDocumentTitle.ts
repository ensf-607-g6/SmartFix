import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** Sets the browser tab title ("My reports · SmartFix"), which screen readers announce on each page. */
export function useDocumentTitle(page: string | null | undefined) {
  const { t } = useTranslation()
  useEffect(() => {
    document.title = page ? t('a11y.pageTitle', { page }) : 'SmartFix'
  }, [page, t])
}
