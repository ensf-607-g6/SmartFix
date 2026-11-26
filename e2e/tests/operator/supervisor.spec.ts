import { AppShell } from '../../pages/AppShell'
import { LiveMapPage, ReviewPage, StatsPage } from '../../pages/OperatorPages'
import { USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, reportNeedingReview } from '../../support/flows'

test.describe('Supervisor (NFR-6)', () => {
  test('TC-042 a supervisor can open and use every operator page', async ({ page, signIn, api }) => {
    const review = await reportNeedingReview(api)
    const a = await assignedIssue(api, { type: 'water_leak' })

    await signIn(USERS.supervisor)
    const shell = new AppShell(page)
    await expect(shell.sidebar.getByText('Supervisor', { exact: true })).toBeVisible()

    const map = new LiveMapPage(page)
    const drawer = await map.open(a.address)
    await drawer.chooseCrew('General Maintenance')
    await drawer.move.click()
    await expect(drawer.field('Crew')).toHaveText('General Maintenance')
    await drawer.close.click()

    await shell.nav('Review queue').click()
    const card = new ReviewPage(page).card(review.address)
    await card.approve.click()
    await expect(card.root).toHaveCount(0)
    await api.waitForStatus(review.issueId, 'assigned')

    await shell.nav('Repair statistics').click()
    await expect(new StatsPage(page).heading).toBeVisible()
  })
})
