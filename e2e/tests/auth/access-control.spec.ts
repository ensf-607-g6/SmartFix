import { API_URL, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, report } from '../../support/flows'

/** NFR-6: residents see their own reports, crews their own work orders, staff everything. */
test.describe('Role-based access (NFR-6)', () => {
  test('TC-008 a resident is redirected away from operator pages and the operator API refuses them', async ({ page, signIn, api }) => {
    await signIn(USERS.resident)
    for (const path of ['/ops/map', '/ops/review', '/ops/stats', '/crew']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/resident\/reports$/)
    }
    for (const path of ['/dashboard/map', '/dashboard/summary', '/review', '/stats', '/crews']) {
      const res = await api.raw('GET', path, USERS.resident)
      expect(res.status(), path).toBe(403)
      expect((await res.json()).detail).toBe('Your role cannot do this')
    }
  })

  test('TC-009 a crew member is redirected away from the review queue and the API refuses them', async ({ page, signIn, api }) => {
    await signIn(USERS.crewNorth)
    for (const path of ['/ops/review', '/ops/map', '/resident/new']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/crew$/)
    }
    expect((await api.raw('GET', '/review', USERS.crewNorth)).status()).toBe(403)
    expect((await api.raw('GET', '/reports/mine', USERS.crewNorth)).status()).toBe(403)
  })

  test('TC-010 the API answers 401 "Not signed in" without a token', async ({ api }) => {
    for (const path of ['/reports/mine', '/notifications', '/dashboard/map', '/crew/work-orders', '/auth/me']) {
      const res = await api.raw('GET', path, null)
      expect(res.status(), path).toBe(401)
      expect((await res.json()).detail).toBe('Not signed in')
    }
  })

  test('operators and supervisors cannot submit resident reports', async ({ api }) => {
    for (const who of [USERS.operator, USERS.supervisor, USERS.crewWater]) {
      const res = await api.raw('POST', '/reports', who)
      expect([403, 422]).toContain(res.status())
    }
    // A clean 403 when the form is complete: the role check, not validation, refuses it.
    const res = await api.request.post(`${API_URL}/reports`, {
      headers: { Authorization: `Bearer ${(await api.login(USERS.operator)).access_token}` },
      multipart: { lat: '51.05', lng: '-114.07', problem_type: 'pothole', photo: { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') } },
    })
    expect(res.status()).toBe(403)
  })

  test('TC-018 a resident cannot open another resident\'s report', async ({ page, signIn, api }) => {
    const theirs = await report(api, { resident: USERS.resident2 })

    const res = await api.raw('GET', `/reports/${theirs.reportId}`, USERS.resident)
    expect(res.status()).toBe(404)
    expect((await res.json()).detail).toBe('Report not found')

    await signIn(USERS.resident, `/resident/reports/${theirs.reportId}`)
    await expect(page.getByText(theirs.address)).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0)
  })

  test('TC-029 a crew cannot see or act on another crew\'s work order', async ({ api }) => {
    const a = await assignedIssue(api, { type: 'water_leak' })
    expect(a.crewName).toBe('Water Services')

    const lights = await api.crewOrders(USERS.crewLights)
    expect(lights.map((o) => o.work_order_id)).not.toContain(a.workOrder.work_order_id)
    const res = await api.raw('GET', `/crew/work-orders/${a.workOrder.work_order_id}`, USERS.crewLights)
    expect(res.status()).toBe(404)
    expect((await res.json()).detail).toBe('Work order not found')
    const start = await api.raw('PATCH', `/crew/work-orders/${a.workOrder.work_order_id}`, USERS.crewLights, { status: 'in_progress' })
    expect(start.status()).toBe(404)
  })

  test('photos are only served to people allowed to see them', async ({ api }) => {
    const r = await report(api, { resident: USERS.resident2 })
    const mine = await api.myReport(USERS.resident2, r.reportId)
    const photoId = (mine.reports[0] as unknown as { photo_id: string }).photo_id

    expect((await api.raw('GET', `/photos/${photoId}`, USERS.resident2)).status()).toBe(200)
    expect((await api.raw('GET', `/photos/${photoId}`, USERS.operator)).status()).toBe(200)
    expect((await api.raw('GET', `/photos/${photoId}`, null)).status()).toBe(401)
    expect((await api.raw('GET', `/photos/${photoId}`, USERS.resident)).status()).toBe(404)
  })
})
