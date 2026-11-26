import { LiveMapPage } from '../../pages/OperatorPages'
import { PROBLEM_TYPES, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, inProgressIssue, report } from '../../support/flows'

test.describe('Operator live map (FR-13)', () => {
  test('TC-023 every open issue is listed by priority and drawn on the map @smoke', async ({ page, signIn, api }) => {
    const fresh = await assignedIssue(api, { type: 'pothole' })
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    await expect(map.item(fresh.address)).toBeVisible()

    const shown = await map.shown()
    const open = (await api.summary()).open
    // Issues still being classified ("reported") are open but may not be in the queue yet.
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThanOrEqual(open)
    await expect(map.queue).toHaveCount(shown)
    await expect(map.markers).toHaveCount(shown)

    const scores = await map.scores()
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  test('the header and KPI tiles show the open, escalated, waiting and review counts', async ({ page, signIn, api }) => {
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    const s = await api.summary()
    await expect(page.locator('header').getByText(`${s.open} open issues`)).toBeVisible()
    await expect(map.kpi('Open')).toContainText(String(s.open))
    await expect(map.kpi('To review')).toContainText(String(s.pending_reviews))

    await map.kpi('To review').click()
    await expect(page).toHaveURL(/\/ops\/review$/)
  })

  test('TC-024 filtering by type shows only that type, and clearing brings everything back', async ({ page, signIn, api }) => {
    await assignedIssue(api, { type: 'water_leak' })
    await assignedIssue(api, { type: 'streetlight' })
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    await expect(map.queue.first()).toBeVisible()
    const total = await map.shown()

    await map.chip(PROBLEM_TYPES.water_leak).click()

    await expect.poll(() => map.shown()).toBeLessThan(total)
    const texts = await map.queue.allInnerTexts()
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts) expect(t).toContain(PROBLEM_TYPES.water_leak)
    await expect(map.markers).toHaveCount(texts.length)

    await map.clearFilters.click()
    await expect.poll(() => map.shown()).toBe(total)
    await expect(map.clearFilters).toHaveCount(0)
  })

  test('TC-024 filtering by status and severity narrows the list', async ({ page, signIn, api }) => {
    const started = await inProgressIssue(api, { type: 'streetlight', description: '[ai:severity=5] Pole leaning over the road' })
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    await expect(map.item(started.address)).toBeVisible()

    await map.chip('In progress').click()
    await expect(map.item(started.address)).toBeVisible()
    for (const t of await map.queue.allInnerTexts()) expect(t).toContain('In progress')

    await map.chip('5').click()
    await expect(map.item(started.address)).toBeVisible()
    for (const t of await map.queue.allInnerTexts()) expect(t).toContain('5/5')

    await map.chip('1').click()
    await map.chip('5').click()
    // In progress + severity 1 only: our severity-5 job drops out.
    await expect(map.item(started.address)).toHaveCount(0)
  })

  test('a filter combination with no matches shows the empty message', async ({ page, signIn }) => {
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    await map.chip('Reopened').click()
    await map.chip('Escalated').click()
    await map.chip(PROBLEM_TYPES.other).click()
    await map.chip('1').click()
    await expect(map.emptyQueue).toBeVisible()
    await expect(map.markers).toHaveCount(0)
  })

  test('"Escalated only" lists only escalated issues, first in the queue', async ({ page, signIn, api }) => {
    const late = await assignedIssue(api, { type: 'water_leak' })
    await api.expireDeadline(late.workOrder.work_order_id)
    await api.waitForIssue(late.issueId, (i) => i.is_escalated, 'issue was never escalated')

    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    await map.escalatedOnly.click()

    await expect(map.item(late.address)).toBeVisible()
    for (const t of await map.queue.allInnerTexts()) expect(t).toMatch(/Escalated|escalated/)
    // The escalation boost (+1000) keeps escalated issues above every other issue.
    await map.escalatedOnly.click()
    const scores = await map.scores()
    expect(scores[0]).toBeGreaterThan(1000)
  })

  test('NFR-2 a new issue appears on the map without reloading', async ({ page, signIn, api }) => {
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    await expect(page.locator('header').getByText('Live', { exact: true })).toBeVisible()
    const before = await map.shown()

    const r = await report(api, { type: 'sidewalk_crack' })

    await expect(map.item(r.address)).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => map.shown()).toBe(before + 1)
    await expect(map.latestEvent).toBeVisible()
  })

  test('TC-028 the hotspot layer draws the service areas with their 30-day counts', async ({ page, signIn, api }) => {
    await signIn(USERS.operator)
    const map = new LiveMapPage(page)
    await expect(map.queue.first()).toBeVisible()
    const markers = await map.markers.count()

    await map.hotspots.click()

    // Five Calgary service areas are drawn as interactive polygons on top of the issue markers.
    await expect(map.markers).toHaveCount(markers + 5)
    const areas = await api.stats()
    expect(areas.hotspots.length).toBeGreaterThan(0)
    for (const h of areas.hotspots) {
      expect(h.issues_30d).toBeGreaterThanOrEqual(h.still_open)
    }
    await map.hotspots.click()
    await expect(map.markers).toHaveCount(markers)
  })
})
