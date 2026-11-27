import { MyReportsPage, ReportDetailPage } from '../../pages/ResidentPages'
import { eventually } from '../../support/api'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, report } from '../../support/flows'
import { calgaryPoint, metresNorthOf } from '../../support/geo'
import { makePhoto } from '../../support/photos'

/**
 * FR-3: a report of the same type within 50 m of an open, validated issue, that the model says
 * shows the same problem, is merged into it. The mock model calls two photos "the same problem"
 * only when they are byte-identical, so these tests reuse one photo on purpose.
 */
test.describe('Duplicate reports (FR-3)', () => {
  test('a second report of the same problem within 50 m joins the first issue and raises its priority', async ({
    page,
    signIn,
    api,
    freshResident,
  }) => {
    const photo = makePhoto()
    const spot = calgaryPoint()
    const first = await assignedIssue(api, { type: 'pothole', point: spot, photo })
    const scoreBefore = Number(first.issue.priority_score)

    const second = await report(api, { resident: freshResident, type: 'pothole', point: metresNorthOf(spot, 20), photo })

    const merged = await eventually(
      () => api.myReport(freshResident, second.reportId),
      (d) => d.report_status === 'duplicate',
      { message: 'the second report was never merged' },
    )
    expect(merged.issue_id).toBe(first.issueId)
    const original = await api.waitForIssue(first.issueId, (i) => i.duplicate_count === 1, 'duplicate_count never went up')
    // duplicate_bonus_each = 2 points (aging adds a little on top)
    expect(Number(original.priority_score)).toBeGreaterThanOrEqual(scoreBefore + 2)
    expect((await api.issue(second.issueId)).status).toBe('merged')
    // No second crew: still one work order.
    expect(original.work_orders).toHaveLength(1)

    await signIn(freshResident)
    const list = new MyReportsPage(page)
    // A merged report takes on the original issue's address, so find it by its id.
    await expect(list.link(second.reportId)).toContainText('Joined an existing report')
    await expect(list.link(second.reportId)).toContainText(first.address)
    await list.link(second.reportId).click()
    await expect(
      page.getByText('Someone had already reported this problem, so your report was added to theirs.', { exact: false }),
    ).toBeVisible()
    // The other resident's report stays private (only the count is shared).
    const detail = await api.myReport(freshResident, second.reportId)
    expect(detail.reports).toHaveLength(1)
    await expect(new ReportDetailPage(page).title).toBeVisible()
  })

  test('a different-looking problem at the same spot stays a separate issue', async ({ api }) => {
    const spot = calgaryPoint()
    const first = await assignedIssue(api, { type: 'pothole', point: spot })
    const second = await assignedIssue(api, { type: 'pothole', point: metresNorthOf(spot, 10) })

    expect(second.issueId).not.toBe(first.issueId)
    expect((await api.issue(first.issueId)).duplicate_count).toBe(0)
  })

  test('the same photo more than 50 m away is not treated as a duplicate', async ({ api }) => {
    const photo = makePhoto()
    const spot = calgaryPoint()
    const first = await assignedIssue(api, { type: 'streetlight', point: spot, photo })
    const far = await assignedIssue(api, { type: 'streetlight', point: metresNorthOf(spot, 120), photo })

    expect(far.issueId).not.toBe(first.issueId)
    expect((await api.issue(first.issueId)).duplicate_count).toBe(0)
  })

  test('a nearby report of a different type is not merged', async ({ api }) => {
    const photo = makePhoto()
    const spot = calgaryPoint()
    const first = await assignedIssue(api, { type: 'pothole', point: spot, photo })
    const other = await assignedIssue(api, { type: 'sidewalk_crack', point: metresNorthOf(spot, 5), photo })

    expect(other.issueId).not.toBe(first.issueId)
  })
})
