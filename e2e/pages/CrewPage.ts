import { expect, type Locator, type Page } from '@playwright/test'
import type { PhotoFile } from '../support/photos'

export class CrewPage {
  readonly heading: Locator
  readonly toDoTab: Locator
  readonly completedTab: Locator
  readonly orders: Locator
  readonly startWork: Locator
  readonly completeRepair: Locator
  readonly modal: Locator
  readonly afterPhotoInput: Locator
  readonly notes: Locator
  readonly markRepaired: Locator
  readonly escalatedWarning: Locator
  readonly emptyToDo: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Work orders', level: 1 })
    this.toDoTab = page.getByRole('button', { name: 'To do', exact: true })
    this.completedTab = page.getByRole('button', { name: 'Completed', exact: true })
    this.orders = page.locator('main ul > li > button')
    this.startWork = page.getByRole('button', { name: 'Start work' })
    this.completeRepair = page.getByRole('button', { name: 'Complete repair' })
    this.modal = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'Complete repair' }) })
    this.afterPhotoInput = this.modal.locator('input[type="file"]')
    this.notes = this.modal.getByLabel('Notes (optional)')
    this.markRepaired = this.modal.getByRole('button', { name: /Mark as repaired|Uploading…/ })
    this.escalatedWarning = page.getByText('This job missed a deadline and was escalated. Please handle it first.')
    this.emptyToDo = page.getByRole('heading', { name: 'No open work orders' })
  }

  async goto() {
    await this.page.goto('/crew')
    await expect(this.heading).toBeVisible()
  }

  order(address: string): Locator {
    return this.orders.filter({ hasText: address })
  }

  /** The detail card for the selected order (title + action buttons). */
  detail(address: string): Locator {
    return this.page.locator('div.card').filter({ has: this.page.getByRole('heading', { level: 2 }) }).filter({ hasText: address })
  }

  async select(address: string) {
    await this.order(address).click()
    await expect(this.detail(address)).toBeVisible()
  }

  async complete(photo: PhotoFile, notes?: string) {
    await this.completeRepair.click()
    await expect(this.modal).toBeVisible()
    await this.afterPhotoInput.setInputFiles(photo)
    if (notes) await this.notes.fill(notes)
    await this.markRepaired.click()
    await expect(this.modal).toBeHidden()
  }
}
