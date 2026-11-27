import i18n from '../i18n'

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api'

const SESSION_KEY = 'smartfix.session'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let token: string | null = null
let onUnauthorized: (() => void) | null = null

export function setToken(value: string | null) {
  token = value
}
export function getToken() {
  return token
}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

export function loadStoredSession<T>(): T | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
export function storeSession(session: unknown | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage unavailable: session lasts for this tab only */
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '')
  }
  return i18n.t('common.requestFailed', { status })
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  if (res.status === 401 && token) onUnauthorized?.()
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(errorMessage(body, res.status), res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}

export function photoUrl(photoId: string | null | undefined): string | undefined {
  if (!photoId) return undefined
  return `${API_BASE_URL}/photos/${photoId}?token=${encodeURIComponent(token ?? '')}`
}

export function socketUrl(): string {
  const base = API_BASE_URL.startsWith('http')
    ? API_BASE_URL.replace(/^http/, 'ws')
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${API_BASE_URL}`
  return `${base}/ws?token=${encodeURIComponent(token ?? '')}`
}
