import { StatsPage } from '../../pages/OperatorPages'
import { PROBLEM_TYPES, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { completedIssue } from '../../support/flows'

test.describe('Repair statistics (FR-15)', () => {
  test('TC-041 a completed repair is counted under its problem type', async ({ page, signIn, api }) => {
    const before = (await api.stats()).repair_stats.find((s) => s.problem_type === 'water_leak')?.repairs ?? 0
    await completedIssue(api, { type: 'water_leak' })
    const after = (await api.stats()).repair_stats.find((s) => s.problem_type === 'water_leak')
    expect(after?.repairs).toBe(before + 1)

    await signIn(USERS.operator, '/ops/stats')
    const stats = new StatsPage(page)
    const byType = stats.card('Average repair time by problem type')
    const row = byType.locator('li').filter({ hasText: PROBLEM_TYPES.water_leak })
    await expect(row).toBeVisible()
    await expect(row).toContainText(/\d+\.\d h/)
    await row.hover()
    await expect(byType.getByText(new RegExp(`${before + 1} repairs? · \\d+% met deadline`))).toBeVisible()

    await expect(stats.tile('Average repair time')).not.toContainText('—')
    await expect(stats.tile('Met deadline')).toContainText('%')
  })

  test('the crew workload table lists every crew with its load', async ({ page, signIn, api }) => {
    const crews = await api.crews()
    await signIn(USERS.operator, '/ops/stats')
    const table = new StatsPage(page).card('Crew workload').locator('tbody tr')
    await expect(table).toHaveCount(crews.length)
    for (const c of crews) {
      await expect(table.filter({ hasText: c.name })).toContainText(`${c.active_orders}/${c.max_active_orders}`)
    }
  })

  test('TC-028 the hot spots table matches the 30-day counts per service area', async ({ page, signIn, api }) => {
    const { hotspots } = await api.stats()
    await signIn(USERS.operator, '/ops/stats')
    const rows = new StatsPage(page).card('Repeat-problem hot spots').locator('tbody tr')
    await expect(rows).toHaveCount(hotspots.length)
    for (const h of hotspots) {
      await expect(rows.filter({ hasText: h.name }).locator('td')).toHaveText([
        h.name,
        String(h.issues_30d),
        String(h.repeat_reports_30d),
        String(h.still_open),
      ])
    }
  })

  test('NFR-1 the photo-check latency tile reports the share under 15 s', async ({ page, signIn }) => {
    await signIn(USERS.operator, '/ops/stats')
    await expect(new StatsPage(page).tile('Photo check, p95')).toContainText(/% under the 15 s target · \d+ runs/)
  })

  test('the 24-hour event counts include the core lifecycle events', async ({ page, signIn }) => {
    await signIn(USERS.operator, '/ops/stats')
    const events = new StatsPage(page).card('Events in the last 24 hours')
    for (const name of ['Issue reported', 'Issue validated', 'Issue prioritized', 'Work order created', 'Repair completed']) {
      await expect(events.getByText(name, { exact: true })).toBeVisible()
    }
  })

  test('NFR-3 no event has been dead-lettered during the run', async ({ page, signIn, api }) => {
    const dead = await api.raw('GET', '/dead-letters', USERS.operator)
    expect(await dead.json()).toEqual([])
    await signIn(USERS.operator, '/ops/stats')
    await expect(new StatsPage(page).card('Dead-letter queue').getByText('Empty. Every event was handled.')).toBeVisible()
  })
})
