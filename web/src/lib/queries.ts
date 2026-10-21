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
  Paginated,
  Project,
  ProjectShare,
  Tag,
  UsageSummary,
  WorkspaceItem,
} from '@/types/api'

/**
 * BUG-006 fix: the backend has always paginated this endpoint (20 per
 * page); the frontend used to read only `.data.data` with no way to reach
 * a second page, so a user's 21st+ project was simply invisible with no
 * indication more existed. useInfiniteQuery + a "Load more" button (see
 * DashboardPage) is the fix, applied the same way to documents/excerpts/
 * notes below - anywhere the backend paginates.
 */
export function useProjects() {
  return useInfiniteQuery({
    queryKey: ['projects'],
    queryFn: async ({ pageParam }) =>
      (await api.get<Paginated<Project>>('/projects', { params: { page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.current_page < lastPage.last_page ? lastPage.current_page + 1 : undefined,
  })
}

export function useUsage() {
  return useQuery({
    queryKey: ['usage'],
    queryFn: async () => (await api.get<{ data: UsageSummary }>('/usage')).data.data,
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
      return anyProcessing ? 2500 : false
    },
  })
}

export function useUploadDocument(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return (
        await api.post<{ data: Document }>(`/projects/${projectId}/documents`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
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
      source_type: 'excerpt' | 'note'
      source_id: string
      target_type: 'excerpt' | 'note'
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

export function useStartExport(projectId: string | undefined) {
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ data: ExportJob }>(`/projects/${projectId}/exports`)).data.data,
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
