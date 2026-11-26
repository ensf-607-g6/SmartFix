import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { SmartFixApi } from './api'
import { DEMO_PASSWORD, FRONTEND_URL } from './env'

const SESSION_KEY = 'smartfix.session'

/** 1x1 transparent PNG served for every map tile. */
const BLANK_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

export const STUB_ADDRESS = '100 Stubbed Street SW, Beltline'

/**
 * Keep the run offline and repeatable: map tiles get a blank image, reverse geocoding gets a
 * fixed address, Google Fonts are dropped. Requests to the local stack pass through untouched.
 */
export async function stubExternal(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    const url = route.request().url()
    if (url.includes('basemaps.cartocdn.com')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE })
    }
    if (url.includes('nominatim.openstreetmap.org')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ address: { house_number: '100', road: 'Stubbed Street SW', neighbourhood: 'Beltline' } }),
      })
    }
    return route.abort()
  })
}

export function homeFor(role: string): string {
  if (role === 'resident') return '/resident/reports'
  if (role === 'crew') return '/crew'
  return '/ops/map'
}

/** Start a session without the login form: store the API session where the app reads it. */
export async function signInPage(page: Page, api: SmartFixApi, email: string, path?: string): Promise<void> {
  const session = await api.login(email)
  await page.goto('/login')
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [SESSION_KEY, JSON.stringify(session)])
  await page.goto(path ?? homeFor(session.user.role))
}

interface Fixtures {
  /** REST client for arranging data and checking backend state. */
  api: SmartFixApi
  /** Sign the default `page` in as `email` and open `path` (default: that role's home page). */
  signIn: (email: string, path?: string) => Promise<void>
  /** A second, fully separate browser session (own storage) signed in as `email`. */
  openAs: (email: string, path?: string) => Promise<Page>
  /** Email of a resident registered just for this test (password smartfix123), so their
   * report list and inbox contain only what this test created. */
  freshResident: string
}

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    await stubExternal(context)
    await use(context)
  },

  api: async ({ playwright }, use) => {
    const request = await playwright.request.newContext()
    await use(new SmartFixApi(request))
    await request.dispose()
  },

  signIn: async ({ page, api }, use) => {
    await use((email, path) => signInPage(page, api, email, path))
  },

  openAs: async ({ browser, api, viewport }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (email, path) => {
      const context = await browser.newContext({ baseURL: FRONTEND_URL, viewport: viewport ?? { width: 1440, height: 900 } })
      contexts.push(context)
      await stubExternal(context)
      const page = await context.newPage()
      await signInPage(page, api, email, path)
      return page
    })
    for (const c of contexts) await c.close()
  },

  freshResident: async ({ api }, use, testInfo) => {
    const email = `resident.${Date.now().toString(36)}.${testInfo.workerIndex}${Math.floor(Math.random() * 1e5)}@e2e.smartfix.dev`
    await api.register('Fresh Resident', email, DEMO_PASSWORD)
    await use(email)
  },
})

export { expect }
