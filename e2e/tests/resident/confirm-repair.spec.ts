import { MyReportsPage, ReportDetailPage } from '../../pages/ResidentPages'
import { eventually } from '../../support/api'
import { expect, test } from '../../support/fixtures'
import { completedIssue } from '../../support/flows'

test.describe('Confirm or dispute a repair (FR-8, FR-9, FR-10)', () => {
  test('My reports flags a repair that is waiting for the resident', async ({ page, signIn, api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'streetlight' })

    await signIn(freshResident)
    const list = new MyReportsPage(page)
    await expect(list.waitingBanner).toHaveText('A repair is waiting for your answer')
    await list.checkRepair.click()

    await expect(page).toHaveURL(new RegExp(`/resident/reports/${c.reportId}$`))
    const detail = new ReportDetailPage(page)
    await expect(detail.confirmPanel).toBeVisible()
    await expect(page.getByText(/If we don't hear back, it closes automatically on/)).toBeVisible()
    await expect(page.getByRole('img', { name: 'After repair' })).toBeVisible()
    await expect(page.getByText('Crew notes: Patched by the e2e suite')).toBeVisible()
  })

  test('TC-034 confirming the repair closes the issue and thanks the resident @smoke', async ({ page, signIn, api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'pothole' })
    await signIn(freshResident, `/resident/reports/${c.reportId}`)
    const detail = new ReportDetailPage(page)

    await detail.yesFixed.click()

    // The panel goes away once the answer is saved (the page refetches straight away).
    await expect(detail.confirmPanel).toBeHidden()
    const issue = await api.waitForStatus(c.issueId, 'closed')
    expect(issue.work_orders[0].confirmation_status).toBe('confirmed')
    await expect(detail.statusBadge('Closed')).toBeVisible()
    await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.message.startsWith('Thanks for confirming.') && i.message.includes(c.address)),
      { message: 'the resident never got the closing message' },
    )
  })

  test('TC-035 a dispute cannot be sent without a reason', async ({ page, signIn, api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'water_leak' })
    await signIn(freshResident, `/resident/reports/${c.reportId}`)
    const detail = new ReportDetailPage(page)

    await detail.stillBroken.click()

    await expect(detail.disputeReason).toBeFocused()
    await expect(detail.sendAgain).toBeDisabled()
    await detail.disputeReason.fill('   ')
    await expect(detail.sendAgain).toBeDisabled()

    const res = await api.raw('POST', `/confirmations/${c.confirmationId}`, freshResident, { action: 'dispute', reason: '' })
    expect(res.status()).toBe(422)
    expect((await res.json()).detail).toBe('Please tell us what is still wrong')
  })

  test('cancelling a dispute goes back to the two answers', async ({ page, signIn, api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'streetlight' })
    await signIn(freshResident, `/resident/reports/${c.reportId}`)
    const detail = new ReportDetailPage(page)
    await detail.stillBroken.click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(detail.yesFixed).toBeVisible()
    await expect(detail.stillBroken).toBeVisible()
  })

  test('TC-036 disputing reopens the issue with higher priority and a new work order', async ({ page, signIn, api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'water_leak' })
    const scoreBefore = Number(c.issue.priority_score)
    await signIn(freshResident, `/resident/reports/${c.reportId}`)
    const detail = new ReportDetailPage(page)

    await detail.stillBroken.click()
    await detail.disputeReason.fill('Still leaking onto the sidewalk')
    await detail.sendAgain.click()

    await expect(detail.confirmPanel).toBeHidden()
    const reopened = await api.waitForIssue(
      c.issueId,
      (i) => i.work_orders.length === 2 && i.status === 'assigned',
      'no new work order was created after the dispute',
    )
    expect(reopened.reopen_count).toBe(1)
    // One severity level (severity_weight = 10 points) on top of the old score.
    expect(Number(reopened.priority_score)).toBeGreaterThanOrEqual(scoreBefore + 10)
    const [latest, earlier] = reopened.work_orders
    expect(latest.status).toBe('assigned')
    expect(earlier.confirmation_status).toBe('disputed')
    expect(earlier.dispute_reason).toBe('Still leaking onto the sidewalk')
    expect(reopened.status_history.map((h) => h.to_status)).toEqual(expect.arrayContaining(['reopened', 'prioritized']))
    // The resident sees the issue back with a crew.
    await expect(detail.statusBadge('Crew assigned')).toBeVisible()
  })

  test('a repair cannot be answered twice', async ({ api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'pothole' })
    await api.answerConfirmation(freshResident, c.confirmationId, 'confirm')

    const again = await api.raw('POST', `/confirmations/${c.confirmationId}`, freshResident, { action: 'confirm' })
    expect(again.status()).toBe(409)
    expect((await again.json()).detail).toBe('This repair has already been answered')
  })

  test('another resident cannot answer the confirmation', async ({ api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'pothole' })
    const res = await api.raw('POST', `/confirmations/${c.confirmationId}`, 'resident2@smartfix.dev', { action: 'confirm' })
    expect(res.status()).toBe(404)
    expect((await res.json()).detail).toBe('Confirmation not found')
  })
})
