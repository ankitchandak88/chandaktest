import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  Annotation,
  CitationMetadata,
  Document,
  Excerpt,
  ExportJob,
  Link,
  Note,
  OrganizationDetails,
  OrganizationMember,
  Paginated,
  Plan,
  Project,
  ProjectShare,
  SearchResults,
  Tag,
  UsageSummary,
  WorkspaceItem,
} from '@/types/api'

import { useAuthStore } from '@/stores/auth'

/**
 * Multi-tenant query isolation: Scoped strictly by organizationId so that
 * an advocate chamber's cached projects or briefs NEVER bleed across users.
 * Also paginated via useInfiniteQuery.
 */
export function useProjects() {
  const organizationId = useAuthStore((s) => s.organizationId)
  return useInfiniteQuery({
    queryKey: ['projects', organizationId],
    queryFn: async ({ pageParam }) =>
      (await api.get<Paginated<Project>>('/projects', { params: { page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.current_page < lastPage.last_page ? lastPage.current_page + 1 : undefined,
    enabled: Boolean(organizationId),
  })
}

export function useUsage() {
  const organizationId = useAuthStore((s) => s.organizationId)
  return useQuery({
    queryKey: ['usage', organizationId],
    queryFn: async () => (await api.get<{ data: UsageSummary }>('/usage')).data.data,
    enabled: Boolean(organizationId),
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) =>
      (await api.post<{ data: Project }>('/projects', input)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
    },
  })
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId],
    queryFn: async () => (await api.get<{ data: Project }>(`/projects/${projectId}`)).data.data,
    enabled: !!projectId,
  })
}

export function useDocuments(projectId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['projects', projectId, 'documents'],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Paginated<Document>>(`/projects/${projectId}/documents`, {
          params: { page: pageParam },
        })
      ).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.current_page < lastPage.last_page ? lastPage.current_page + 1 : undefined,
    enabled: !!projectId,
    // Documents move processing -> ready/failed in the background; poll
    // gently while any (on the currently-loaded pages) are still processing.
    refetchInterval: (query) => {
      const pages = query.state.data?.pages as Paginated<Document>[] | undefined
      const anyProcessing = pages?.some((p) => p.data.some((d) => d.status === 'processing'))
      return anyProcessing ? 1500 : false
    },
  })
}

export function useUploadDocument(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: File | { file: File; onProgress?: (percent: number) => void },
    ) => {
      const file = payload instanceof File ? payload : payload.file
      const onProgress = payload instanceof File ? undefined : payload.onProgress

      const form = new FormData()
      form.append('file', file)
      return (
        await api.post<{ data: Document }>(`/projects/${projectId}/documents`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
              onProgress(Math.min(99, percent))
            }
          },
        })
      ).data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
    },
  })
}

export function useUpdateDocumentCitation(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ documentId, citation }: { documentId: string; citation: CitationMetadata | null }) =>
      (
        await api.patch<{ data: Document }>(`/documents/${documentId}`, {
          citation_metadata: citation,
        })
      ).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'documents'] }),
  })
}

export function useDeleteDocument(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (documentId: string) =>
      (await api.delete<{ data: { message: string } }>(`/documents/${documentId}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
    },
  })
}

export function useExcerpts(projectId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['projects', projectId, 'excerpts'],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Paginated<Excerpt>>(`/projects/${projectId}/excerpts`, {
          params: { page: pageParam },
        })
      ).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.current_page < lastPage.last_page ? lastPage.current_page + 1 : undefined,
    enabled: !!projectId,
  })
}

export function useCreateExcerpt(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      document_id: string
      page_number: number
      text: string
      source_rects: Excerpt['source_rects']
    }) => (await api.post<{ data: Excerpt }>(`/projects/${projectId}/excerpts`, input)).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'excerpts'] }),
  })
}

export function useNotes(projectId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['projects', projectId, 'notes'],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Paginated<Note>>(`/projects/${projectId}/notes`, { params: { page: pageParam } })
      ).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.current_page < lastPage.last_page ? lastPage.current_page + 1 : undefined,
    enabled: !!projectId,
  })
}

export function useCreateNote(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { title?: string; content?: string }) =>
      (await api.post<{ data: Note }>(`/projects/${projectId}/notes`, input)).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'notes'] }),
  })
}

export function useUpdateNote(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string; title?: string; content?: string }) =>
      (await api.patch<{ data: Note }>(`/notes/${id}`, input)).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'notes'] }),
  })
}

export function useTags(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'tags'],
    queryFn: async () => (await api.get<{ data: Tag[] }>(`/projects/${projectId}/tags`)).data.data,
    enabled: !!projectId,
  })
}

export function useCreateTag(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string; color?: string }) =>
      (await api.post<{ data: Tag }>(`/projects/${projectId}/tags`, input)).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tags'] }),
  })
}

export function useDeleteTag(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tagId: string) => (await api.delete(`/tags/${tagId}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tags'] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'excerpts'] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'notes'] })
    },
  })
}

export function useSyncExcerptTags(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ excerptId, tagIds }: { excerptId: string; tagIds: string[] }) =>
      (await api.put<{ data: Excerpt }>(`/excerpts/${excerptId}/tags`, { tag_ids: tagIds })).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'excerpts'] }),
  })
}

export function useSyncNoteTags(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ noteId, tagIds }: { noteId: string; tagIds: string[] }) =>
      (await api.put<{ data: Note }>(`/notes/${noteId}/tags`, { tag_ids: tagIds })).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'notes'] }),
  })
}

export function useWorkspaceItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'workspace-items'],
    queryFn: async () =>
      (await api.get<{ data: WorkspaceItem[] }>(`/projects/${projectId}/workspace-items`)).data.data,
    enabled: !!projectId,
  })
}

export function useSaveWorkspaceBatch(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      items: Array<{
        id?: string
        item_type?: 'excerpt' | 'note'
        target_id?: string
        x: number
        y: number
        width?: number
        height?: number
      }>,
    ) =>
      (
        await api.post<{ data: WorkspaceItem[] }>(`/projects/${projectId}/workspace-items/batch`, {
          items,
        })
      ).data.data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'workspace-items'] }),
  })
}

export function useLinks(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'links'],
    queryFn: async () => (await api.get<{ data: Link[] }>(`/projects/${projectId}/links`)).data.data,
    enabled: !!projectId,
  })
}

export function useCreateLink(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      source_type: 'excerpt' | 'note' | 'document'
      source_id: string
      target_type: 'excerpt' | 'note' | 'document'
      target_id: string
      label?: string
    }) => (await api.post<{ data: Link }>(`/projects/${projectId}/links`, input)).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'links'] }),
  })
}

export function useAnnotations(documentId: string | undefined) {
  return useQuery({
    queryKey: ['documents', documentId, 'annotations'],
    queryFn: async () =>
      (await api.get<{ data: Annotation[] }>(`/documents/${documentId}/annotations`)).data.data,
    enabled: !!documentId,
  })
}

export function useCreateAnnotation(documentId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      page_number: number
      type: Annotation['type']
      color?: string
      comment_text?: string
      payload: Record<string, unknown>
    }) =>
      (await api.post<{ data: Annotation }>(`/documents/${documentId}/annotations`, input)).data
        .data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['documents', documentId, 'annotations'] }),
  })
}

export function useDeleteAnnotation(documentId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (annotationId: string) => {
      await api.delete(`/annotations/${annotationId}`)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['documents', documentId, 'annotations'] }),
  })
}

// Phase 7: project-wide full-text search (document pages, excerpts, notes,
// and now annotations). A mutation rather than a query - it only runs when
// the user submits, not reactively on every keystroke/projectId change.
export function useSearch() {
  return useMutation({
    mutationFn: async ({ projectId, q }: { projectId: string; q: string }) =>
      (
        await api.get<{ data: SearchResults }>('/search', {
          params: { project_id: projectId, q },
        })
      ).data.data,
  })
}

export function useStartExport(projectId: string | undefined) {
  return useMutation({
    mutationFn: async (format: 'pdf' | 'pdf_highlights' | 'docx' = 'pdf') =>
      (await api.post<{ data: ExportJob }>(`/projects/${projectId}/exports`, { format })).data.data,
  })
}

export function useExportAndPurge(projectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      (
        await api.post<{
          message: string
          certificate: {
            certificate_id: string
            project_id: string
            project_name: string
            purged_by: string
            timestamp: string
            documents_destroyed: Array<{
              id: string
              filename: string
              size_bytes: number
              checksum_sha256: string
            }>
            notes_count: number
            excerpts_count: number
            status: string
            legal_declaration: string
          }
          archive: {
            project_name: string
            excerpts: Excerpt[]
            notes: Note[]
          }
        }>(`/projects/${projectId}/export-and-purge`)
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
      queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] })
    },
  })
}

export function useExportStatus(exportId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['exports', exportId],
    queryFn: async () => (await api.get<{ data: ExportJob }>(`/exports/${exportId}`)).data.data,
    enabled: !!exportId && enabled,
    refetchInterval: (query) => {
      const job = query.state.data as ExportJob | undefined
      return job && job.status !== 'ready' && job.status !== 'failed' ? 1500 : false
    },
  })
}

export function useShares(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'shares'],
    queryFn: async () =>
      (await api.get<{ data: ProjectShare[] }>(`/projects/${projectId}/shares`)).data.data,
    enabled: !!projectId,
  })
}

export function useCreateShare(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { password?: string; expires_in_days?: number }) =>
      (await api.post<{ data: ProjectShare }>(`/projects/${projectId}/shares`, input)).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'shares'] }),
  })
}

export function useRevokeShare(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (shareId: string) => (await api.delete(`/shares/${shareId}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'shares'] }),
  })
}

export function useSummarizeDocument(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ documentId, force }: { documentId: string; force?: boolean }) =>
      (await api.post<{ data: { summary: string } }>(`/documents/${documentId}/summarize`, { force }))
        .data.data.summary,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'documents'] }),
  })
}

export function useChatWithDocument() {
  return useMutation({
    mutationFn: async ({
      documentId,
      message,
      history,
    }: {
      documentId: string
      message: string
      history: { role: 'user' | 'assistant'; content: string }[]
    }) =>
      (await api.post<{ data: { reply: string } }>(`/documents/${documentId}/chat`, { message, history }))
        .data.data.reply,
  })
}

export function useSummarizeHighlights() {
  return useMutation({
    mutationFn: async (documentId: string) =>
      (await api.post<{ data: { summary: string } }>(`/documents/${documentId}/summarize-highlights`))
        .data.data.summary,
  })
}

export function useSuggestHighlights() {
  return useMutation({
    mutationFn: async (documentId: string) =>
      (
        await api.post<{ data: { suggestions: string[] } }>(
          `/documents/${documentId}/suggest-highlights`,
        )
      ).data.data.suggestions,
  })
}

export function useSuggestExcerptTags() {
  return useMutation({
    mutationFn: async (excerptId: string) =>
      (await api.post<{ data: { suggestions: string[] } }>(`/excerpts/${excerptId}/suggest-tags`)).data
        .data.suggestions,
  })
}

export function useSuggestNoteTags() {
  return useMutation({
    mutationFn: async (noteId: string) =>
      (await api.post<{ data: { suggestions: string[] } }>(`/notes/${noteId}/suggest-tags`)).data.data
        .suggestions,
  })
}

export function useOrganizationAnalytics() {
  return useQuery({
    queryKey: ['organizations', 'current', 'analytics'],
    queryFn: async () =>
      (
        await api.get<{
          data: {
            total_projects: number
            total_documents: number
            total_storage_bytes: number
            total_excerpts: number
            total_notes: number
            total_members: number
            recent_activity: Array<{
              id: number
              action: string
              target_type: string
              metadata: Record<string, unknown>
              created_at: string
            }>
          }
        }>('/organizations/current/analytics')
      ).data.data,
  })
}

export function useCurrentOrganization() {
  return useQuery({
    queryKey: ['organizations', 'current'],
    queryFn: async () =>
      (await api.get<{ data: OrganizationDetails; usage?: UsageSummary }>('/organizations/current')).data,
  })
}

export function useOrganizationMembers() {
  return useQuery({
    queryKey: ['organizations', 'current', 'members'],
    queryFn: async () =>
      (
        await api.get<{
          data: OrganizationMember[]
          seats: { used: number; limit: number }
        }>('/organizations/current/members')
      ).data,
  })
}

export function useAddOrganizationMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { email: string; name?: string; role: string }) =>
      (await api.post<{ data: OrganizationMember }>('/organizations/current/members', payload)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', 'current', 'members'] })
      queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
    },
  })
}

export function useRemoveOrganizationMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (membershipId: string) =>
      (await api.delete<{ data: { message: string } }>(`/organizations/members/${membershipId}`)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', 'current', 'members'] })
      queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
    },
  })
}

export function useBillingPlans() {
  return useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: async () => (await api.get<{ data: Plan[] }>('/billing/plans')).data.data,
  })
}

export function useUpgradeSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (planCode: string) =>
      (
        await api.post<{
          data: {
            checkout_url: string
            subscription_id: string
          }
        }>('/billing/checkout', { plan_code: planCode })
      ).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
    },
  })
}

