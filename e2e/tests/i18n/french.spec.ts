import { USERS } from '../../support/env'
import { expect, stubExternal, test } from '../../support/fixtures'
import { assignedIssue } from '../../support/flows'

/** The UI text comes from frontend/src/locales/{en,fr}.json via i18next. */
test.describe('French translation (i18n)', () => {
  test('?lng=fr switches the login page to French and the choice is remembered', async ({ page }) => {
    await page.goto('/login?lng=fr')

    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.getByLabel('Courriel', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Mot de passe', { exact: true })).toBeVisible()
    await expect(page.locator('form').getByRole('button', { name: 'Se connecter' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('smartfix.lang'))).toBe('fr')
  })

  test('a browser set to French gets French without any switch', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-CA' })
    await stubExternal(context)
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await context.close()
  })

  test('English stays the default for an English browser', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('signed-in pages, status labels and plurals are translated', async ({ page, signIn, api, freshResident }) => {
    const a = await assignedIssue(api, { resident: freshResident, type: 'water_leak' })
    await page.goto('/login?lng=fr')
    await signIn(freshResident)

    const sidebar = page.locator('aside').first()
    await expect(sidebar.getByRole('link', { name: 'Signaler un problème' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Mes signalements' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Mes signalements', level: 1 })).toBeVisible()
    await expect(page.locator('main ul > li').filter({ hasText: a.address })).toContainText('Équipe assignée')

    await page.goto(`/resident/reports/${a.reportId}`)
    await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible()
    await expect(page.getByText('Échéance', { exact: true })).toBeVisible()
  })

  test('operator pages are translated too', async ({ page, signIn }) => {
    await page.goto('/login?lng=fr')
    await signIn(USERS.operator)
    await expect(page.getByRole('heading', { name: 'File de priorité' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Escaladés seulement' })).toBeVisible()
    await expect(page.locator('header').getByText(/\d+ problèmes? ouverts?/)).toBeVisible()

    await page.goto('/ops/stats')
    await expect(page.getByRole('heading', { name: 'Statistiques de réparation', level: 1 })).toBeVisible()
  })
})
