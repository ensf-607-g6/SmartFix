import { API_URL, RABBITMQ_URL } from '../../support/env'
import { expect, test } from '../../support/fixtures'

test.describe('Backend health (NFR-3, TC-043)', () => {
  test('TC-043 health reports the database, the event bus and the local model as connected @smoke', async ({ api }) => {
    const health = await api.health()

    expect(health.database).toBe(true)
    // E2E_RABBITMQ_URL set -> the real broker; otherwise the in-process bus with the same semantics.
    expect(health.bus).toBe(RABBITMQ_URL ? 'RabbitMQBus' : 'InMemoryBus')
    expect(health.ai).toEqual({ reachable: true, vision_model: true, fallback_model: true })
    expect(health.dev_tools).toBe(true)
  })

  test('the problem categories are served to the report form', async ({ api }) => {
    const res = await api.request.get(`${API_URL}/problem-types`)
    expect(res.ok()).toBe(true)
    expect((await res.json()).map((t: { code: string }) => t.code)).toEqual([
      'pothole',
      'streetlight',
      'water_leak',
      'sidewalk_crack',
      'other',
    ])
  })

  test('the interactive API docs are served', async ({ api }) => {
    const res = await api.request.get(API_URL.replace(/\/api$/, '/docs'))
    expect(res.ok()).toBe(true)
    expect(await res.text()).toContain('SmartFix API')
  })
})
