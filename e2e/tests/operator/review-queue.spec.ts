import { AppShell } from '../../pages/AppShell'
import { ReviewPage } from '../../pages/OperatorPages'
import { MyReportsPage } from '../../pages/ResidentPages'
import { eventually } from '../../support/api'
import { USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { report, reportNeedingReview } from '../../support/flows'

test.describe('Operator review queue (FR-4)', () => {
  test('a low-confidence report shows the AI assessment and the resident\'s choice', async ({ page, signIn, api }) => {
    const r = await reportNeedingReview(api, '[ai:low-confidence]', { type: 'pothole', description: 'Hard to see in the photo' })

    await signIn(USERS.operator, '/ops/review')
    const card = new ReviewPage(page).card(r.address)
    await expect(card.root).toBeVisible()
    await expect(card.reasonBadge('Low confidence')).toBeVisible()
    await expect(card.root.getByText('Resident chose: Pothole')).toBeVisible()
    await expect(card.root.getByText('35%')).toBeVisible()
    await expect(card.root.getByText('mock-vision')).toBeVisible()
    await expect(card.problemType).toHaveValue('pothole')
    await expect(card.severity).toHaveValue('3')
  })

  test('a photo the model says is not infrastructure is flagged as such', async ({ page, signIn, api }) => {
    const r = await reportNeedingReview(api, '[ai:not-infra]')
    await signIn(USERS.operator, '/ops/review')
    const card = new ReviewPage(page).card(r.address)
    await expect(card.reasonBadge('May not be infrastructure')).toBeVisible()
    await expect(card.root.getByText(/Model says this is not public infrastructure/)).toBeVisible()
  })

  test('when the model is offline the report waits for a person', async ({ page, signIn, api }) => {
    const r = await reportNeedingReview(api, '[ai:offline]')
    const item = (await api.reviewQueue()).find((i) => i.report_id === r.reportId)!
    expect(item.ai_model).toBe('unavailable')

    await signIn(USERS.operator, '/ops/review')
    await expect(new ReviewPage(page).card(r.address).modelUnavailable).toBeVisible()
  })

  test('TC-020 approving a report dispatches a crew and tells the resident @smoke', async ({ page, signIn, api, freshResident }) => {
    const r = await reportNeedingReview(api, '[ai:low-confidence]', { resident: freshResident, type: 'water_leak' })
    await signIn(USERS.operator, '/ops/review')
    const card = new ReviewPage(page).card(r.address)

    await card.severity.selectOption('4')
    await card.approve.click()

    await expect(card.root).toHaveCount(0)
    const issue = await api.waitForStatus(r.issueId, 'assigned')
    expect(issue.severity).toBe(4)
    expect(issue.work_orders[0].crew_name).toBe('Water Services')
    // severity 4 = 24 h deadline
    const hours = (new Date(issue.work_orders[0].deadline_at).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.5)
    expect(issue.status_history.map((h) => h.to_status)).toEqual(['reported', 'validated', 'prioritized', 'assigned'])
    await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.message.includes('A city operator checked it and rated it severity 4 of 5')),
      { message: 'the resident was not told the report was approved' },
    )
  })

  test('the operator can correct the problem type when approving', async ({ page, signIn, api }) => {
    const r = await reportNeedingReview(api, '[ai:low-confidence]', { type: 'pothole' })
    await signIn(USERS.operator, '/ops/review')
    const card = new ReviewPage(page).card(r.address)

    await card.problemType.selectOption({ label: 'Broken streetlight' })
    await card.approve.click()

    const issue = await api.waitForStatus(r.issueId, 'assigned')
    expect(issue.problem_type).toBe('streetlight')
    expect(issue.work_orders[0].crew_name).toBe('Street Lighting')
  })

  test('TC-021 rejecting a report rejects the issue and sends the resident the operator\'s note', async ({
    page,
    signIn,
    api,
    freshResident,
  }) => {
    const r = await reportNeedingReview(api, '[ai:not-infra]', { resident: freshResident })
    await signIn(USERS.operator, '/ops/review')
    const card = new ReviewPage(page).card(r.address)

    await card.note.fill('This looks like private property')
    await card.reject.click()

    await expect(card.root).toHaveCount(0)
    await api.waitForStatus(r.issueId, 'rejected')
    const mine = await api.myReport(freshResident, r.reportId)
    expect(mine.report_status).toBe('rejected')
    await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.message.endsWith('Note from the operator: This looks like private property')),
      { message: 'the resident never got the rejection note' },
    )

    await signIn(freshResident)
    await expect(new MyReportsPage(page).item(r.address)).toContainText('Not accepted')
  })

  test('a review cannot be decided twice', async ({ api }) => {
    const r = await reportNeedingReview(api)
    await api.decideReview(r.reviewId, false)
    const res = await api.raw('POST', `/review/${r.reviewId}`, USERS.operator, { approve: true })
    expect(res.status()).toBe(409)
    expect((await res.json()).detail).toBe('This report has already been reviewed')
  })

  test('a confident report skips the review queue', async ({ api }) => {
    const r = await report(api)
    await api.waitForStatus(r.issueId, 'assigned')
    expect((await api.reviewQueue()).some((i) => i.report_id === r.reportId)).toBe(false)
  })

  test('TC-022 new review items appear live, with the sidebar badge, without a reload', async ({ page, signIn, api }) => {
    await signIn(USERS.operator, '/ops/review')
    const reviews = new ReviewPage(page)
    const shell = new AppShell(page)
    await shell.expectLive()
    const badge = shell.nav('Review queue')
    const before = (await api.summary()).pending_reviews

    const r = await report(api, { description: '[ai:low-confidence] Arrived while the operator was watching' })

    await expect(reviews.card(r.address).root).toBeVisible({ timeout: 5_000 })
    await expect(badge).toContainText(String(before + 1))
  })
})
