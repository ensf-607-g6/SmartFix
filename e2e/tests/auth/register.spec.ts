import { AppShell } from '../../pages/AppShell'
import { LoginPage } from '../../pages/LoginPage'
import { API_URL, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'

const newEmail = () => `e2e.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`

test.describe('Resident registration (NFR-6)', () => {
  test('TC-004 a new resident can register and is signed in straight away @smoke', async ({ page, api }) => {
    const login = new LoginPage(page)
    const email = newEmail()
    await login.goto()

    await login.register('Pat Playwright', email, 'longenough1')

    await expect(page).toHaveURL(/\/resident\/reports$/)
    await expect(page.getByRole('heading', { name: 'No reports yet' })).toBeVisible()
    await expect(new AppShell(page).sidebar.getByText('Pat Playwright')).toBeVisible()
    const session = await api.login(email, 'longenough1')
    expect(session.user.role).toBe('resident')
  })

  test('TC-005 registering an email that already exists is refused', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    await login.register('Someone Else', USERS.resident, 'longenough1')

    await expect(login.error('An account with this email already exists')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('TC-005b the duplicate check ignores capitalisation', async ({ api }) => {
    const res = await api.request.post(`${API_URL}/auth/register`, {
      data: { full_name: 'Case Test', email: USERS.resident.toUpperCase(), password: 'longenough1' },
    })
    expect(res.status()).toBe(409)
  })

  test('TC-006 a password shorter than 8 characters is refused', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.register('Short Pass', newEmail(), 'short7!')

    // The browser blocks the form (minlength=8) before any request is sent.
    expect(await login.password.evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true)
    await expect(page).toHaveURL(/\/login$/)
    await expect(login.createAccountButton).toBeVisible()
  })

  test('TC-006b the API also refuses a short password', async ({ api }) => {
    const res = await api.request.post(`${API_URL}/auth/register`, {
      data: { full_name: 'Short Pass', email: newEmail(), password: 'short7!' },
    })
    expect(res.status()).toBe(422)
  })

  test('switching between sign-in and register keeps the right fields', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await expect(login.fullName).toHaveCount(0)
    await login.switchToRegister.click()
    await expect(login.heading).toHaveText('Create a resident account')
    await expect(login.fullName).toBeVisible()
    await login.switchToSignIn.click()
    await expect(login.heading).toHaveText('Sign in')
    await expect(login.fullName).toHaveCount(0)
  })
})
