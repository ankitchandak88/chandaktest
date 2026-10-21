import { type FormEvent, useRef, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  useCreateExcerpt,
  useCreateLink,
  useCreateNote,
  useCreateTag,
  useDeleteTag,
  useDocuments,
  useExcerpts,
  useExportStatus,
  useLinks,
  useNotes,
  useProject,
  useSaveWorkspaceBatch,
  useStartExport,
  useTags,
  useUploadDocument,
  useWorkspaceItems,
} from '@/lib/queries'
import ShareManager from '@/components/ShareManager'
import { api, apiErrorMessage } from '@/lib/api'
import { Button, Card, EmptyState, Spinner } from '@/components/ui'
import AiDocumentPanel from '@/components/AiDocumentPanel'
import CitationEditor from '@/components/CitationEditor'
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
  const {
    data: documentPages,
    isLoading: loadingDocs,
    fetchNextPage: fetchMoreDocuments,
    hasNextPage: hasMoreDocuments,
    isFetchingNextPage: fetchingMoreDocuments,
  } = useDocuments(projectId)
  const {
    data: excerptPages,
    fetchNextPage: fetchMoreExcerpts,
    hasNextPage: hasMoreExcerpts,
    isFetchingNextPage: fetchingMoreExcerpts,
  } = useExcerpts(projectId)
  const {
    data: notePages,
    fetchNextPage: fetchMoreNotes,
    hasNextPage: hasMoreNotes,
    isFetchingNextPage: fetchingMoreNotes,
  } = useNotes(projectId)
  const { data: workspaceItems } = useWorkspaceItems(projectId)
  const { data: links } = useLinks(projectId)
  const { data: tags } = useTags(projectId)
  const createTag = useCreateTag(projectId)
  const deleteTag = useDeleteTag(projectId)
  const [newTagName, setNewTagName] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)

  // BUG-006: flatten every loaded page, same pattern as DashboardPage.
  const documents = documentPages?.pages.flatMap((page) => page.data)
  const excerpts = excerptPages?.pages.flatMap((page) => page.data)
  const notes = notePages?.pages.flatMap((page) => page.data)

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

  async function handleOpenCard(card: { type: 'excerpt' | 'note'; id: string }) {
    if (linkMode) {
      // A link to itself is a no-op, not an error - just ignore the click
      // rather than letting the API reject it.
      if (linkMode.sourceType === card.type && linkMode.sourceId === card.id) return

      await createLink.mutateAsync({
        source_type: linkMode.sourceType,
        source_id: linkMode.sourceId,
        target_type: card.type,
        target_id: card.id,
      })
      setLinkMode(null)
      return
    }
    setLinkMode({ sourceType: card.type, sourceId: card.id })
  }

  async function handleCreateTag(e: FormEvent) {
    e.preventDefault()
    const name = newTagName.trim()
    if (!name) return
    setTagError(null)

    try {
      await createTag.mutateAsync({ name })
      setNewTagName('')
    } catch (err) {
      setTagError(apiErrorMessage(err, 'Could not create the tag.'))
    }
  }

  const [exportFormat, setExportFormat] = useState<'pdf' | 'pdf_highlights' | 'docx'>('pdf')

  async function handleStartExport() {
    const job = await startExport.mutateAsync(exportFormat)
    setExportId(job.id)
  }

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  /**
   * BUG-001 fix: a plain `<a href=API_URL target="_blank">` cannot carry the
   * app's Authorization/X-Organization-Id headers - a browser navigation is
   * an unauthenticated request as far as this API is concerned, so it would
   * 401. Fetching through the authenticated axios client as a blob and
   * handing the browser an object URL (revoked right after) is the correct
   * way to trigger a download for a bearer-token API.
   */
  async function handleDownloadExport(exportId: string, format: 'pdf' | 'pdf_highlights' | 'docx') {
    setDownloading(true)
    setDownloadError(null)

    let objectUrl: string | null = null

    try {
      const response = await api.get(`/exports/${exportId}/download`, { responseType: 'blob' })
      objectUrl = URL.createObjectURL(response.data)

      const extension = format === 'docx' ? 'docx' : 'pdf'
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `${project?.name ?? 'export'}.${extension}`
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      setDownloadError(apiErrorMessage(err, 'Could not download the export.'))
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setDownloading(false)
    }
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

          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'pdf' | 'pdf_highlights' | 'docx')}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
          >
            <option value="pdf">Compiled notes/excerpts (PDF)</option>
            <option value="pdf_highlights">Highlighted source PDF</option>
            <option value="docx">Compiled notes/excerpts (DOCX)</option>
          </select>
          <Button variant="secondary" onClick={handleStartExport} disabled={startExport.isPending}>
            Export
          </Button>
        </div>
      </div>

      {exportJob && (
        <div className="border-b border-slate-800 bg-slate-900 px-4 py-2 text-sm">
          {exportJob.status === 'ready' ? (
            <button
              className="text-accent hover:underline disabled:opacity-50"
              onClick={() => handleDownloadExport(exportJob.id, exportJob.format)}
              disabled={downloading}
            >
              {downloading ? 'Downloading…' : `Export ready — download ${exportJob.format === 'docx' ? 'DOCX' : 'PDF'}`}
            </button>
          ) : exportJob.status === 'failed' ? (
            <span className="text-red-400">Export failed: {exportJob.failure_reason}</span>
          ) : (
            <span className="text-slate-400">Export {exportJob.status}…</span>
          )}
          {downloadError && <span className="ml-3 text-red-400">{downloadError}</span>}
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
                {doc.status === 'ready' && (
                  <>
                    <CitationEditor projectId={projectId!} document={doc} />
                    <AiDocumentPanel projectId={projectId!} document={doc} />
                  </>
                )}
              </Card>
            ))}
          </div>

          {hasMoreDocuments && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => fetchMoreDocuments()}
                disabled={fetchingMoreDocuments}
              >
                {fetchingMoreDocuments ? 'Loading…' : 'Load more documents'}
              </Button>
            </div>
          )}

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
              tags={tags ?? []}
              onOpenCard={handleOpenCard}
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

            <h2 className="mb-2 text-sm font-medium text-slate-300">Tags</h2>
            <form onSubmit={handleCreateTag} className="mb-2 flex gap-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="New tag…"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500"
              />
              <Button type="submit" variant="secondary" disabled={createTag.isPending}>
                Add
              </Button>
            </form>
            {tagError && <p className="mb-2 text-xs text-red-400">{tagError}</p>}
            <div className="mb-6 flex flex-wrap gap-1.5">
              {(tags ?? []).length === 0 && (
                <p className="text-xs text-slate-500">
                  No tags yet. Create one above, then assign it from any card&apos;s "+ tag" button.
                </p>
              )}
              {tags?.map((tag) => (
                <span
                  key={tag.id}
                  className="flex items-center gap-1 rounded-full bg-slate-800 py-0.5 pl-2 pr-1 text-xs text-slate-200"
                >
                  {tag.name}
                  <button
                    type="button"
                    className="rounded-full px-1 text-slate-500 hover:text-red-400"
                    title="Delete tag"
                    onClick={() => deleteTag.mutate(tag.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <ShareManager projectId={projectId!} />

            {linkMode ? (
              <p className="rounded-md bg-slate-800 p-2 text-xs text-slate-300">
                Double-click another card to link it, or{' '}
                <button className="text-accent underline" onClick={() => setLinkMode(null)}>
                  cancel
                </button>
                .
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Double-click any card on the canvas to start linking it to another.
              </p>
            )}

            {(hasMoreExcerpts || hasMoreNotes) && (
              <div className="mt-6 space-y-2">
                {hasMoreExcerpts && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => fetchMoreExcerpts()}
                    disabled={fetchingMoreExcerpts}
                  >
                    {fetchingMoreExcerpts ? 'Loading…' : 'Load more excerpts'}
                  </Button>
                )}
                {hasMoreNotes && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => fetchMoreNotes()}
                    disabled={fetchingMoreNotes}
                  >
                    {fetchingMoreNotes ? 'Loading…' : 'Load more notes'}
                  </Button>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
