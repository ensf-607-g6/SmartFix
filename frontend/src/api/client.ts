import type { AuthSession } from '../auth/types'
import type { ApiErrorBody } from './types'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  session?: AuthSession | null
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers, session, ...requestOptions } = options
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...requestOptions,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = (await response
      .json()
      .catch(() => null)) as ApiErrorBody | null
    throw new ApiError(
      errorBody?.detail ??
        errorBody?.message ??
        `Request failed with status ${response.status}`,
      response.status,
      errorBody,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, session?: AuthSession | null) =>
    apiRequest<T>(path, { method: 'GET', session }),
  post: <T>(path: string, body: unknown, session?: AuthSession | null) =>
    apiRequest<T>(path, { method: 'POST', body, session }),
  patch: <T>(path: string, body: unknown, session?: AuthSession | null) =>
    apiRequest<T>(path, { method: 'PATCH', body, session }),
  delete: <T>(path: string, session?: AuthSession | null) =>
    apiRequest<T>(path, { method: 'DELETE', session }),
}
