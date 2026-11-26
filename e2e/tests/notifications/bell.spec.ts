import { AppShell } from '../../pages/AppShell'
import { eventually } from '../../support/api'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, completedIssue, report } from '../../support/flows'

test.describe('Notifications (FR-12)', () => {
  test('a new resident starts with an empty inbox', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident)
    const shell = new AppShell(page)
    await expect(shell.bell).toHaveAccessibleName('Notifications, 0 unread')
    await shell.openNotifications()
    await expect(shell.notificationsPanel.getByText('No notifications yet')).toBeVisible()
    await expect(shell.markAllRead).toBeDisabled()
  })

  test('TC-039 the bell count and a toast update live as notifications arrive', async ({ page, signIn, api, freshResident }) => {
    await signIn(freshResident)
    const shell = new AppShell(page)
    await shell.expectLive()
    await expect(shell.bell).toHaveAccessibleName('Notifications, 0 unread')

    const r = await report(api, { resident: freshResident, type: 'streetlight' })

    // Validated + crew assigned = two messages, pushed over the WebSocket without a reload.
    await expect(shell.bell).toHaveAccessibleName('Notifications, 2 unread', { timeout: 10_000 })
    await expect(shell.toast(`Street Lighting has been assigned to your broken streetlight report at ${r.address}.`)).toBeVisible()
  })

  test('the inbox lists the messages newest first with their event', async ({ page, signIn, api, freshResident }) => {
    const a = await assignedIssue(api, { resident: freshResident, type: 'water_leak', description: '[ai:severity=4] Leak' })
    await eventually(() => api.notifications(freshResident), (n) => n.items.length === 2, { message: 'expected two notifications' })

    await signIn(freshResident)
    const shell = new AppShell(page)
    await shell.openNotifications()
    const items = shell.notificationsPanel.locator('li')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText(`Water Services has been assigned to your water leak report at ${a.address}.`)
    await expect(items.nth(0)).toContainText('Work order created · just now')
    await expect(items.nth(1)).toContainText('We checked the photo and rated it severity 4 of 5. It is now in the repair queue.')
    await expect(items.nth(1)).toContainText('Issue validated')
  })

  test('TC-040 "Mark all read" sets the unread count to 0', async ({ page, signIn, api, freshResident }) => {
    await assignedIssue(api, { resident: freshResident })
    await eventually(() => api.notifications(freshResident), (n) => n.unread >= 2, { message: 'no unread notifications to mark' })
    await signIn(freshResident)
    const shell = new AppShell(page)
    await expect(shell.bell).toHaveAccessibleName(/Notifications, [1-9]\d* unread/)

    await shell.openNotifications()
    await shell.markAllRead.click()

    await expect(shell.bell).toHaveAccessibleName('Notifications, 0 unread')
    await expect(shell.markAllRead).toBeDisabled()
    expect((await api.notifications(freshResident)).unread).toBe(0)
    await page.reload()
    await expect(shell.bell).toHaveAccessibleName('Notifications, 0 unread')
  })

  test('FR-12 the resident hears about every step from report to closure', async ({ api, freshResident }) => {
    const c = await completedIssue(api, { resident: freshResident, type: 'pothole' })
    await api.answerConfirmation(freshResident, c.confirmationId, 'confirm')

    const inbox = await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.event_name === 'IssueClosed'),
      { message: 'the closing notification never arrived' },
    )
    expect(inbox.items.map((i) => i.event_name).reverse()).toEqual([
      'IssueValidated',
      'WorkOrderCreated',
      'WorkOrderStatusChanged',
      'RepairCompleted',
      'IssueClosed',
    ])
    // Short, plain-language messages (the backend keeps them between 10 and 400 characters).
    for (const n of inbox.items) {
      expect(n.message.length).toBeGreaterThanOrEqual(10)
      expect(n.message.length).toBeLessThanOrEqual(400)
    }
  })

  test('the assigned crew is notified of a new work order', async ({ api }) => {
    const a = await assignedIssue(api, { type: 'streetlight' })
    await eventually(
      () => api.notifications(a.crewEmail),
      (n) => n.items.some((i) => i.message.startsWith('New work order:') && i.message.includes(a.address)),
      { message: 'the crew was not told about the new work order' },
    )
  })
})
