/**
 * Scenario builders: drive the real backend through the REST API (and the real event flow)
 * to put an issue in a given stage, so a UI test can start right where it needs to.
 * Every issue gets a unique address tag the tests use to find it on screen.
 */
import { eventually, type IssueDetail, type NewReport, type SmartFixApi, type WorkOrder } from './api'
import { CREW_MEMBER, USERS, type ProblemCode } from './env'
import { calgaryPoint, type Point } from './geo'
import { makePhoto, type PhotoFile } from './photos'

export function uniqueTag(prefix = 'E2E'): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase()
}

export interface ReportOptions {
  resident?: string
  type?: ProblemCode
  point?: Point
  photo?: PhotoFile
  /** Mock-model directives such as "[ai:severity=5]" go here. */
  description?: string
  address?: string
}

export interface Reported {
  reportId: string
  issueId: string
  address: string
  resident: string
  report: NewReport
}

export interface Assigned extends Reported {
  issue: IssueDetail
  workOrder: WorkOrder
  crewName: string
  crewEmail: string
}

export async function report(api: SmartFixApi, o: ReportOptions = {}): Promise<Reported> {
  const resident = o.resident ?? USERS.resident
  const address = o.address ?? `${uniqueTag()} Test Ave SW`
  const r: NewReport = {
    type: o.type ?? 'pothole',
    point: o.point ?? calgaryPoint(),
    photo: o.photo ?? makePhoto(),
    description: o.description ?? 'Reported by the Playwright suite',
    address,
  }
  const { report_id, issue_id } = await api.submitReport(resident, r)
  return { reportId: report_id, issueId: issue_id, address, resident, report: r }
}

/** Report, let validation + priority + work orders run, and return the assigned work order. */
export async function assignedIssue(api: SmartFixApi, o: ReportOptions = {}): Promise<Assigned> {
  const r = await report(api, o)
  const issue = await api.waitForIssue(
    r.issueId,
    (i) => i.status === 'assigned' && i.work_orders.length > 0,
    `issue ${r.issueId} was never assigned to a crew`,
  )
  const workOrder = issue.work_orders[0]
  return { ...r, issue, workOrder, crewName: workOrder.crew_name, crewEmail: CREW_MEMBER[workOrder.crew_name] }
}

export async function inProgressIssue(api: SmartFixApi, o: ReportOptions = {}): Promise<Assigned> {
  const a = await assignedIssue(api, o)
  await api.startWork(a.crewEmail, a.workOrder.work_order_id)
  const issue = await api.waitForStatus(a.issueId, 'in_progress')
  return { ...a, issue, workOrder: issue.work_orders[0] }
}

export interface Completed extends Assigned {
  confirmationId: string
}

/** Crew finished the repair; the resident's confirmation request is open. */
export async function completedIssue(api: SmartFixApi, o: ReportOptions = {}): Promise<Completed> {
  const a = await inProgressIssue(api, o)
  await api.completeWork(a.crewEmail, a.workOrder.work_order_id, makePhoto(), 'Patched by the e2e suite')
  const mine = await eventually(
    () => api.myReport(a.resident, a.reportId),
    (d) => d.status === 'completed' && !!d.work_orders[0]?.confirmation_id,
    { message: `no confirmation request was opened for issue ${a.issueId}` },
  )
  const issue = await api.issue(a.issueId)
  return { ...a, issue, workOrder: issue.work_orders[0], confirmationId: mine.work_orders[0].confirmation_id! }
}

/** A report the mock model is unsure about, waiting in the operator review queue. */
export async function reportNeedingReview(
  api: SmartFixApi,
  directive: '[ai:low-confidence]' | '[ai:not-infra]' | '[ai:offline]' = '[ai:low-confidence]',
  o: ReportOptions = {},
): Promise<Reported & { reviewId: string }> {
  const r = await report(api, { ...o, description: `${directive} ${o.description ?? 'Needs a human look'}` })
  const item = await api.waitForReview(r.reportId)
  return { ...r, reviewId: item.review_id }
}
