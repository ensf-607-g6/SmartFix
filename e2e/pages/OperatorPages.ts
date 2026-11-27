import { expect, type Locator, type Page } from '@playwright/test'

export class ReviewPage {
  readonly heading: Locator
  readonly cards: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Review queue', level: 1 })
    this.cards = page.locator('article')
  }

  async goto() {
    await this.page.goto('/ops/review')
    await expect(this.heading).toBeVisible()
  }

  /** The review card for a report, found by its unique address tag. */
  card(address: string) {
    const card = this.cards.filter({ hasText: address })
    return {
      root: card,
      reasonBadge: (label: 'Low confidence' | 'May not be infrastructure') => card.getByText(label, { exact: true }),
      problemType: card.getByLabel('Problem type'),
      severity: card.getByLabel('Severity'),
      note: card.getByLabel('Note to the resident (optional)'),
      approve: card.getByRole('button', { name: 'Approve and prioritize' }),
      reject: card.getByRole('button', { name: 'Reject' }),
      modelUnavailable: card.getByText('The vision model was unavailable, so this report needs a person to check it.'),
    }
  }
}

export class LiveMapPage {
  readonly toolbar: Locator
  readonly queue: Locator
  readonly shownCount: Locator
  readonly clearFilters: Locator
  readonly escalatedOnly: Locator
  readonly hotspots: Locator
  readonly markers: Locator
  readonly emptyQueue: Locator
  readonly latestEvent: Locator

  constructor(readonly page: Page) {
    this.toolbar = page.locator('div.absolute.top-4').filter({ hasText: 'Status' })
    this.queue = page.locator('aside ol > li')
    this.shownCount = page.getByText(/\d+ shown · highest first/)
    this.clearFilters = page.getByRole('button', { name: 'Clear filters' })
    this.escalatedOnly = page.getByRole('button', { name: 'Escalated only' })
    this.hotspots = page.getByRole('button', { name: 'Hotspots by area' })
    // Issue markers are the interactive circles; selection/escalation rings are not interactive.
    this.markers = page.locator('.leaflet-overlay-pane path.leaflet-interactive')
    this.emptyQueue = page.getByText('No open issues match these filters')
    this.latestEvent = page.getByText(/^Latest event:/)
  }

  async goto() {
    await this.page.goto('/ops/map')
    await expect(this.page.getByRole('heading', { name: 'Priority queue' })).toBeVisible()
  }

  /** A filter chip in the toolbar: a status label, a problem type name or a severity 1-5. */
  chip(label: string): Locator {
    // Severity chips show just the digit but are announced as "Severity N".
    const name = /^[1-5]$/.test(label) ? `Severity ${label}` : label
    return this.toolbar.getByRole('button', { name, exact: true })
  }

  item(address: string): Locator {
    return this.queue.filter({ hasText: address })
  }

  async shown(): Promise<number> {
    return Number(/(\d+) shown/.exec((await this.shownCount.innerText()) ?? '')?.[1] ?? -1)
  }

  /** Priority scores of the listed issues, top to bottom. */
  async scores(): Promise<number[]> {
    const texts = await this.queue.locator('span.tabular-nums').allInnerTexts()
    return texts.map(Number)
  }

  kpi(label: 'Open' | 'Escalated' | 'No crew yet' | 'To review'): Locator {
    return this.page.locator('aside').getByText(label, { exact: true }).locator('..')
  }

  async open(address: string): Promise<IssueDrawer> {
    await this.item(address).click()
    const drawer = new IssueDrawer(this.page)
    await expect(drawer.root).toBeVisible()
    return drawer
  }
}

export class IssueDrawer {
  readonly root: Locator
  readonly close: Locator
  readonly overviewTab: Locator
  readonly timelineTab: Locator
  readonly timeline: Locator
  readonly crewSelect: Locator
  readonly dispatch: Locator
  readonly move: Locator
  readonly reassignReason: Locator
  readonly missDeadline: Locator
  readonly skipAhead: Locator
  readonly waitingForCrew: Locator

  constructor(readonly page: Page) {
    this.root = page.locator('div.fixed.inset-0 > aside')
    this.close = this.root.getByRole('button', { name: 'Close' })
    this.overviewTab = this.root.getByRole('button', { name: 'Overview', exact: true })
    this.timelineTab = this.root.getByRole('button', { name: 'Event timeline', exact: true })
    this.timeline = this.root.locator('ol')
    this.crewSelect = this.root.getByRole('combobox')
    this.dispatch = this.root.getByRole('button', { name: 'Dispatch' })
    this.move = this.root.getByRole('button', { name: 'Move', exact: true })
    this.reassignReason = this.root.getByPlaceholder('Reason (optional)')
    this.missDeadline = this.root.getByRole('button', { name: 'Miss the deadline now' })
    this.skipAhead = this.root.getByRole('button', { name: 'Skip ahead 7 days (auto-close)' })
    this.waitingForCrew = this.root.getByText('Waiting for a crew')
  }

  field(label: string): Locator {
    return this.root.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
  }

  /** Event names in the timeline, in order (e.g. "Issue reported"). */
  async eventNames(): Promise<string[]> {
    return this.timeline.locator('li p.font-semibold').allInnerTexts()
  }

  /** Pick a crew option by crew name (the option text also shows workload). */
  async chooseCrew(name: string) {
    const option = this.crewSelect.locator('option', { hasText: name })
    await this.crewSelect.selectOption({ label: (await option.innerText()).trim() })
  }
}

export class StatsPage {
  readonly heading: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Repair statistics', level: 1 })
  }

  async goto() {
    await this.page.goto('/ops/stats')
    await expect(this.heading).toBeVisible()
  }

  card(title: string): Locator {
    return this.page.locator('section.card').filter({ has: this.page.getByRole('heading', { name: title }) })
  }

  tile(label: string): Locator {
    return this.page.locator('div.card').filter({ has: this.page.getByText(label, { exact: true }) }).first()
  }
}
