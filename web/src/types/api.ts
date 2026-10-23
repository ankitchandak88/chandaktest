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

export interface CitationMetadata {
  author?: string | null
  title?: string | null
  year?: string | null
  publisher?: string | null
  url?: string | null
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
  citation_metadata: CitationMetadata | null
  citation_apa: string | null
  citation_mla: string | null
  ai_summary: string | null
  created_at: string
  updated_at: string
}

export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ProjectShare {
  id: string
  project_id: string
  created_by: number
  token: string
  expires_at: string
  revoked_at: string | null
  last_accessed_at: string | null
  created_at: string
  updated_at: string
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
  source_type: 'excerpt' | 'note' | 'document'
  source_id: string
  target_type: 'excerpt' | 'note' | 'document'
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

// Phase 7: shapes mirror SearchController's response exactly - each result
// type carries only what that result needs to jump to it (document_id +
// page_number for anything document-anchored, nothing extra for a note).
export interface SearchResultDocumentPage {
  type: 'document_page'
  document_id: string
  document_name: string | null
  page_number: number
}

export interface SearchResultExcerpt {
  type: 'excerpt'
  id: string
  document_id: string
  page_number: number
  snippet: string
}

export interface SearchResultNote {
  type: 'note'
  id: string
  title: string | null
  snippet: string
}

export interface SearchResultAnnotation {
  type: 'annotation'
  id: string
  annotation_type: 'highlight' | 'underline' | 'comment' | 'ink'
  document_id: string
  page_number: number
  snippet: string
}

export interface SearchResults {
  document_pages: SearchResultDocumentPage[]
  excerpts: SearchResultExcerpt[]
  notes: SearchResultNote[]
  annotations: SearchResultAnnotation[]
}

export interface ExportJob {
  id: string
  project_id: string
  format: 'pdf' | 'pdf_highlights' | 'docx'
  status: 'queued' | 'processing' | 'ready' | 'failed'
  failure_reason: string | null
  expires_at: string | null
}

export interface Plan {
  id: string
  code: string
  name: string
  limits: { projects: number; storage_mb: number; documents_per_project: number; seats?: number }
  features?: Record<string, string>
  price_inr_paise: number
}

export interface UsageSummary {
  plan: string
  plan_name?: string
  members?: { used: number; limit: number }
  projects: { used: number; limit: number }
  storage_bytes: { used: number; limit: number }
  documents_per_project_limit: number
}

export interface OrganizationMember {
  id: string
  organization_id: string
  user_id: number
  role: string
  user: {
    id: number
    name: string
    email: string
  }
  created_at: string
}

export interface OrganizationDetails {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended'
  subscription?: {
    id: string
    status: string
    plan: Plan
    current_period_end?: string
  }
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
