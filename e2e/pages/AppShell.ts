import { expect, type Locator, type Page } from '@playwright/test'

/** The sidebar, header and notification bell shared by every signed-in page. */
export class AppShell {
  readonly sidebar: Locator
  readonly signOut: Locator
  readonly bell: Locator
  readonly live: Locator
  readonly notificationsPanel: Locator
  readonly markAllRead: Locator

  constructor(readonly page: Page) {
    this.sidebar = page.locator('aside').first()
    this.signOut = page.getByRole('button', { name: 'Sign out' })
    this.bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ })
    this.live = page.locator('header').getByText('Live', { exact: true })
    this.notificationsPanel = page.locator('header div.card').filter({ has: page.getByRole('heading', { name: 'Notifications' }) })
    this.markAllRead = page.getByRole('button', { name: 'Mark all read' })
  }

  nav(label: string): Locator {
    return this.sidebar.getByRole('link', { name: label })
  }

  navLabels(): Promise<string[]> {
    return this.sidebar.locator('nav a').allInnerTexts().then((all) => all.map((t) => t.replace(/\s*\d+$/, '').trim()))
  }

  async unreadCount(): Promise<number> {
    const label = (await this.bell.getAttribute('aria-label')) ?? ''
    return Number(/(\d+) unread/.exec(label)?.[1] ?? 0)
  }

  async expectLive() {
    await expect(this.live).toBeVisible({ timeout: 15_000 })
  }

  async openNotifications() {
    if (!(await this.notificationsPanel.isVisible())) await this.bell.click()
    await expect(this.notificationsPanel).toBeVisible()
  }

  /** The floating toast shown when a notification arrives over the WebSocket. */
  toast(text: string | RegExp): Locator {
    return this.page.getByRole('status').filter({ hasText: text })
  }
}
