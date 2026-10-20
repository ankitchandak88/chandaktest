import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  Annotation,
  Document,
  Excerpt,
  ExportJob,
  Link,
  Note,
  Paginated,
  Project,
  UsageSummary,
  WorkspaceItem,
} from '@/types/api'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<Paginated<Project>>('/projects')).data.data,
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
  return useQuery({
    queryKey: ['projects', projectId, 'documents'],
    queryFn: async () =>
      (await api.get<Paginated<Document>>(`/projects/${projectId}/documents`)).data.data,
    enabled: !!projectId,
    // Documents move processing -> ready/failed in the background; poll
    // gently while any are still processing.
    refetchInterval: (query) => {
      const docs = query.state.data as Document[] | undefined
      return docs?.some((d) => d.status === 'processing') ? 2500 : false
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

export function useExcerpts(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'excerpts'],
    queryFn: async () =>
      (await api.get<Paginated<Excerpt>>(`/projects/${projectId}/excerpts`)).data.data,
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
  return useQuery({
    queryKey: ['projects', projectId, 'notes'],
    queryFn: async () => (await api.get<Paginated<Note>>(`/projects/${projectId}/notes`)).data.data,
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
