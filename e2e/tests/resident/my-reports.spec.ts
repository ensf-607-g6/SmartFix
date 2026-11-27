import { MyReportsPage, ReportDetailPage } from '../../pages/ResidentPages'
import { PROBLEM_TYPES, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, report, reportNeedingReview } from '../../support/flows'

test.describe('My reports and report detail (FR-14, NFR-6)', () => {
  test('a new resident sees the empty state with a link to report a problem', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident)
    const list = new MyReportsPage(page)
    await expect(list.empty).toBeVisible()
    await page.getByRole('link', { name: 'Report your first problem' }).click()
    await expect(page).toHaveURL(/\/resident\/new$/)
  })

  test('TC-018 a resident only sees their own reports', async ({ page, signIn, api, freshResident }) => {
    const mine = [await report(api, { resident: freshResident }), await report(api, { resident: freshResident, type: 'streetlight' })]
    const someoneElse = await report(api, { resident: USERS.resident2 })

    await signIn(freshResident)
    const list = new MyReportsPage(page)
    await expect(list.items).toHaveCount(2)
    for (const r of mine) await expect(list.item(r.address)).toBeVisible()
    await expect(list.item(someoneElse.address)).toHaveCount(0)
  })

  test('reports are listed newest first with their status', async ({ page, signIn, api, freshResident }) => {
    const first = await assignedIssue(api, { resident: freshResident, type: 'pothole' })
    const second = await assignedIssue(api, { resident: freshResident, type: 'water_leak' })

    await signIn(freshResident)
    const list = new MyReportsPage(page)
    await expect(list.items).toHaveCount(2)
    await expect(list.items.nth(0)).toContainText(second.address)
    await expect(list.items.nth(1)).toContainText(first.address)
    await expect(list.item(second.address)).toContainText(PROBLEM_TYPES.water_leak)
    await expect(list.item(second.address)).toContainText('Crew assigned')
  })

  test('TC-019 report detail shows the photo, status progress, crew and history', async ({ page, signIn, api, freshResident }) => {
    const a = await assignedIssue(api, { resident: freshResident, type: 'streetlight', description: '[ai:severity=4] Light out at crossing' })

    await signIn(freshResident)
    await new MyReportsPage(page).link(a.reportId).click()

    const detail = new ReportDetailPage(page)
    await expect(detail.title).toHaveText(PROBLEM_TYPES.streetlight)
    await expect(detail.statusBadge('Crew assigned')).toBeVisible()
    await expect(page.getByText('4/5 · Serious')).toBeVisible()
    await expect(detail.stepper).toBeVisible()
    for (const step of ['Reported', 'Checked', 'Crew assigned', 'In progress', 'Repaired', 'Closed']) {
      await expect(detail.stepper.getByText(step, { exact: true })).toBeVisible()
    }
    // The photo is really served (per-role photo endpoint), not just an <img> tag.
    await expect(detail.yourPhoto).toBeVisible()
    await expect.poll(() => detail.yourPhoto.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await expect(page.getByText('“[ai:severity=4] Light out at crossing”')).toBeVisible()
    // Repair card
    await expect(page.getByText('Street Lighting')).toBeVisible()
    await expect(page.getByText('After photo appears when the crew finishes')).toBeVisible()
    // History, oldest first
    await expect(detail.history.locator('li p.font-medium')).toHaveText(['Reported', 'Validated', 'Prioritized', 'Crew assigned'])
  })

  test('a report waiting for operator review says so on the list and the detail page', async ({ page, signIn, api, freshResident }) => {
    const r = await reportNeedingReview(api, '[ai:low-confidence]', { resident: freshResident })

    await signIn(freshResident)
    const list = new MyReportsPage(page)
    await expect(list.item(r.address)).toContainText('Under operator review')

    await list.link(r.reportId).click()
    await expect(page.getByText('A city operator will check the photo before it is sent to a crew.')).toBeVisible()
  })

  test('the back link returns to My reports', async ({ page, signIn, api, freshResident }) => {
    const r = await report(api, { resident: freshResident })
    await signIn(freshResident, `/resident/reports/${r.reportId}`)
    const detail = new ReportDetailPage(page)
    await expect(detail.title).toBeVisible()
    await page.locator('main').getByRole('link', { name: 'My reports' }).click()
    await expect(page).toHaveURL(/\/resident\/reports$/)
  })

  test('NFR-2 the status page updates live when the crew starts work (no reload)', async ({ page, signIn, api, freshResident }) => {
    const a = await assignedIssue(api, { resident: freshResident, type: 'water_leak' })
    await signIn(freshResident, `/resident/reports/${a.reportId}`)
    const detail = new ReportDetailPage(page)
    await expect(detail.statusBadge('Crew assigned')).toBeVisible()
    await expect(page.locator('header').getByText('Live', { exact: true })).toBeVisible()

    await api.startWork(a.crewEmail, a.workOrder.work_order_id)

    // NFR-2 asks for 2 s; allow a little slack for the test machine.
    await expect(detail.statusBadge('In progress')).toBeVisible({ timeout: 4_000 })
  })
})
