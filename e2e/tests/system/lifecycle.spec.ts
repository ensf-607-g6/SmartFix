import { CrewPage } from '../../pages/CrewPage'
import { LiveMapPage } from '../../pages/OperatorPages'
import { NewReportPage, ReportDetailPage } from '../../pages/ResidentPages'
import { CREW_MEMBER, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { uniqueTag } from '../../support/flows'
import { makePhoto } from '../../support/photos'

/**
 * The README walkthrough, end to end through the UI only, with each role in its own browser:
 * resident reports -> operator sees it -> crew repairs it -> resident confirms -> timeline shows it all.
 */
test('full lifecycle: report, dispatch, repair, confirm and close @smoke', async ({ page, signIn, openAs, api, freshResident }) => {
  test.setTimeout(120_000)
  const address = `${uniqueTag('LIFECYCLE')} 9 Ave SE`

  // 1. Resident reports a streetlight through the form.
  await signIn(freshResident, '/resident/new')
  const form = new NewReportPage(page)
  await form.fill({ photo: makePhoto(), category: 'Broken streetlight', description: 'Light out at the bus stop', address })
  const { report_id, issue_id } = await form.submitAndCapture()
  await expect(form.received).toBeVisible()
  await form.trackLink.click()
  const detail = new ReportDetailPage(page)
  await expect(detail.statusBadge('Crew assigned')).toBeVisible({ timeout: 15_000 })

  // 2. Operator sees it on the live map with its crew.
  const operator = await openAs(USERS.operator)
  const map = new LiveMapPage(operator)
  await expect(map.item(address)).toContainText('Street Lighting')

  // 3. Crew starts and completes the job.
  const issue = await api.issue(issue_id)
  const crewPage = await openAs(CREW_MEMBER[issue.work_orders[0].crew_name])
  const crew = new CrewPage(crewPage)
  await crew.select(address)
  await crew.startWork.click()
  await expect(detail.statusBadge('In progress')).toBeVisible({ timeout: 5_000 })
  await crew.complete(makePhoto(), 'New lamp head fitted')

  // 4. Resident is asked to confirm (live, no reload) and says it is fixed.
  await expect(detail.confirmPanel).toBeVisible({ timeout: 10_000 })
  await detail.yesFixed.click()
  await expect(detail.statusBadge('Closed')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/resident/reports/${report_id}$`))

  // 5. The issue leaves the operator's map, and its timeline has the whole story.
  await expect(map.item(address)).toHaveCount(0, { timeout: 5_000 })
  const events = (await api.timeline(issue_id)).filter((r) => r.kind === 'event').map((r) => r.label)
  expect(events).toEqual([
    'IssueReported',
    'IssueValidated',
    'IssuePrioritized',
    'WorkOrderCreated',
    'WorkOrderStatusChanged',
    'RepairCompleted',
    'IssueClosed',
  ])
})
