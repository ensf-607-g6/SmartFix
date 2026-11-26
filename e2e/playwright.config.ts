import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  API_URL,
  BACKEND_PORT,
  DATABASE_URL,
  FRONTEND_PORT,
  FRONTEND_URL,
  MOCK_OLLAMA_PORT,
  MOCK_OLLAMA_URL,
  RABBITMQ_URL,
} from './support/env'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(here, '../backend')
const frontendDir = path.resolve(here, '../frontend')
const storageDir = path.resolve(here, '.storage')
const python = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'
/** E2E_SERVER_LOGS=1 prints the backend's request log; otherwise only startup errors surface. */
const serverLogs = process.env.E2E_SERVER_LOGS ? 'pipe' : 'ignore'

const backendEnv = {
  DATABASE_URL,
  RABBITMQ_URL,
  OLLAMA_URL: MOCK_OLLAMA_URL,
  VISION_MODEL: 'mock-vision',
  FALLBACK_MODEL: 'mock-fallback',
  OLLAMA_TIMEOUT_S: '10',
  JWT_SECRET: 'e2e-only-secret-not-for-production',
  ENABLE_DEV_TOOLS: 'true',
  SCHEDULER_INTERVAL_S: '5',
  STORAGE_BACKEND: 'local',
  STORAGE_DIR: storageDir,
  CORS_ORIGINS: `${FRONTEND_URL},http://localhost:${FRONTEND_PORT}`,
}

export default defineConfig({
  testDir: './tests',
  // The app is event driven and every test shares one database, review queue and set of
  // crews, so tests run one at a time to keep counts and queues predictable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    // E2E_SLOWMO=500 waits 500 ms between browser actions, so a headed run is easy to follow.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /\.mobile\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      name: 'mock-ollama',
      command: 'node mock-ollama/server.mjs',
      cwd: here,
      url: `${MOCK_OLLAMA_URL}/api/tags`,
      env: { MOCK_OLLAMA_PORT: String(MOCK_OLLAMA_PORT), MOCK_OLLAMA_MODELS: 'mock-vision,mock-fallback' },
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
    {
      name: 'backend',
      // Fresh database first, then the API. Never reused: every run starts from the seed data.
      command: `${python} ../e2e/scripts/prepare_db.py && ${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: backendDir,
      url: `${API_URL}/health`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: serverLogs,
      stderr: serverLogs,
    },
    {
      name: 'frontend',
      command: `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      cwd: frontendDir,
      url: FRONTEND_URL,
      env: { VITE_API_BASE_URL: API_URL },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
