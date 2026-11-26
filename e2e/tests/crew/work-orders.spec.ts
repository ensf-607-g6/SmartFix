import { CrewPage } from '../../pages/CrewPage'
import { eventually } from '../../support/api'
import { API_URL, PROBLEM_TYPES, USERS } from '../../support/env'
import { expect, test } from '../../support/fixtures'
import { assignedIssue, inProgressIssue } from '../../support/flows'
import { makePhoto, notAnImage } from '../../support/photos'

test.describe('Crew portal (FR-7)', () => {
  test('TC-029 a crew member sees their own crew\'s work orders and not other crews\'', async ({ page, signIn, api }) => {
    const water = await assignedIssue(api, { type: 'water_leak' })
    const light = await assignedIssue(api, { type: 'streetlight' })

    await signIn(USERS.crewWater)
    const crew = new CrewPage(page)
    await expect(page.getByText('Water Services · escalated and soonest-due jobs first')).toBeVisible()
    await expect(crew.order(water.address)).toBeVisible()
    await expect(crew.order(light.address)).toHaveCount(0)
  })

  test('the selected order shows severity, deadline, reports and the resident photo', async ({ page, signIn, api }) => {
    const a = await assignedIssue(api, { type: 'streetlight', description: '[ai:severity=2] Flickering lamp' })

    await signIn(USERS.crewLights)
    const crew = new CrewPage(page)
    await crew.select(a.address)

    const detail = crew.detail(a.address)
    await expect(detail.getByRole('heading', { name: PROBLEM_TYPES.streetlight })).toBeVisible()
    await expect(detail.getByText('2/5 · Minor')).toBeVisible()
    await expect(detail.getByText('1 resident', { exact: true })).toBeVisible()
    await expect(detail.getByText('Resident: “[ai:severity=2] Flickering lamp”')).toBeVisible()
    await expect(detail.getByRole('img', { name: 'Reported problem' })).toBeVisible()
    await expect(detail.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', /openstreetmap\.org\/directions/)
    await expect(crew.order(a.address)).toContainText(/Due in \d+/)
  })

  test('TC-030 starting work moves the order and the issue to In progress and tells the resident @smoke', async ({
    page,
    signIn,
    api,
    freshResident,
  }) => {
    const a = await assignedIssue(api, { resident: freshResident, type: 'water_leak' })
    await signIn(USERS.crewWater)
    const crew = new CrewPage(page)
    await crew.select(a.address)

    await crew.startWork.click()

    await expect(crew.order(a.address).getByText('Started', { exact: true })).toBeVisible()
    await expect(crew.completeRepair).toBeVisible()
    await expect(crew.startWork).toHaveCount(0)
    const issue = await api.waitForStatus(a.issueId, 'in_progress')
    expect(issue.work_orders[0].status).toBe('in_progress')
    expect(issue.work_orders[0].started_at).not.toBeNull()
    await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.message === `A crew has started work on your water leak report at ${a.address}.`),
      { message: 'the resident was not told that work started' },
    )
  })

  test('work cannot be started twice', async ({ api }) => {
    const a = await inProgressIssue(api, { type: 'streetlight' })
    const res = await api.raw('PATCH', `/crew/work-orders/${a.workOrder.work_order_id}`, a.crewEmail, { status: 'in_progress' })
    expect(res.status()).toBe(409)
    expect((await res.json()).detail).toBe('Work has already started on this order')
  })

  test('TC-031 a repair cannot be completed without an after photo', async ({ page, signIn, api }) => {
    const a = await inProgressIssue(api, { type: 'water_leak' })
    await signIn(USERS.crewWater)
    const crew = new CrewPage(page)
    await crew.select(a.address)

    await crew.completeRepair.click()
    await expect(crew.modal).toBeVisible()
    await expect(crew.markRepaired).toBeDisabled()
    await crew.notes.fill('Tried to finish without a photo')
    await expect(crew.markRepaired).toBeDisabled()

    // The API refuses a completion without the after_photo field too.
    const res = await api.request.post(`${API_URL}/crew/work-orders/${a.workOrder.work_order_id}/complete`, {
      headers: { Authorization: `Bearer ${(await api.login(USERS.crewWater)).access_token}` },
      multipart: { notes: 'no photo' },
    })
    expect(res.status()).toBe(422)
    expect((await api.issue(a.issueId)).status).toBe('in_progress')
  })

  test('an after photo that is not an image is rejected', async ({ api }) => {
    const a = await inProgressIssue(api, { type: 'streetlight' })
    const res = await api.request.post(`${API_URL}/crew/work-orders/${a.workOrder.work_order_id}/complete`, {
      headers: { Authorization: `Bearer ${(await api.login(a.crewEmail)).access_token}` },
      multipart: { after_photo: notAnImage() },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).detail).toBe('File is not a readable image')
  })

  test('a repair cannot be completed before work has started', async ({ api }) => {
    const a = await assignedIssue(api, { type: 'water_leak' })
    const res = await api.request.post(`${API_URL}/crew/work-orders/${a.workOrder.work_order_id}/complete`, {
      headers: { Authorization: `Bearer ${(await api.login(a.crewEmail)).access_token}` },
      multipart: { after_photo: makePhoto() },
    })
    expect(res.status()).toBe(409)
    expect((await res.json()).detail).toBe('Start the work before marking it complete')
  })

  test('TC-032 completing with an after photo finishes the order and asks the resident to confirm @smoke', async ({
    page,
    signIn,
    api,
    freshResident,
  }) => {
    const a = await inProgressIssue(api, { resident: freshResident, type: 'streetlight' })
    await signIn(USERS.crewLights)
    const crew = new CrewPage(page)
    await crew.select(a.address)

    await crew.complete(makePhoto(), 'Replaced the bulb and photocell')

    await expect(crew.order(a.address)).toHaveCount(0)
    await crew.completedTab.click()
    await expect(crew.order(a.address)).toContainText(/Done /)

    const issue = await api.waitForIssue(a.issueId, (i) => i.status === 'completed' && i.work_orders[0].verdict !== null, 'repair was never verified')
    const wo = issue.work_orders[0]
    expect(wo.status).toBe('completed')
    expect(wo.after_photo_id).not.toBeNull()
    // FR-8: the before and after photos were compared by the (mock) vision model.
    expect(wo.verdict).toBe('repaired')
    expect(wo.confirmation_status).toBe('pending')
    await eventually(
      () => api.notifications(freshResident),
      (n) => n.items.some((i) => i.message.startsWith(`The crew says your broken streetlight report at ${a.address} has been repaired.`)),
      { message: 'the resident was not asked to confirm the repair' },
    )
  })

  test('the To do list is empty for a crew with no open orders', async ({ page, signIn, api }) => {
    // General Maintenance only gets work by manual dispatch or reassignment in this suite,
    // so drain anything it holds first.
    for (const o of await api.crewOrders(USERS.crewGeneral)) {
      if (o.status === 'assigned') await api.startWork(USERS.crewGeneral, o.work_order_id)
      await api.completeWork(USERS.crewGeneral, o.work_order_id, makePhoto())
    }
    await signIn(USERS.crewGeneral)
    const crew = new CrewPage(page)
    await expect(crew.emptyToDo).toBeVisible()
    await expect(page.getByText('New jobs appear here the moment they are assigned to your crew.')).toBeVisible()
  })
})
