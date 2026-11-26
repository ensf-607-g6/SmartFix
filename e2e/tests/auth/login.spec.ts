import { AppShell } from '../../pages/AppShell'
import { LoginPage } from '../../pages/LoginPage'
import { DEMO_PASSWORD, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'

test.describe('Login and logout (NFR-6)', () => {
  test('TC-001 a resident signs in and lands on the resident pages @smoke', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await expect(login.heading).toHaveText('Sign in')

    await login.login(USERS.resident, DEMO_PASSWORD)

    await expect(page).toHaveURL(/\/resident\/reports$/)
    const shell = new AppShell(page)
    expect(await shell.navLabels()).toEqual(['Report a problem', 'My reports'])
    await expect(shell.sidebar.getByText('Riley Resident')).toBeVisible()
  })

  test('TC-002 a wrong password is rejected and the user stays on the login page', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    await login.login(USERS.resident, 'definitely-wrong')

    await expect(login.error('Email or password is incorrect')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('TC-002b an unknown email is rejected with the same message', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login('nobody-here@smartfix.dev', DEMO_PASSWORD)
    await expect(login.error('Email or password is incorrect')).toBeVisible()
  })

  test('TC-003 the email is not case-sensitive', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    await login.login(USERS.resident.toUpperCase(), DEMO_PASSWORD)

    await expect(page).toHaveURL(/\/resident\/reports$/)
  })

  const roles = [
    { button: 'Resident', home: /\/resident\/reports$/, nav: ['Report a problem', 'My reports'] },
    { button: 'City operator', home: /\/ops\/map$/, nav: ['Live map', 'Review queue', 'Repair statistics'] },
    { button: 'Crew (Roads North)', home: /\/crew$/, nav: ['Work orders'] },
    { button: 'Supervisor', home: /\/ops\/map$/, nav: ['Live map', 'Review queue', 'Repair statistics'] },
  ] as const
  for (const role of roles) {
    test(`demo account "${role.button}" opens its own home page and menu`, async ({ page }) => {
      const login = new LoginPage(page)
      await login.goto()
      await login.demoAccount(role.button).click()
      await expect(page).toHaveURL(role.home)
      expect(await new AppShell(page).navLabels()).toEqual([...role.nav])
    })
  }

  test('TC-007 signing out ends the session and protected pages need a new sign-in @smoke', async ({ page, signIn }) => {
    await signIn(USERS.resident)
    const shell = new AppShell(page)
    await expect(shell.signOut).toBeVisible()

    await shell.signOut.click()

    await expect(page).toHaveURL(/\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('smartfix.session'))).toBeNull()
    await page.goto('/resident/new')
    await expect(page.getByRole('heading', { name: 'Report a problem' })).toHaveCount(0)
    await expect(shell.signOut).toHaveCount(0)
  })

  test('TC-010 a signed-out user who opens a protected page is sent to login', async ({ page }) => {
    test.fail(
      true,
      'Known bug: AppShell returns null when signed out, so the RequireRole redirect inside it never renders ' +
        'and the page stays blank at the protected URL (frontend/src/layouts/AppShell.tsx).',
    )
    for (const path of ['/resident/new', '/crew', '/ops/map']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/, { timeout: 5_000 })
    }
  })

  test('a signed-in user who opens /login is sent to their home page', async ({ page, signIn }) => {
    await signIn(USERS.operator)
    await page.goto('/login')
    await expect(page).toHaveURL(/\/ops\/map$/)
  })

  test('the session survives a page reload', async ({ page, signIn }) => {
    await signIn(USERS.crewNorth)
    await page.reload()
    await expect(page).toHaveURL(/\/crew$/)
    await expect(new AppShell(page).sidebar.getByText('Roads Crew North')).toBeVisible()
  })

  test('an invalid stored token signs the user out on the next API call', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() =>
      localStorage.setItem(
        'smartfix.session',
        JSON.stringify({
          access_token: 'not-a-real-token',
          user: { user_id: 'x', email: 'resident@smartfix.dev', full_name: 'Riley', role: 'resident', crew_id: null, crew_name: null },
        }),
      ),
    )
    await page.goto('/resident/reports')
    await expect(page).toHaveURL(/\/login$/)
  })
})
