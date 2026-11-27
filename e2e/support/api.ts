import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { API_URL, DEMO_PASSWORD, MOCK_OLLAMA_URL, type ProblemCode } from './env'
import type { Point } from './geo'
import type { PhotoFile } from './photos'

// ---------------------------------------------------------------- response shapes (subset of frontend/src/api/types.ts)
export interface SessionUser {
  user_id: string
  email: string
  full_name: string
  role: 'resident' | 'crew' | 'operator' | 'supervisor'
  crew_id: number | null
  crew_name: string | null
}
export interface Session {
  access_token: string
  user: SessionUser
}
export interface WorkOrder {
  work_order_id: string
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled'
  crew_id: number
  crew_name: string
  deadline_at: string
  started_at: string | null
  completed_at: string | null
  escalated_at: string | null
  after_photo_id: string | null
  verdict: string | null
  confirmation_id: string | null
  confirmation_status: string | null
  auto_close_at: string | null
  dispute_reason: string | null
}
export interface IssueDetail {
  issue_id: string
  status: string
  severity: number | null
  duplicate_count: number
  priority_score: string | null
  is_escalated: boolean
  reopen_count: number
  address_text: string | null
  problem_type: string
  problem_type_name: string
  area_name: string | null
  reports: { report_id: string; reporter_name: string; status: string; ai_model: string | null }[]
  work_orders: WorkOrder[]
  status_history: { from_status: string | null; to_status: string; module: string }[]
  priority_history: { reason: string; total_base: string }[]
  report_status?: string
}
export interface ReviewItem {
  review_id: string
  report_id: string
  issue_id: string
  reason: 'low_confidence' | 'not_infrastructure'
  ai_model: string | null
  address_text: string | null
}
export interface Notification {
  notification_id: string
  issue_id: string | null
  message: string
  read_at: string | null
  event_name: string | null
}
export interface CrewRow {
  crew_id: number
  name: string
  is_active: boolean
  active_orders: number
  max_active_orders: number
  specialties: string[]
}
export interface TimelineRow {
  kind: 'event' | 'status_change'
  label: string
  source: string
}

export interface NewReport {
  type: ProblemCode
  point: Point
  photo: PhotoFile
  description?: string
  address?: string
}

/** Poll `read` until `done` accepts its value, then return that value. */
export async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeout = 20_000, message = 'condition was not met in time' }: { timeout?: number; message?: string } = {},
): Promise<T> {
  let last: T | undefined
  await expect
    .poll(
      async () => {
        last = await read()
        return done(last)
      },
      { timeout, message, intervals: [250, 500, 1000] },
    )
    .toBe(true)
  return last as T
}

/**
 * Thin client for the SmartFix REST API, used to set up state quickly so each UI test
 * only drives the part of the flow it is about. Sessions are cached per email.
 */
export class SmartFixApi {
  private sessions = new Map<string, Session>()

  constructor(readonly request: APIRequestContext) {}

  // ------------------------------------------------------------ auth
  async login(email: string, password = DEMO_PASSWORD): Promise<Session> {
    const cached = this.sessions.get(email.toLowerCase())
    if (cached && password === DEMO_PASSWORD) return cached
    const res = await this.request.post(`${API_URL}/auth/login`, { data: { email, password } })
    await this.ok(res, `login ${email}`)
    const session = (await res.json()) as Session
    this.sessions.set(email.toLowerCase(), session)
    return session
  }

  async register(fullName: string, email: string, password: string): Promise<Session> {
    const res = await this.request.post(`${API_URL}/auth/register`, { data: { full_name: fullName, email, password } })
    await this.ok(res, `register ${email}`)
    const session = (await res.json()) as Session
    this.sessions.set(email.toLowerCase(), session)
    return session
  }

  /** Raw call for negative tests. `as` = email to sign in as, or null for no token. */
  async raw(method: 'GET' | 'POST' | 'PATCH', path: string, as: string | null, data?: unknown): Promise<APIResponse> {
    const headers: Record<string, string> = {}
    if (as) headers.Authorization = `Bearer ${(await this.login(as)).access_token}`
    return this.request.fetch(`${API_URL}${path}`, { method, headers, data })
  }

  // ------------------------------------------------------------ helpers
  private async ok(res: APIResponse, what: string) {
    if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`)
  }

  private async get<T>(path: string, as: string): Promise<T> {
    const res = await this.raw('GET', path, as)
    await this.ok(res, `GET ${path}`)
    return (await res.json()) as T
  }

  private async post<T>(path: string, as: string, data?: unknown): Promise<T> {
    const res = await this.raw('POST', path, as, data)
    await this.ok(res, `POST ${path}`)
    return res.status() === 204 ? (undefined as T) : ((await res.json()) as T)
  }

  private async auth(as: string) {
    return { Authorization: `Bearer ${(await this.login(as)).access_token}` }
  }

  // ------------------------------------------------------------ resident
  async submitReport(as: string, r: NewReport): Promise<{ report_id: string; issue_id: string }> {
    const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
      photo: r.photo,
      lat: String(r.point.lat),
      lng: String(r.point.lng),
      problem_type: r.type,
    }
    if (r.description) multipart.description = r.description
    if (r.address) multipart.address = r.address
    const res = await this.request.post(`${API_URL}/reports`, { headers: await this.auth(as), multipart })
    await this.ok(res, 'submit report')
    return res.json()
  }

  myReports(as: string) {
    return this.get<{ report_id: string; issue_id: string; report_status: string; issue_status: string }[]>('/reports/mine', as)
  }

  myReport(as: string, reportId: string) {
    return this.get<IssueDetail & { report_id: string }>(`/reports/${reportId}`, as)
  }

  answerConfirmation(as: string, confirmationId: string, action: 'confirm' | 'dispute', reason?: string) {
    return this.post<{ status: string }>(`/confirmations/${confirmationId}`, as, { action, reason })
  }

  // ------------------------------------------------------------ staff
  issue(issueId: string, as = 'operator@smartfix.dev') {
    return this.get<IssueDetail>(`/issues/${issueId}`, as)
  }

  timeline(issueId: string, as = 'operator@smartfix.dev') {
    return this.get<TimelineRow[]>(`/issues/${issueId}/timeline`, as)
  }

  reviewQueue(as = 'operator@smartfix.dev') {
    return this.get<ReviewItem[]>('/review', as)
  }

  decideReview(reviewId: string, approve: boolean, extra: { notes?: string; severity?: number; problem_type?: string } = {}, as = 'operator@smartfix.dev') {
    return this.post(`/review/${reviewId}`, as, { approve, ...extra })
  }

  crews(as = 'operator@smartfix.dev') {
    return this.get<CrewRow[]>('/crews', as)
  }

  summary(as = 'operator@smartfix.dev') {
    return this.get<{ open: number; pending_reviews: number; escalated: number; awaiting_crew: number }>('/dashboard/summary', as)
  }

  stats(as = 'operator@smartfix.dev') {
    return this.get<{
      repair_stats: { problem_type: string; repairs: number; avg_repair_hours: string }[]
      hotspots: { name: string; issues_30d: number; repeat_reports_30d: number; still_open: number }[]
    }>('/stats', as)
  }

  reassign(workOrderId: string, crewId: number, reason?: string, as = 'operator@smartfix.dev') {
    return this.post<IssueDetail>(`/work-orders/${workOrderId}/reassign`, as, { crew_id: crewId, reason })
  }

  expireDeadline(workOrderId: string, as = 'operator@smartfix.dev') {
    return this.post(`/dev/work-orders/${workOrderId}/expire-deadline`, as)
  }

  expireConfirmation(confirmationId: string, as = 'operator@smartfix.dev') {
    return this.post(`/dev/confirmations/${confirmationId}/expire`, as)
  }

  health() {
    return this.request.get(`${API_URL}/health`).then((r) => r.json())
  }

  // ------------------------------------------------------------ crew
  crewOrders(as: string, scope: 'active' | 'done' = 'active') {
    return this.get<(WorkOrder & { issue_id: string; address_text: string | null })[]>(`/crew/work-orders?scope=${scope}`, as)
  }

  async startWork(as: string, workOrderId: string) {
    const res = await this.request.patch(`${API_URL}/crew/work-orders/${workOrderId}`, {
      headers: await this.auth(as),
      data: { status: 'in_progress' },
    })
    await this.ok(res, 'start work')
  }

  async completeWork(as: string, workOrderId: string, photo: PhotoFile, notes?: string) {
    const multipart: Record<string, string | PhotoFile> = { after_photo: photo }
    if (notes) multipart.notes = notes
    const res = await this.request.post(`${API_URL}/crew/work-orders/${workOrderId}/complete`, {
      headers: await this.auth(as),
      multipart,
    })
    await this.ok(res, 'complete work')
  }

  // ------------------------------------------------------------ everyone
  notifications(as: string) {
    return this.get<{ items: Notification[]; unread: number }>('/notifications', as)
  }

  readAllNotifications(as: string) {
    return this.post<void>('/notifications/read-all', as)
  }

  // ------------------------------------------------------------ waiting on the event flow
  waitForIssue(issueId: string, done: (i: IssueDetail) => boolean, message: string, timeout?: number) {
    return eventually(() => this.issue(issueId), done, { message, timeout })
  }

  waitForStatus(issueId: string, status: string, timeout?: number) {
    return this.waitForIssue(issueId, (i) => i.status === status, `issue ${issueId} never reached "${status}"`, timeout)
  }

  /** The review item the validation module created for `reportId`. */
  waitForReview(reportId: string): Promise<ReviewItem> {
    return eventually(
      () => this.reviewQueue(),
      (items) => items.some((i) => i.report_id === reportId),
      { message: `report ${reportId} never reached the review queue` },
    ).then((items) => items.find((i) => i.report_id === reportId)!)
  }

  // ------------------------------------------------------------ mock model
  async modelCalls(): Promise<{ kind: string; model: string; images: number }[]> {
    return (await this.request.get(`${MOCK_OLLAMA_URL}/__mock/calls`)).json()
  }
}
