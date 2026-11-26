import { type Locator } from '@playwright/test'
import { CrewPage } from '../../pages/CrewPage'
import { USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { assignedIssue } from '../../support/flows'
import { makePhoto } from '../../support/photos'

const KNOWN_LAYOUT_BUG =
  'Known layout bug: the shell keeps its fixed 256 px sidebar (w-64) and the crew page a fixed 400 px list column ' +
  'at every width, so on a phone the sidebar covers the work orders and they cannot be tapped ' +
  '(frontend/src/layouts/AppShell.tsx, frontend/src/pages/crew/CrewPage.tsx).'

/** True when the element is fully inside the viewport and nothing is drawn on top of its centre. */
async function fitsAndIsTappable(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.left < 0 || r.right > window.innerWidth) return false
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20))
    return !!hit && el.contains(hit)
  })
}

/** TC-033 runs in the "mobile" project (Pixel 7 viewport, touch). */
test.describe('Crew portal on a phone (TC-033)', () => {
  test('the work-order list fits the phone screen and is not covered by the sidebar', async ({ page, signIn, api }) => {
    test.fail(true, KNOWN_LAYOUT_BUG)
    const a = await assignedIssue(api, { type: 'water_leak' })
    await signIn(USERS.crewWater)
    const crew = new CrewPage(page)
    await expect(crew.order(a.address)).toBeVisible()

    expect(await fitsAndIsTappable(crew.order(a.address)), 'the order card is off screen or covered').toBe(true)
  })

  test('the crew can start and complete a job at phone width', async ({ page, signIn, api }) => {
    test.fail(true, KNOWN_LAYOUT_BUG)
    const a = await assignedIssue(api, { type: 'water_leak' })
    await signIn(USERS.crewWater)
    const crew = new CrewPage(page)
    await crew.select(a.address)

    await crew.startWork.click()
    await expect(crew.completeRepair).toBeVisible()
    await crew.complete(makePhoto(), 'Fixed from a phone')

    await api.waitForStatus(a.issueId, 'completed')
  })
})
