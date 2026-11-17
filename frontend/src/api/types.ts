export type UserRole = 'resident' | 'crew' | 'operator' | 'supervisor'

export interface AuthUser {
  user_id: string
  email: string
  full_name: string
  role: UserRole
  crew_id: number | null
  crew_name: string | null
}

export interface AuthSession {
  access_token: string
  user: AuthUser
}

export type IssueStatus =
  | 'reported'
  | 'validated'
  | 'prioritized'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'reopened'
  | 'escalated'
  | 'rejected'
  | 'merged'

export type ReportStatus =
  'submitted' | 'validated' | 'duplicate' | 'needs_review' | 'rejected'

export interface ProblemType {
  problem_type_id: number
  code: string
  display_name: string
}

export interface MyReport {
  report_id: string
  issue_id: string
  report_status: ReportStatus
  description: string | null
  submitted_at: string
  photo_id: string
  lat: number
  lng: number
  problem_type: string
  problem_type_name: string
  issue_status: IssueStatus
  severity: number | null
  duplicate_count: number
  address_text: string | null
  is_escalated: boolean
  updated_at: string
  confirmation_id: string | null
  confirmation_status: string | null
  auto_close_at: string | null
}

export interface IssueReport {
  report_id: string
  reporter_id: string
  reporter_name: string
  status: ReportStatus
  description: string | null
  submitted_at: string
  photo_id: string
  chosen_type: string
  lat: number
  lng: number
  ai_severity: number | null
  ai_confidence: string | null
  ai_is_infrastructure: boolean | null
  ai_model: string | null
  ai_latency_ms: number | null
  ai_detected_type: string | null
  ai_summary: string | null
}

export interface IssueWorkOrder {
  work_order_id: string
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled'
  crew_id: number
  crew_name: string
  deadline_at: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  escalated_at: string | null
  after_photo_id: string | null
  crew_notes: string | null
  verdict: 'repaired' | 'not_repaired' | 'unclear' | null
  verdict_confidence: string | null
  verdict_model: string | null
  confirmation_id: string | null
  confirmation_status: string | null
  auto_close_at: string | null
  responded_at: string | null
  dispute_reason: string | null
}

export interface IssueDetail {
  issue_id: string
  status: IssueStatus
  severity: number | null
  duplicate_count: number
  priority_base: string
  priority_score: string | null
  is_escalated: boolean
  reopen_count: number
  address_text: string | null
  created_at: string
  closed_at: string | null
  updated_at: string
  problem_type: string
  problem_type_name: string
  area_name: string | null
  lat: number
  lng: number
  reports: IssueReport[]
  work_orders: IssueWorkOrder[]
  status_history: {
    from_status: IssueStatus | null
    to_status: IssueStatus
    module: string
    changed_at: string
  }[]
  priority_history: {
    severity_part: string
    duplicate_part: string
    total_base: string
    reason: string
    calculated_at: string
  }[]
  report_status?: ReportStatus
}

export interface MapIssue {
  issue_id: string
  problem_type: string
  problem_type_name: string
  status: IssueStatus
  severity: number | null
  priority_score: string
  lat: number
  lng: number
  work_order_id: string | null
  crew_id: number | null
  crew_name: string | null
  deadline_at: string | null
  address_text: string | null
  duplicate_count: number
  is_escalated: boolean
  created_at: string
  reopen_count: number
}

export interface Summary {
  by_status: Record<string, number>
  open: number
  pending_reviews: number
  escalated: number
  awaiting_crew: number
  dead_letters: number
  validation_latency: {
    runs: number
    avg_ms: string | null
    p95_ms: number | null
    pct_under_15s: string | null
  }
}

export interface ReviewItem {
  review_id: string
  reason: 'low_confidence' | 'not_infrastructure'
  created_at: string
  report_id: string
  issue_id: string
  photo_id: string
  description: string | null
  reporter_name: string
  chosen_type: string
  chosen_type_name: string
  address_text: string | null
  lat: number
  lng: number
  ai_severity: number | null
  ai_confidence: string | null
  ai_is_infrastructure: boolean | null
  ai_model: string | null
  ai_type: string | null
  ai_type_name: string | null
  ai_summary: string | null
}

export interface TimelineRow {
  issue_id: string
  at: string
  kind: 'event' | 'status_change'
  label: string
  source: string
  detail: Record<string, unknown> | null
}

export interface Crew {
  crew_id: number
  name: string
  max_active_orders: number
  is_active: boolean
  supervisor_name: string | null
  active_orders: number
  specialties: string[]
  areas: string[]
}

export interface WorkOrder {
  work_order_id: string
  issue_id: string
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled'
  deadline_at: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  escalated_at: string | null
  after_photo_id: string | null
  crew_notes: string | null
  crew_id: number
  crew_name: string
  issue_status: IssueStatus
  severity: number | null
  is_escalated: boolean
  address_text: string | null
  duplicate_count: number
  problem_type: string
  problem_type_name: string
  lat: number
  lng: number
  before_photo_id: string | null
  description: string | null
}

export interface Notification {
  notification_id: string
  issue_id: string | null
  message: string
  created_at: string
  read_at: string | null
  event_name: string | null
}

export interface Stats {
  repair_stats: {
    problem_type: string
    display_name: string
    repairs: number
    avg_repair_hours: string
    pct_met_deadline: string
  }[]
  hotspots: {
    area_id: number
    name: string
    issues_30d: number
    repeat_reports_30d: number
    still_open: number
  }[]
  by_type: {
    code: string
    display_name: string
    open: number
    closed: number
  }[]
  verdicts: Record<string, number>
  confirmations: Record<string, number>
  events_24h: { event_name: string; n: number }[]
}

export interface ServiceArea {
  area_id: number
  name: string
  geometry: GeoJSON.MultiPolygon
  issues_30d: number
  repeat_reports_30d: number
  still_open: number
}

export interface DeadLetter {
  dead_letter_id: number
  event_id: string | null
  event_name: string | null
  consumer: string
  attempts: number
  error_message: string
  failed_at: string
  resolved_at: string | null
}

export interface Health {
  database: boolean
  bus: string
  ai: { reachable: boolean; vision_model: boolean; fallback_model: boolean }
  vision_model: string
  dev_tools: boolean
}
