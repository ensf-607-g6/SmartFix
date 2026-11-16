export interface ApiErrorBody {
  detail?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export interface InfrastructureIssue {
  id: string
  category: 'pothole' | 'streetlight' | 'water_leak' | 'sidewalk' | 'other'
  description: string
  status:
    | 'reported'
    | 'validated'
    | 'prioritized'
    | 'assigned'
    | 'in_progress'
    | 'completed'
    | 'closed'
    | 'reopened'
    | 'escalated'
  latitude: number
  longitude: number
  createdAt: string
  updatedAt: string
}
