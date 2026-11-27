import type { Locator, Page } from '@playwright/test'

export class LoginPage {
  readonly heading: Locator
  readonly fullName: Locator
  readonly email: Locator
  readonly password: Locator
  readonly signInButton: Locator
  readonly createAccountButton: Locator
  readonly switchToRegister: Locator
  readonly switchToSignIn: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 2 })
    this.fullName = page.getByLabel('Full name', { exact: true })
    this.email = page.getByLabel('Email', { exact: true })
    this.password = page.getByLabel('Password', { exact: true })
    this.signInButton = page.locator('form').getByRole('button', { name: 'Sign in', exact: true })
    this.createAccountButton = page.locator('form').getByRole('button', { name: 'Create account', exact: true })
    this.switchToRegister = page.getByRole('button', { name: 'Create an account', exact: true })
    this.switchToSignIn = page.locator('p').getByRole('button', { name: 'Sign in', exact: true })
  }

  async goto() {
    await this.page.goto('/login')
  }

  async login(email: string, password: string) {
    await this.email.fill(email)
    await this.password.fill(password)
    await this.signInButton.click()
  }

  async register(fullName: string, email: string, password: string) {
    await this.switchToRegister.click()
    await this.fullName.fill(fullName)
    await this.email.fill(email)
    await this.password.fill(password)
    await this.createAccountButton.click()
  }

  demoAccount(label: 'Resident' | 'City operator' | 'Crew (Roads North)' | 'Supervisor'): Locator {
    return this.page.getByRole('button', { name: label, exact: true })
  }

  /** The red error note under the form. */
  error(text: string | RegExp): Locator {
    return this.page.locator('form').getByText(text)
  }
}
