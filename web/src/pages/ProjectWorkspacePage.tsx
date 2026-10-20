import { type FormEvent, useRef, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  useCreateExcerpt,
  useCreateLink,
  useCreateNote,
  useDocuments,
  useExcerpts,
  useExportStatus,
  useLinks,
  useNotes,
  useProject,
  useSaveWorkspaceBatch,
  useStartExport,
  useUploadDocument,
  useWorkspaceItems,
} from '@/lib/queries'
import { apiErrorMessage } from '@/lib/api'
import { Button, Card, EmptyState, Spinner } from '@/components/ui'
import PdfViewer from '@/components/PdfViewer'
import WorkspaceCanvas from '@/components/WorkspaceCanvas'
import type { Document, Excerpt } from '@/types/api'

type Tab = 'documents' | 'workspace'

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [tab, setTab] = useState<Tab>('documents')
  const [activeDocument, setActiveDocument] = useState<Document | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: project } = useProject(projectId)
  const { data: documents, isLoading: loadingDocs } = useDocuments(projectId)
  const { data: excerpts } = useExcerpts(projectId)
  const { data: notes } = useNotes(projectId)
  const { data: workspaceItems } = useWorkspaceItems(projectId)
  const { data: links } = useLinks(projectId)

  const uploadDocument = useUploadDocument(projectId)
  const createExcerpt = useCreateExcerpt(projectId)
  const createNote = useCreateNote(projectId)
  const saveBatch = useSaveWorkspaceBatch(projectId)
  const createLink = useCreateLink(projectId)
  const startExport = useStartExport(projectId)

  const [exportId, setExportId] = useState<string | undefined>()
  const { data: exportJob } = useExportStatus(exportId, true)

  const [linkMode, setLinkMode] = useState<{ sourceType: 'excerpt' | 'note'; sourceId: string } | null>(
    null,
  )

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)

    try {
      await uploadDocument.mutateAsync(file)
    } catch (err) {
      setUploadError(apiErrorMessage(err, 'Upload failed.'))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function nextCanvasPosition() {
    const count = (workspaceItems?.length ?? 0) % 10
    return { x: 40 + count * 24, y: 40 + count * 24 }
  }

  async function handleSaveExcerpt(selection: { pageNumber: number; text: string; rects: Excerpt['source_rects'] }) {
    if (!activeDocument) return

    const excerpt = await createExcerpt.mutateAsync({
      document_id: activeDocument.id,
      page_number: selection.pageNumber,
      text: selection.text,
      source_rects: selection.rects,
    })

    const pos = await nextCanvasPosition()
    await saveBatch.mutateAsync([{ item_type: 'excerpt', target_id: excerpt.id, ...pos }])
  }

  async function handleCreateNote(e: FormEvent) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const content = (form.elements.namedItem('content') as HTMLTextAreaElement).value
    if (!content.trim()) return

    const note = await createNote.mutateAsync({ content })
    const pos = await nextCanvasPosition()
    await saveBatch.mutateAsync([{ item_type: 'note', target_id: note.id, ...pos }])
    form.reset()
  }

  async function handleOpenExcerpt(excerpt: Excerpt) {
    if (linkMode) {
      await createLink.mutateAsync({
        source_type: linkMode.sourceType,
        source_id: linkMode.sourceId,
        target_type: 'excerpt',
        target_id: excerpt.id,
      })
      setLinkMode(null)
      return
    }
    setLinkMode({ sourceType: 'excerpt', sourceId: excerpt.id })
  }

  async function handleStartExport() {
    const job = await startExport.mutateAsync()
    setExportId(job.id)
  }

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <RouterLink to="/" className="text-sm text-slate-400 hover:text-slate-200">
            ← Projects
          </RouterLink>
          <h1 className="font-medium text-slate-100">{project?.name}</h1>
        </div>

        <div className="flex items-center gap-2">
          <nav className="flex rounded-md border border-slate-700 p-0.5 text-sm">
            <button
              className={`rounded px-3 py-1 ${tab === 'documents' ? 'bg-slate-800 text-slate-100' : 'text-slate-400'}`}
              onClick={() => setTab('documents')}
            >
              Documents
            </button>
            <button
              className={`rounded px-3 py-1 ${tab === 'workspace' ? 'bg-slate-800 text-slate-100' : 'text-slate-400'}`}
              onClick={() => setTab('workspace')}
            >
              Workspace
            </button>
          </nav>

          <Button variant="secondary" onClick={handleStartExport} disabled={startExport.isPending}>
            Export
          </Button>
        </div>
      </div>

      {exportJob && (
        <div className="border-b border-slate-800 bg-slate-900 px-4 py-2 text-sm">
          {exportJob.status === 'ready' ? (
            <a
              className="text-accent hover:underline"
              href={`${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8123/api/v1'}/exports/${exportJob.id}/download`}
              target="_blank"
              rel="noreferrer"
            >
              Export ready — download PDF
            </a>
          ) : exportJob.status === 'failed' ? (
            <span className="text-red-400">Export failed: {exportJob.failure_reason}</span>
          ) : (
            <span className="text-slate-400">Export {exportJob.status}…</span>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-4 flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploadDocument.isPending}>
              {uploadDocument.isPending ? 'Uploading…' : 'Upload PDF'}
            </Button>
            {uploadError && <span className="text-sm text-red-400">{uploadError}</span>}
          </div>

          {loadingDocs && <Spinner />}

          {!loadingDocs && documents?.length === 0 && (
            <EmptyState title="No documents yet" description="Upload a PDF to start reading." />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents?.map((doc) => (
              <Card
                key={doc.id}
                className={`cursor-pointer ${activeDocument?.id === doc.id ? 'border-accent' : ''}`}
                onClick={() => doc.status === 'ready' && setActiveDocument(doc)}
              >
                <p className="truncate font-medium text-slate-100">{doc.original_filename}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {doc.status === 'processing' && 'Processing…'}
                  {doc.status === 'ready' &&
                    `${doc.page_count ?? '?'} ${doc.page_count === 1 ? 'page' : 'pages'}`}
                  {doc.status === 'failed' && (
                    <span className="text-red-400">Failed: {doc.failure_reason}</span>
                  )}
                </p>
              </Card>
            ))}
          </div>

          {activeDocument && (
            <div className="mt-4 h-[70vh] overflow-hidden rounded-lg border border-slate-800">
              <PdfViewer documentId={activeDocument.id} onSaveExcerpt={handleSaveExcerpt} />
            </div>
          )}
        </div>
      )}

      {tab === 'workspace' && (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1">
            <WorkspaceCanvas
              projectId={projectId!}
              items={workspaceItems ?? []}
              excerpts={excerpts ?? []}
              notes={notes ?? []}
              links={links ?? []}
              onOpenExcerpt={handleOpenExcerpt}
            />
          </div>
          <aside className="w-72 shrink-0 border-l border-slate-800 p-4">
            <h2 className="mb-2 text-sm font-medium text-slate-300">New note</h2>
            <form onSubmit={handleCreateNote} className="mb-6 space-y-2">
              <textarea
                name="content"
                rows={3}
                placeholder="Write a note…"
                className="w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
              <Button type="submit" className="w-full" disabled={createNote.isPending}>
                Add note
              </Button>
            </form>

            {linkMode && (
              <p className="rounded-md bg-slate-800 p-2 text-xs text-slate-300">
                Double-click another excerpt card to link it, or{' '}
                <button className="text-accent underline" onClick={() => setLinkMode(null)}>
                  cancel
                </button>
                .
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
