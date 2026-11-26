import { NewReportPage, ReportDetailPage } from '../../pages/ResidentPages'
import { eventually } from '../../support/api'
import { API_URL, PROBLEM_TYPES } from '../../support/env'
import { STUB_ADDRESS, expect, test } from '../../support/fixtures'
import { report, uniqueTag } from '../../support/flows'
import { outsideServiceAreas } from '../../support/geo'
import { makePhoto, notAnImage, oversizedPhoto } from '../../support/photos'

test.describe('Submit a report (FR-1, FR-2)', () => {
  test('TC-011 a resident submits a valid report and it moves on once validated @smoke', async ({ page, signIn, api, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    const address = `${uniqueTag()} Centre St`

    await form.fill({ photo: makePhoto(), category: 'Pothole', description: 'Deep pothole in the right lane', address })
    await expect(form.stillNeeded).toHaveCount(0)
    const accepted = await form.submitAndCapture()

    await expect(form.received).toBeVisible()
    // Validation, priority and dispatch run in the background (event driven) within seconds.
    const issue = await api.waitForStatus(accepted.issue_id, 'assigned')
    expect(issue.address_text).toBe(address)
    expect(issue.problem_type).toBe('pothole')

    await form.trackLink.click()
    await expect(page).toHaveURL(new RegExp(`/resident/reports/${accepted.report_id}$`))
    const detail = new ReportDetailPage(page)
    await expect(detail.title).toHaveText(PROBLEM_TYPES.pothole)
    await expect(page.locator('main').getByText(address).first()).toBeVisible()
    await expect(page.getByText('“Deep pothole in the right lane”')).toBeVisible()
  })

  test('the form starts by listing everything still needed', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await expect(form.stillNeeded).toHaveText('Still needed: a photo, a map pin, a category')
    await expect(form.submit).toBeDisabled()
    for (const name of Object.values(PROBLEM_TYPES)) await expect(form.category(name)).toBeVisible()
  })

  test('TC-012 the report cannot be submitted without a photo', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await form.dropPin()
    await form.category('Broken streetlight').click()

    await expect(form.stillNeeded).toHaveText('Still needed: a photo')
    await expect(form.submit).toBeDisabled()
  })

  test('TC-013 the report cannot be submitted without a map pin', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await form.attachPhoto(makePhoto())
    await form.category('Water leak').click()

    await expect(form.stillNeeded).toHaveText('Still needed: a map pin')
    await expect(form.submit).toBeDisabled()
  })

  test('a category is required too', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await form.attachPhoto(makePhoto())
    await form.dropPin()
    await expect(form.stillNeeded).toHaveText('Still needed: a category')
    await form.category('Cracked sidewalk').click()
    await expect(form.submit).toBeEnabled()
  })

  test('TC-014 a file that is not an image is rejected and no report is created', async ({ page, signIn, api, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await form.photoInput.setInputFiles(notAnImage())
    await form.dropPin()
    await form.category('Pothole').click()

    await form.submit.click()

    await expect(page.getByText('File is not a readable image')).toBeVisible()
    await expect(form.received).toHaveCount(0)
    expect(await api.myReports(freshResident)).toHaveLength(0)
  })

  test('TC-015 a photo larger than 15 MB is rejected', async ({ page, signIn, api, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await form.photoInput.setInputFiles(oversizedPhoto())
    await form.dropPin()
    await form.category('Pothole').click()

    await form.submit.click()

    await expect(page.getByText('Photo is larger than 15 MB')).toBeVisible({ timeout: 30_000 })
    expect(await api.myReports(freshResident)).toHaveLength(0)
  })

  test('TC-016 the description stops at 1000 characters and the API refuses longer text', async ({ page, signIn, api, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await form.description.fill('x'.repeat(1100))
    await expect(form.description).toHaveValue('x'.repeat(1000))

    const res = await api.request.post(`${API_URL}/reports`, {
      headers: { Authorization: `Bearer ${(await api.login(freshResident)).access_token}` },
      multipart: { photo: makePhoto(), lat: '51.05', lng: '-114.07', problem_type: 'pothole', description: 'y'.repeat(1001) },
    })
    expect(res.status()).toBe(422)
  })

  test('an unknown problem category is refused by the API', async ({ api, freshResident }) => {
    const res = await api.request.post(`${API_URL}/reports`, {
      headers: { Authorization: `Bearer ${(await api.login(freshResident)).access_token}` },
      multipart: { photo: makePhoto(), lat: '51.05', lng: '-114.07', problem_type: 'volcano' },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).detail).toBe('Unknown problem category')
  })

  test('dropping a pin fills in the address from reverse geocoding', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await expect(form.pinHint).toHaveText('Click the map where the problem is')
    await form.dropPin()
    await expect(form.address).toHaveValue(STUB_ADDRESS)
  })

  test('"Use my location" drops the pin at the browser position', async ({ page, context, signIn, freshResident }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 51.0447, longitude: -114.0719 })
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)

    await form.useMyLocation.click()

    await expect(page.getByText('Pin placed. Click again to move it.')).toBeVisible()
    await expect(form.address).toHaveValue(STUB_ADDRESS)
  })

  test('"Report another problem" clears the form after a submission', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    await form.fill({ photo: makePhoto(), category: 'Other infrastructure', description: 'Bent railing' })
    await form.submitAndCapture()
    await expect(form.received).toBeVisible()

    await form.reportAnother.click()

    await expect(form.stillNeeded).toHaveText('Still needed: a photo, a map pin, a category')
    await expect(form.description).toHaveValue('')
  })

  test('FR-2 the local model rates the photo and its severity sets the deadline', async ({ api, freshResident }) => {
    const r = await report(api, { resident: freshResident, type: 'water_leak', description: '[ai:severity=5] Water main burst' })

    const issue = await api.waitForStatus(r.issueId, 'assigned')

    expect(issue.severity).toBe(5)
    expect(issue.reports[0].ai_model).toBe('mock-vision')
    // severity_sla: severity 5 = 8 hours
    const hours = (new Date(issue.work_orders[0].deadline_at).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(7.5)
    expect(hours).toBeLessThanOrEqual(8)
  })

  test('FR-2 the model can correct the category the resident chose', async ({ api, freshResident }) => {
    const r = await report(api, { resident: freshResident, type: 'other', description: '[ai:type=streetlight] Lamp is dark' })
    const issue = await api.waitForStatus(r.issueId, 'assigned')
    expect(issue.problem_type).toBe('streetlight')
    expect(issue.work_orders[0].crew_name).toBe('Street Lighting')
  })

  test('TC-017 a report outside the Calgary service areas is still assigned to the right specialty', async ({ api, freshResident }) => {
    const r = await report(api, { resident: freshResident, type: 'water_leak', point: outsideServiceAreas() })

    const issue = await api.waitForStatus(r.issueId, 'assigned')

    expect(issue.area_name).toBeNull()
    expect(issue.work_orders[0].crew_name).toBe('Water Services')
  })

  test('NFR-5 the photo is classified by the locally hosted model', async ({ api, freshResident }) => {
    const before = (await api.modelCalls()).length
    const r = await report(api, { resident: freshResident })
    await api.waitForStatus(r.issueId, 'assigned')

    const calls = (await api.modelCalls()).slice(before)
    const classify = calls.find((c) => c.kind === 'classify')
    expect(classify, 'the backend never asked the local model to classify the photo').toBeTruthy()
    expect(classify!.model).toBe('mock-vision')
    expect(classify!.images).toBe(1)
  })

  test('the report appears in My reports straight after submission', async ({ page, signIn, freshResident }) => {
    await signIn(freshResident, '/resident/new')
    const form = new NewReportPage(page)
    const address = `${uniqueTag()} Macleod Trail`
    await form.fill({ photo: makePhoto(), category: 'Cracked sidewalk', address })
    await form.submitAndCapture()

    await page.getByRole('link', { name: 'My reports' }).click()

    await expect(page.locator('main ul > li').filter({ hasText: address })).toBeVisible()
    await eventually(
      () => page.locator('main ul > li').count(),
      (n) => n === 1,
      { message: 'My reports should list exactly the one new report' },
    )
  })
})
