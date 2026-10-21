export interface Project {
  id: string
  organization_id: string
  created_by: number
  name: string
  description: string | null
  created_at: string
  updated_at: string
  documents_count?: number
  notes_count?: number
  excerpts_count?: number
}

export interface Document {
  id: string
  organization_id: string
  project_id: string
  uploaded_by: number
  original_filename: string
  storage_key: string
  checksum: string
  mime_type: string
  size_bytes: number
  page_count: number | null
  status: 'processing' | 'ready' | 'failed'
  failure_reason: string | null
  created_at: string
  updated_at: string
}

export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Tag {
  id: string
  project_id: string
  name: string
  color: string | null
  created_at: string
  updated_at: string
}

export interface Excerpt {
  id: string
  organization_id: string
  project_id: string
  document_id: string
  created_by: number
  page_number: number
  text: string
  source_rects: SourceRect[]
  tags?: Tag[]
  created_at: string
  updated_at: string
}

export interface Note {
  id: string
  project_id: string
  created_by: number
  title: string | null
  content: string | null
  tags?: Tag[]
  created_at: string
  updated_at: string
}

export interface WorkspaceItem {
  id: string
  project_id: string
  item_type: 'excerpt' | 'note'
  target_id: string
  x: number
  y: number
  width: number
  height: number
  z_index: number
}

export interface Link {
  id: string
  project_id: string
  source_type: 'excerpt' | 'note'
  source_id: string
  target_type: 'excerpt' | 'note'
  target_id: string
  label: string | null
}

export interface Annotation {
  id: string
  document_id: string
  project_id: string
  created_by: number
  page_number: number
  type: 'highlight' | 'underline' | 'comment' | 'ink'
  color: string | null
  comment_text: string | null
  payload: Record<string, unknown>
}

export interface ExportJob {
  id: string
  project_id: string
  format: 'pdf' | 'docx'
  status: 'queued' | 'processing' | 'ready' | 'failed'
  failure_reason: string | null
  expires_at: string | null
}

export interface Plan {
  id: string
  code: string
  name: string
  limits: { projects: number; storage_mb: number; documents_per_project: number }
  price_inr_paise: number
}

export interface UsageSummary {
  plan: string
  projects: { used: number; limit: number }
  storage_bytes: { used: number; limit: number }
  documents_per_project_limit: number
}

// BUG-006 follow-up: the paginated endpoints (Project/Document/Excerpt/
// Note controllers) return `response()->json($paginator)` directly, i.e.
// Laravel's native flat LengthAwarePaginator shape - current_page/
// last_page/total sit at the SAME top level as `data`, confirmed against
// a live response (`curl .../api/v1/projects`), not a nested `meta` object
// as an earlier version of this type assumed (that version was never
// exercised against >1 page of real data, so the mismatch shipped
// unnoticed - `npm run build` only type-checks, it doesn't catch a wrong
// runtime shape).
export interface Paginated<T> {
  data: T[]
  current_page: number
  last_page: number
  total: number
}
