import { expect, type Locator, type Page } from '@playwright/test'
import type { PhotoFile } from '../support/photos'

export class NewReportPage {
  readonly photoInput: Locator
  readonly map: Locator
  readonly pinHint: Locator
  readonly useMyLocation: Locator
  readonly address: Locator
  readonly description: Locator
  readonly submit: Locator
  readonly stillNeeded: Locator
  readonly received: Locator
  readonly trackLink: Locator
  readonly reportAnother: Locator

  constructor(readonly page: Page) {
    this.photoInput = page.locator('input[type="file"]')
    this.map = page.locator('.leaflet-container')
    this.pinHint = page.getByText(/^(Click the map where the problem is|Pin placed\. Click again to move it\.)$/)
    this.useMyLocation = page.getByRole('button', { name: /Use my location|Finding you/ })
    this.address = page.getByLabel('Location')
    this.description = page.getByLabel('Description')
    this.submit = page.getByRole('button', { name: /Submit report|Sending…/ })
    this.stillNeeded = page.getByText(/^Still needed:/)
    this.received = page.getByRole('heading', { name: 'Report received' })
    this.trackLink = page.getByRole('link', { name: 'Track this report' })
    this.reportAnother = page.getByRole('button', { name: 'Report another problem' })
  }

  async goto() {
    await this.page.goto('/resident/new')
    await expect(this.page.getByRole('heading', { name: 'Report a problem', level: 1 })).toBeVisible()
  }

  async attachPhoto(photo: PhotoFile) {
    await this.photoInput.setInputFiles(photo)
    await expect(this.page.getByRole('img', { name: 'Selected' })).toBeVisible()
  }

  /**
   * Click the map to drop the pin. The position is randomised around the centre (Calgary)
   * so separate UI reports never land within the 50 m duplicate radius of each other.
   */
  async dropPin() {
    const box = (await this.map.boundingBox())!
    const x = box.width / 2 + (Math.random() - 0.5) * box.width * 0.5
    const y = box.height / 2 + (Math.random() - 0.2) * box.height * 0.4
    await this.map.click({ position: { x, y } })
    await expect(this.page.getByText('Pin placed. Click again to move it.')).toBeVisible()
  }

  category(name: string): Locator {
    return this.page.locator('form').getByRole('button', { name, exact: true })
  }

  /** Fill the whole form (photo, pin, category, optional text) without submitting. */
  async fill(o: { photo: PhotoFile; category: string; description?: string; address?: string }) {
    await this.attachPhoto(o.photo)
    await this.dropPin()
    await this.category(o.category).click()
    if (o.description) await this.description.fill(o.description)
    if (o.address) {
      // The reverse-geocoder fills the field ~400 ms after the pin drops; wait, then overwrite it.
      await expect(this.address).not.toHaveValue('')
      await this.address.fill(o.address)
    }
  }

  /** Submit and return the new report's ids from the API response. */
  async submitAndCapture(): Promise<{ report_id: string; issue_id: string }> {
    const response = this.page.waitForResponse((r) => r.url().endsWith('/api/reports') && r.request().method() === 'POST')
    await this.submit.click()
    return (await response).json()
  }
}

export class MyReportsPage {
  readonly heading: Locator
  readonly items: Locator
  readonly waitingBanner: Locator
  readonly checkRepair: Locator
  readonly empty: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'My reports', level: 1 })
    this.items = page.locator('main ul > li')
    this.waitingBanner = page.getByText(/(A repair is|\d+ repairs are) waiting for your answer/)
    this.checkRepair = page.getByRole('link', { name: 'Check the repair' })
    this.empty = page.getByRole('heading', { name: 'No reports yet' })
  }

  async goto() {
    await this.page.goto('/resident/reports')
    await expect(this.heading).toBeVisible()
  }

  item(text: string): Locator {
    return this.items.filter({ hasText: text })
  }

  link(reportId: string): Locator {
    return this.page.locator(`a[href="/resident/reports/${reportId}"]`)
  }
}

export class ReportDetailPage {
  readonly backLink: Locator
  readonly title: Locator
  readonly confirmPanel: Locator
  readonly yesFixed: Locator
  readonly stillBroken: Locator
  readonly disputeReason: Locator
  readonly sendAgain: Locator
  readonly history: Locator
  readonly yourPhoto: Locator

  constructor(readonly page: Page) {
    this.backLink = page.getByRole('link', { name: 'My reports' }).last()
    this.title = page.getByRole('heading', { level: 1 })
    this.confirmPanel = page.getByRole('heading', { name: 'Is it fixed?' })
    this.yesFixed = page.getByRole('button', { name: "Yes, it's fixed" })
    this.stillBroken = page.getByRole('button', { name: 'No, still broken' })
    this.disputeReason = page.getByPlaceholder('What is still wrong?')
    this.sendAgain = page.getByRole('button', { name: 'Send to the crew again' })
    this.history = page.locator('div.card').filter({ has: page.getByRole('heading', { name: 'History' }) }).locator('ol')
    this.yourPhoto = page.getByRole('img', { name: 'Your photo' })
  }

  async goto(reportId: string) {
    await this.page.goto(`/resident/reports/${reportId}`)
  }

  /** The status badge next to the title. */
  statusBadge(label: string): Locator {
    return this.title.locator('..').getByText(label, { exact: true })
  }

  /** The six-step status stepper (Reported, Checked, Crew assigned, In progress, Repaired, Closed). */
  get stepper(): Locator {
    return this.page.locator('ol').filter({ hasText: 'Reported' }).filter({ hasText: 'Closed' }).first()
  }
}
