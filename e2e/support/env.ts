/**
 * One place for every port, URL and demo account the suite uses.
 *
 * The suite runs its own copy of the stack so it never touches your dev data:
 *   backend  -> http://127.0.0.1:8001   (database smartfix_e2e, reset before every run)
 *   frontend -> http://127.0.0.1:5174   (Vite, calling the backend above)
 *   ollama   -> http://127.0.0.1:11435  (scripted mock, see mock-ollama/server.mjs)
 * Override any of them with the E2E_* environment variables below.
 */
const num = (value: string | undefined, fallback: number) => (value ? Number(value) : fallback)

export const BACKEND_PORT = num(process.env.E2E_BACKEND_PORT, 8001)
export const FRONTEND_PORT = num(process.env.E2E_FRONTEND_PORT, 5174)
export const MOCK_OLLAMA_PORT = num(process.env.E2E_MOCK_OLLAMA_PORT, 11435)

export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`
export const API_URL = `${BACKEND_URL}/api`
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`
export const MOCK_OLLAMA_URL = `http://127.0.0.1:${MOCK_OLLAMA_PORT}`

/** Must end in _e2e or _test: scripts/prepare_db.py refuses to wipe anything else. */
export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://localhost:5433/smartfix_e2e'

/** Empty = the backend's in-process bus (same retry/dead-letter rules), so the suite never
 * competes with a running dev backend for the shared RabbitMQ queues. */
export const RABBITMQ_URL = process.env.E2E_RABBITMQ_URL ?? ''

export const DEMO_PASSWORD = 'smartfix123'

export const USERS = {
  resident: 'resident@smartfix.dev',
  resident2: 'resident2@smartfix.dev',
  operator: 'operator@smartfix.dev',
  supervisor: 'supervisor@smartfix.dev',
  crewNorth: 'crew.north@smartfix.dev',
  crewSouth: 'crew.south@smartfix.dev',
  crewLights: 'crew.lights@smartfix.dev',
  crewWater: 'crew.water@smartfix.dev',
  crewGeneral: 'crew.general@smartfix.dev',
} as const

/** Crew name (as seeded by backend/scripts/init_db.py) -> the member who signs in for it. */
export const CREW_MEMBER: Record<string, string> = {
  'Roads Crew North': USERS.crewNorth,
  'Roads Crew South': USERS.crewSouth,
  'Street Lighting': USERS.crewLights,
  'Water Services': USERS.crewWater,
  'General Maintenance': USERS.crewGeneral,
}

export const PROBLEM_TYPES = {
  pothole: 'Pothole',
  streetlight: 'Broken streetlight',
  water_leak: 'Water leak',
  sidewalk_crack: 'Cracked sidewalk',
  other: 'Other infrastructure',
} as const

export type ProblemCode = keyof typeof PROBLEM_TYPES
