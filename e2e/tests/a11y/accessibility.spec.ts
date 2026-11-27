import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { AppShell } from '../../pages/AppShell'
import { CrewPage } from '../../pages/CrewPage'
import { LiveMapPage } from '../../pages/OperatorPages'
import { NewReportPage, ReportDetailPage } from '../../pages/ResidentPages'
import { USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { completedIssue, inProgressIssue, reportNeedingReview } from '../../support/flows'

/** WCAG 2.1 level A and AA, the usual target for public-sector web apps. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Run axe on the current page and fail with a readable list of violations. */
async function expectNoViolations(page: Page, what: string) {
  // Let data, fonts and live updates settle so axe sees the finished page.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const report = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`,
  )
  expect(report, `accessibility violations on ${what}`).toEqual([])
}

test.describe('Screen-reader and keyboard accessibility (WCAG 2.1 AA)', () => {
  test.describe('axe scans', () => {
    test('login and registration', async ({ page }) => {
      await page.goto('/login')
      await expectNoViolations(page, 'login')
      await page.getByRole('button', { name: 'Create an account', exact: true }).click()
      await expectNoViolations(page, 'register')
    })

    test('resident: report form, my reports, report detail with the confirmation panel', async ({ page, signIn, api, freshResident }) => {
      const c = await completedIssue(api, { resident: freshResident, type: 'streetlight' })
      await signIn(freshResident, '/resident/new')
      await expectNoViolations(page, 'report form')
      await page.goto('/resident/reports')
      await expectNoViolations(page, 'my reports')
      await page.goto(`/resident/reports/${c.reportId}`)
      await expect(new ReportDetailPage(page).confirmPanel).toBeVisible()
      await expectNoViolations(page, 'report detail')
    })

    test('crew: work orders and the complete-repair dialog', async ({ page, signIn, api }) => {
      const a = await inProgressIssue(api, { type: 'water_leak' })
      await signIn(USERS.crewWater)
      const crew = new CrewPage(page)
      await crew.select(a.address)
      await expectNoViolations(page, 'crew portal')
      await crew.completeRepair.click()
      await expect(crew.modal).toBeVisible()
      await expectNoViolations(page, 'complete-repair dialog')
    })

    test('operator: live map, issue drawer, review queue, statistics', async ({ page, signIn, api }) => {
      const a = await inProgressIssue(api, { type: 'streetlight' })
      await reportNeedingReview(api)
      await signIn(USERS.operator)
      const map = new LiveMapPage(page)
      await expect(map.item(a.address)).toBeVisible()
      await expectNoViolations(page, 'live map')
      const drawer = await map.open(a.address)
      await expectNoViolations(page, 'issue drawer')
      await drawer.timelineTab.click()
      await expectNoViolations(page, 'issue timeline')
      await drawer.close.click()
      await page.goto('/ops/review')
      await expect(page.locator('article').first()).toBeVisible()
      await expectNoViolations(page, 'review queue')
      await page.goto('/ops/stats')
      await expectNoViolations(page, 'statistics')
    })

    test('notification panel', async ({ page, signIn }) => {
      await signIn(USERS.operator)
      const shell = new AppShell(page)
      await shell.openNotifications()
      await expectNoViolations(page, 'notification panel')
    })

    test('the French interface passes too', async ({ page, signIn }) => {
      await page.goto('/login?lng=fr')
      await expectNoViolations(page, 'login (fr)')
      await signIn(USERS.operator)
      await expectNoViolations(page, 'live map (fr)')
    })
  })

  test.describe('keyboard and screen-reader behaviour', () => {
    test('each page has its own title', async ({ page, signIn, freshResident }) => {
      await page.goto('/login')
      await expect(page).toHaveTitle('Sign in · SmartFix')
      await signIn(freshResident)
      await expect(page).toHaveTitle('My reports · SmartFix')
      await page.goto('/resident/new')
      await expect(page).toHaveTitle('Report a problem · SmartFix')
    })

    test('"Skip to main content" is the first tab stop and moves focus to the page content', async ({ page, signIn }) => {
      await signIn(USERS.operator, '/ops/stats')
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: 'Skip to main content' })
      await expect(skip).toBeFocused()
      await expect(skip).toBeInViewport()
      await page.keyboard.press('Enter')
      await expect(page.locator('#main-content')).toBeFocused()
    })

    test('the main navigation is a labelled landmark that marks the current page', async ({ page, signIn }) => {
      await signIn(USERS.operator)
      const nav = page.getByRole('navigation', { name: 'Main' })
      await expect(nav.getByRole('link', { name: /Live map/ })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('the issue drawer is a dialog that takes focus, traps Tab, closes on Escape and returns focus', async ({ page, signIn, api }) => {
      const a = await inProgressIssue(api, { type: 'water_leak' })
      await signIn(USERS.operator)
      const map = new LiveMapPage(page)
      const opener = map.item(a.address).getByRole('button')
      await opener.focus()
      await page.keyboard.press('Enter')

      const dialog = page.getByRole('dialog', { name: /Water leak/ })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab')
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
      }
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(opener).toBeFocused()
    })

    test('the complete-repair dialog closes on Escape', async ({ page, signIn, api }) => {
      const a = await inProgressIssue(api, { type: 'streetlight' })
      await signIn(USERS.crewLights)
      const crew = new CrewPage(page)
      await crew.select(a.address)
      await crew.completeRepair.click()
      const dialog = page.getByRole('dialog', { name: 'Complete repair' })
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(crew.completeRepair).toBeFocused()
    })

    test('a keyboard user can drop the map pin with Enter', async ({ page, signIn, freshResident }) => {
      await signIn(freshResident, '/resident/new')
      const form = new NewReportPage(page)
      const map = page.getByRole('region', { name: 'Map for placing the pin' })
      await expect(map).toHaveAttribute('aria-describedby', /.+/)
      await map.focus()
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Enter')
      await expect(page.getByText('Pin placed. Click again to move it.')).toBeVisible()
      await expect(form.stillNeeded).toHaveText('Still needed: a photo, a category')
    })

    test('toggle buttons say whether they are on', async ({ page, signIn, freshResident }) => {
      await signIn(freshResident, '/resident/new')
      const pothole = page.getByRole('button', { name: 'Pothole', exact: true })
      await expect(pothole).toHaveAttribute('aria-pressed', 'false')
      await pothole.click()
      await expect(pothole).toHaveAttribute('aria-pressed', 'true')

      await signIn(USERS.operator)
      const severity5 = page.getByRole('button', { name: 'Severity 5', exact: true })
      await severity5.click()
      await expect(severity5).toHaveAttribute('aria-pressed', 'true')
    })

    test('errors are announced as alerts', async ({ page }) => {
      await page.goto('/login')
      await page.getByLabel('Email', { exact: true }).fill(USERS.resident)
      await page.getByLabel('Password', { exact: true }).fill('wrong-password')
      await page.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect')
    })

    test('the notification bell reports its state and the panel closes on Escape', async ({ page, signIn }) => {
      await signIn(USERS.operator)
      const shell = new AppShell(page)
      await expect(shell.bell).toHaveAttribute('aria-expanded', 'false')
      await shell.bell.click()
      await expect(shell.bell).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('dialog', { name: 'Notifications panel' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Notifications panel' })).toBeHidden()
      await expect(shell.bell).toBeFocused()
    })
  })
})
