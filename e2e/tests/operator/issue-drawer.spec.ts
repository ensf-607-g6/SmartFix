import { CrewPage } from '../../pages/CrewPage'
import { LiveMapPage } from '../../pages/OperatorPages'
import { eventually } from '../../support/api'
import { PROBLEM_TYPES, USERS } from '../../support/env'
import { crewId, setCrewActive, workOrderAssignments } from '../../support/db'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, completedIssue, inProgressIssue, report } from '../../support/flows'
import { outsideServiceAreas } from '../../support/geo'

test.describe('Issue drawer (FR-13, FR-14)', () => {
  test('TC-025 the overview shows priority, severity, area, AI result and the score breakdown', async ({ page, signIn, api }) => {
    const a = await assignedIssue(api, { type: 'pothole', description: '[ai:severity=4] Wheel-sized pothole' })
    await signIn(USERS.operator)
    const drawer = await new LiveMapPage(page).open(a.address)

    await expect(drawer.root.getByRole('heading', { name: PROBLEM_TYPES.pothole })).toBeVisible()
    await expect(drawer.field('Priority score')).toHaveText(/^\d+\.\d$/)
    await expect(drawer.field('Severity')).toContainText('4/5')
    await expect(drawer.field('Reports')).toHaveText('1')
    await expect(drawer.field('Area')).not.toHaveText('Outside zones')
    await expect(drawer.root.getByText(/Score = severity 40 \+ duplicates 0/)).toBeVisible()
    await expect(drawer.root.getByText(/AI: Pothole, severity 4, confidence 92%/)).toBeVisible()
    await expect(drawer.root.getByText('“[ai:severity=4] Wheel-sized pothole”')).toBeVisible()
    await expect(drawer.field('Crew')).toHaveText(a.crewName)
    await expect(drawer.field('Status')).toHaveText('Assigned')
  })

  test('TC-025 the event timeline lists the issue\'s events in order, from IssueReported', async ({ page, signIn, api }) => {
    const a = await inProgressIssue(api, { type: 'streetlight' })
    await signIn(USERS.operator)
    const drawer = await new LiveMapPage(page).open(a.address)

    await drawer.timelineTab.click()

    await expect(drawer.timeline.locator('li').first()).toBeVisible()
    expect(await drawer.eventNames()).toEqual([
      'Issue reported',
      'Issue validated',
      'Issue prioritized',
      'Work order created',
      'Work order status changed',
    ])
    await expect(drawer.root.getByText('published by Reports')).toBeVisible()
    await expect(drawer.root.getByText(/Status new → Reported/)).toBeVisible()
    await expect(drawer.root.getByText(/Status Crew assigned → In progress/)).toBeVisible()

    // Same story from the API, including status changes with the module that owns them (NFR-4).
    const rows = await api.timeline(a.issueId)
    expect(rows.filter((r) => r.kind === 'status_change').map((r) => r.source)).toEqual([
      'reports',
      'validation',
      'priority',
      'work_orders',
      'work_orders',
    ])
  })

  test('the drawer closes with the close button and with Escape', async ({ page, signIn, api }) => {
    const a = await assignedIssue(api)
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    let drawer = await map.open(a.address)
    await drawer.close.click()
    await expect(drawer.root).toBeHidden()

    drawer = await map.open(a.address)
    await page.keyboard.press('Escape')
    await expect(drawer.root).toBeHidden()
  })

  test('an issue outside every service area is labelled "Outside zones"', async ({ page, signIn, api }) => {
    const a = await assignedIssue(api, { type: 'streetlight', point: outsideServiceAreas() })
    await signIn(USERS.operator)
    const drawer = await new LiveMapPage(page).open(a.address)
    await expect(drawer.field('Area')).toHaveText('Outside zones')
  })

  test('TC-026 reassigning a work order moves it to the new crew with a fresh deadline @smoke', async ({ page, signIn, api }) => {
    const a = await assignedIssue(api, { type: 'pothole' })
    const target = a.crewName === 'General Maintenance' ? 'Roads Crew South' : 'General Maintenance'
    await signIn(USERS.operator)
    const drawer = await new LiveMapPage(page).open(a.address)

    await drawer.chooseCrew(target)
    await drawer.reassignReason.fill('Closer to the site')
    await drawer.move.click()

    await expect(page.getByRole('status').filter({ hasText: 'Work order reassigned' })).toBeVisible()
    await expect(drawer.field('Crew')).toHaveText(target)
    const issue = await api.issue(a.issueId)
    expect(issue.work_orders[0].crew_name).toBe(target)
    expect(issue.work_orders[0].work_order_id).toBe(a.workOrder.work_order_id)
    expect(new Date(issue.work_orders[0].deadline_at).getTime()).toBeGreaterThanOrEqual(new Date(a.workOrder.deadline_at).getTime())

    const log = await workOrderAssignments(a.workOrder.work_order_id)
    expect(log.map((l) => l.crew)).toEqual([a.crewName, target])
    expect(log[1].reason).toBe('manual_reassign: Closer to the site')

    // The new crew is told and now holds the order; the old crew no longer sees it.
    const newCrew = target === 'General Maintenance' ? USERS.crewGeneral : USERS.crewSouth
    await eventually(
      () => api.notifications(newCrew),
      (n) => n.items.some((i) => i.message.startsWith('A work order was moved to your crew') && i.message.includes(a.address)),
      { message: 'the new crew was not notified' },
    )
    expect((await api.crewOrders(newCrew)).map((o) => o.work_order_id)).toContain(a.workOrder.work_order_id)
    expect((await api.crewOrders(a.crewEmail)).map((o) => o.work_order_id)).not.toContain(a.workOrder.work_order_id)
  })

  test('started work can only be reassigned after its deadline is missed', async ({ api }) => {
    const a = await inProgressIssue(api, { type: 'water_leak' })
    const general = await crewId('General Maintenance')

    const early = await api.raw('POST', `/work-orders/${a.workOrder.work_order_id}/reassign`, USERS.operator, { crew_id: general })
    expect(early.status()).toBe(409)
    expect((await early.json()).detail).toBe('Work has started; it can only be moved after its deadline is missed')

    await api.expireDeadline(a.workOrder.work_order_id)
    await api.waitForStatus(a.issueId, 'escalated')
    const moved = await api.reassign(a.workOrder.work_order_id, general, 'Escalated, moving it')
    expect(moved.work_orders[0].crew_name).toBe('General Maintenance')
    expect(moved.work_orders[0].status).toBe('assigned')
    expect(moved.status).toBe('assigned')
  })

  test('reassigning to the same crew is refused', async ({ api }) => {
    const a = await assignedIssue(api, { type: 'streetlight' })
    const res = await api.raw('POST', `/work-orders/${a.workOrder.work_order_id}/reassign`, USERS.operator, {
      crew_id: a.workOrder.crew_id,
    })
    expect(res.status()).toBe(409)
    expect((await res.json()).detail).toBe('The work order is already with this crew')
  })

  test('TC-027 an issue with no available crew waits, and the operator can dispatch one', async ({ page, signIn, api }) => {
    await setCrewActive('Water Services', false)
    try {
      const r = await report(api, { type: 'water_leak' })
      await api.waitForStatus(r.issueId, 'prioritized')
      expect((await api.summary()).awaiting_crew).toBeGreaterThan(0)

      await signIn(USERS.operator)
      const map = new LiveMapPage(page)
      await expect(map.kpi('No crew yet')).not.toContainText(/^0/)
      const drawer = await map.open(r.address)
      await expect(drawer.waitingForCrew).toBeVisible()
      await expect(drawer.crewSelect.locator('option', { hasText: 'Water Services' })).toHaveCount(0)

      await drawer.chooseCrew('General Maintenance')
      await drawer.dispatch.click()

      await expect(drawer.waitingForCrew).toBeHidden()
      await expect(drawer.field('Crew')).toHaveText('General Maintenance')
      const issue = await api.waitForStatus(r.issueId, 'assigned')
      expect(issue.work_orders[0].crew_name).toBe('General Maintenance')
      expect((await workOrderAssignments(issue.work_orders[0].work_order_id))[0].reason).toBe('manual_dispatch')
    } finally {
      await setCrewActive('Water Services', true)
    }
  })

  test('TC-038 "Miss the deadline now" escalates the issue to the top and alerts the supervisor and resident', async ({
    page,
    signIn,
    api,
    freshResident,
  }) => {
    const a = await assignedIssue(api, { resident: freshResident, type: 'streetlight' })
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    const drawer = await map.open(a.address)

    await drawer.missDeadline.click()

    await expect(drawer.root.getByText(/Deadline missed .* supervisor alerted/)).toBeVisible()
    await expect(drawer.missDeadline).toHaveCount(0)
    const issue = await api.waitForStatus(a.issueId, 'escalated')
    expect(issue.is_escalated).toBe(true)
    expect(issue.work_orders[0].escalated_at).not.toBeNull()

    await drawer.close.click()
    await expect(map.item(a.address)).toContainText('Escalated')
    // FR-11: escalated issues jump to the top of the queue (escalation boost).
    expect(Number(issue.priority_score)).toBeGreaterThan(1000)

    await eventually(
      () => api.notifications(USERS.supervisor),
      (n) => n.items.some((i) => i.message.startsWith('Overdue:') && i.message.includes(a.address)),
      { message: 'the supervisor was not alerted' },
    )
    await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.message.includes('is running late, so it has been escalated to the top of the queue')),
      { message: 'the resident was not told about the delay' },
    )
  })

  test('the crew sees an escalated job first, with a warning', async ({ page, signIn, api }) => {
    const a = await assignedIssue(api, { type: 'water_leak' })
    await api.expireDeadline(a.workOrder.work_order_id)
    await api.waitForStatus(a.issueId, 'escalated')

    await signIn(USERS.crewWater)
    const crew = new CrewPage(page)
    await crew.select(a.address)
    await expect(crew.escalatedWarning).toBeVisible()
    await expect(crew.order(a.address)).toContainText(/Overdue by/)
    // Active orders are sorted escalated first.
    const orders = await api.crewOrders(USERS.crewWater)
    const firstNormal = orders.findIndex((o) => !(o as unknown as { is_escalated: boolean }).is_escalated)
    const ours = orders.findIndex((o) => o.work_order_id === a.workOrder.work_order_id)
    expect(firstNormal === -1 || ours < firstNormal).toBe(true)
  })

  test('TC-037 "Skip ahead 7 days" auto-closes an unanswered repair and tells the resident', async ({
    page,
    signIn,
    api,
    freshResident,
  }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'pothole' })
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    const drawer = await map.open(c.address)
    await expect(drawer.root.getByText(/auto-closes/)).toBeVisible()

    await drawer.skipAhead.click()

    const issue = await api.waitForStatus(c.issueId, 'closed')
    expect(issue.work_orders[0].confirmation_status).toBe('auto_closed')
    await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.message.includes('because there was no reply within 7 days of the repair')),
      { message: 'the resident was not told about the auto-close' },
    )
    await drawer.close.click()
    // Closed issues leave the live map.
    await expect(map.item(c.address)).toHaveCount(0)
  })

  test('the dev tools refuse to expire something that is not active', async ({ api }) => {
    const c = await completedIssue(api, { type: 'streetlight' })
    const res = await api.raw('POST', `/dev/work-orders/${c.workOrder.work_order_id}/expire-deadline`, USERS.operator)
    expect(res.status()).toBe(409)
    await api.answerConfirmation(c.resident, c.confirmationId, 'confirm')
    const again = await api.raw('POST', `/dev/confirmations/${c.confirmationId}/expire`, USERS.operator)
    expect(again.status()).toBe(409)
  })
})
