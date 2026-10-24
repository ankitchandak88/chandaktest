import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  useCreateExcerpt,
  useCreateLink,
  useCreateNote,
  useCreateTag,
  useDeleteDocument,
  useDeleteTag,
  useDocuments,
  useExcerpts,
  useExportStatus,
  useLinks,
  useNotes,
  useOrganizationAnalytics,
  useProject,
  useSaveWorkspaceBatch,
  useSearch,
  useStartExport,
  useTags,
  useUploadDocument,
  useWorkspaceItems,
} from '@/lib/queries'
import ShareManager from '@/components/ShareManager'
import { api, apiErrorMessage } from '@/lib/api'
import { Button, EmptyState, Spinner } from '@/components/ui'
import AiDocumentPanel from '@/components/AiDocumentPanel'
import CitationEditor from '@/components/CitationEditor'
import PdfViewer from '@/components/PdfViewer'
import WorkspaceCanvas from '@/components/WorkspaceCanvas'
import CaseChronologyModal from '@/components/CaseChronologyModal'
import ChambersManagerModal from '@/components/ChambersManagerModal'
import SubscriptionPlansModal from '@/components/SubscriptionPlansModal'
import ZeroRetentionShredModal from '@/components/ZeroRetentionShredModal'
import type { Document, Excerpt, SearchResults } from '@/types/api'

interface UploadItem {
  id: string
  name: string
  size: number
  percent: number
  status: 'uploading' | 'processing' | 'done' | 'error'
  error?: string
}

type Tab = 'documents' | 'workspace' | 'search'
type LayoutMode = 'split' | 'doc' | 'workspace'

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [tab, setTab] = useState<Tab>('documents')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split')
  const [splitPercent, setSplitPercent] = useState<number>(55)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [showCanvasSidebar, setShowCanvasSidebar] = useState<boolean>(true)
  const [secondaryDocument, setSecondaryDocument] = useState<Document | null>(null)
  const [showCompareMenu, setShowCompareMenu] = useState<boolean>(false)
  const [showDocLinkMenu, setShowDocLinkMenu] = useState<boolean>(false)
  const [activeDocument, setActiveDocument] = useState<Document | null>(null)
  const [focusPage, setFocusPage] = useState<number | undefined>(undefined)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showAnalyticsModal, setShowAnalyticsModal] = useState<boolean>(false)
  const [showCitationModal, setShowCitationModal] = useState<boolean>(false)
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false)
  const [showChronologyModal, setShowChronologyModal] = useState<boolean>(false)
  const [showChambersModal, setShowChambersModal] = useState<boolean>(false)
  const [showPlansModal, setShowPlansModal] = useState<boolean>(false)
  const [showShredModal, setShowShredModal] = useState<boolean>(false)
  const [documentToDelete, setDocumentToDelete] = useState<{ id: string; name: string } | null>(null)
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  )
  const [simulatedJammer, setSimulatedJammer] = useState<boolean>(false)
  const [vaultCachedAt, setVaultCachedAt] = useState<string | null>(() => {
    return projectId ? localStorage.getItem(`chandaktext:vault:${projectId}:time`) : null
  })
  const [vaultMessage, setVaultMessage] = useState<string | null>(null)
  const [hearingMode, setHearingMode] = useState<boolean>(false)
  const [hearingDaisTab, setHearingDaisTab] = useState<'chronology' | 'issues' | 'exhibits' | 'contradictions' | 'notes'>('chronology')
  const [copiedCitation, setCopiedCitation] = useState<string | null>(null)
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isDraggingDivider = useRef(false)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const [tetherCoords, setTetherCoords] = useState<{
    x1: number
    y1: number
    x2: number
    y2: number
  } | null>(null)

  const { data: orgAnalytics } = useOrganizationAnalytics()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setShowShortcutsModal((m) => !m)
      } else if (e.key === 's' || e.key === 'S') {
        if (!e.ctrlKey && !e.metaKey) {
          setLayoutMode((m) => (m === 'split' ? 'doc' : m === 'doc' ? 'workspace' : 'split'))
        }
      } else if (e.key === 'h' || e.key === 'H') {
        if (!e.ctrlKey && !e.metaKey) {
          setHearingMode((m) => !m)
        }
      } else if (e.key === 'c' || e.key === 'C') {
        if (!e.ctrlKey && !e.metaKey) {
          setShowChronologyModal((m) => !m)
        }
      } else if (e.key === 'Escape') {
        setShowAnalyticsModal(false)
        setShowCitationModal(false)
        setShowShortcutsModal(false)
        setShowChronologyModal(false)
        setShowChambersModal(false)
        setShowPlansModal(false)
        setShowShredModal(false)
        setHearingMode(false)
        setShowCompareMenu(false)
        setShowDocLinkMenu(false)
        setActiveCardId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    function handleOnline() {
      setIsOffline(false)
      setVaultMessage('🟢 Online Connection Restored · Syncing Chambers Brief')
      setTimeout(() => setVaultMessage(null), 4000)
    }
    function handleOffline() {
      setIsOffline(true)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const { data: project, isError: projectError } = useProject(projectId)
  const {
    data: documentPages,
    isLoading: loadingDocs,
    isError: docsError,
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

  const handleToggleVault = useCallback(() => {
    if (!projectId) return
    try {
      const vaultData = {
        projectId,
        projectName: project?.name,
        documents: documents ?? [],
        excerpts: excerpts ?? [],
        notes: notes ?? [],
        tags: tags ?? [],
        cachedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
      }
      localStorage.setItem(`chandaktext:vault:${projectId}`, JSON.stringify(vaultData))
      localStorage.setItem(`chandaktext:vault:${projectId}:time`, vaultData.cachedAt)
      setVaultCachedAt(vaultData.cachedAt)
      setVaultMessage(
        `✅ Matter cached in Courtroom Offline Vault (${(documents ?? []).length} briefs, ${(excerpts ?? []).length} citations)`
      )
      setTimeout(() => setVaultMessage(null), 4000)
    } catch {
      setVaultMessage('⚠️ Local cache full or storage restricted.')
      setTimeout(() => setVaultMessage(null), 4000)
    }
  }, [projectId, project?.name, documents, excerpts, notes, tags])

  const uploadDocument = useUploadDocument(projectId)
  const deleteDocument = useDeleteDocument(projectId)

  function handleDeleteDocument(docId: string, filename: string) {
    setDocumentToDelete({ id: docId, name: filename })
  }

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

  // Advocate Senior Accessibility: Theme (Court Paper Light vs Dark) & Font Scaler (Normal, Large, Jumbo)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('chandaktext:theme') as 'light' | 'dark') || 'light'
    } catch {
      return 'light'
    }
  })

  const [fontSizeScale, setFontSizeScale] = useState<'normal' | 'large' | 'jumbo'>(() => {
    try {
      return (localStorage.getItem('chandaktext:fontSize') as 'normal' | 'large' | 'jumbo') || 'large'
    } catch {
      return 'large'
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('chandaktext:theme', theme)
    } catch {}
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', fontSizeScale)
    try {
      localStorage.setItem('chandaktext:fontSize', fontSizeScale)
    } catch {}
  }, [fontSizeScale])

  const [docSearch, setDocSearch] = useState('')
  const [docCategory, setDocCategory] = useState<'all' | 'pleadings' | 'evidence' | 'orders'>('all')

  const filteredDocuments = useMemo(() => {
    if (!documents) return []
    return documents.filter((doc) => {
      const name = doc.original_filename.toLowerCase()
      const matchesSearch = !docSearch.trim() || name.includes(docSearch.toLowerCase().trim())
      if (!matchesSearch) return false

      if (docCategory === 'pleadings') {
        return (
          name.includes('petition') ||
          name.includes('pleading') ||
          name.includes('appeal') ||
          name.includes('suit') ||
          name.includes('plaint') ||
          name.includes('application')
        )
      }
      if (docCategory === 'evidence') {
        return (
          name.includes('exhibit') ||
          name.includes('evidence') ||
          name.includes('annexure') ||
          name.includes('witness') ||
          name.includes('affidavit')
        )
      }
      if (docCategory === 'orders') {
        return name.includes('order') || name.includes('judgment') || name.includes('decree')
      }
      return true
    })
  }, [documents, docSearch, docCategory])

  const totalPagesCount = useMemo(() => {
    return documents?.reduce((acc, d) => acc + (d.page_count ?? 0), 0) ?? 0
  }, [documents])

  function formatFileSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function processFiles(files: FileList | File[]) {
    const fileArray = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    )
    if (fileArray.length === 0) {
      alert('Please select valid PDF documents.')
      return
    }

    setUploadError(null)

    const newItems: UploadItem[] = fileArray.map((file) => ({
      id: Math.random().toString(36).slice(2),
      name: file.name,
      size: file.size,
      percent: 0,
      status: 'uploading',
    }))

    setUploadQueue((prev) => [...newItems, ...prev])

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      const item = newItems[i]

      try {
        await uploadDocument.mutateAsync({
          file,
          onProgress: (percent) => {
            setUploadQueue((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, percent } : it)),
            )
          },
        })

        // Once uploaded, mark as fast background processing
        setUploadQueue((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, percent: 100, status: 'processing' } : it)),
        )

        setTimeout(() => {
          setUploadQueue((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it)),
          )
          setTimeout(() => {
            setUploadQueue((prev) => prev.filter((it) => it.id !== item.id))
          }, 3500)
        }, 1200)
      } catch (err) {
        const errorMsg = apiErrorMessage(err, 'Upload failed.')
        setUploadQueue((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'error', error: errorMsg } : it)),
        )
      }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!isDraggingOver) setIsDraggingOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files)
    }
  }

  async function nextCanvasPosition() {
    const count = (workspaceItems?.length ?? 0) % 10
    return { x: 40 + count * 24, y: 40 + count * 24 }
  }

  async function handleSaveExcerpt(selection: { pageNumber: number; text: string; rects: Excerpt['source_rects'] }) {
    if (!activeDocument) return
    await handleSaveExcerptFor(activeDocument.id, selection)
  }

  async function handleSaveExcerptFor(
    docId: string,
    selection: { pageNumber: number; text: string; rects: Excerpt['source_rects']; tag?: string },
    customPos?: { x: number; y: number },
  ) {
    const excerpt = await createExcerpt.mutateAsync({
      document_id: docId,
      page_number: selection.pageNumber,
      text: selection.text,
      source_rects: selection.rects,
    })

    if (selection.tag) {
      const existingTag = tags?.find((t) => t.name.toLowerCase() === selection.tag!.toLowerCase())
      let tagId = existingTag?.id
      if (!tagId) {
        try {
          const created = await createTag.mutateAsync({ name: selection.tag })
          tagId = created.id
        } catch {
          // Ignore tag collision
        }
      }
      if (tagId) {
        try {
          await api.put(`/excerpts/${excerpt.id}/tags`, { tag_ids: [tagId] })
        } catch {
          // Tag sync fallback
        }
      }
    }

    const pos = customPos ?? (await nextCanvasPosition())
    await saveBatch.mutateAsync([{ item_type: 'excerpt', target_id: excerpt.id, ...pos }])
  }

  function handleDropExcerpt(
    data: { documentId?: string; pageNumber: number; text: string; rects: Excerpt['source_rects'] },
    pos: { x: number; y: number },
  ) {
    const docId = data.documentId || activeDocument?.id
    if (!docId) return
    handleSaveExcerptFor(docId, data, pos)
  }

  const linkedDocIds = useMemo(() => {
    if (!activeDocument || !links) return []
    const ids: string[] = []
    for (const l of links) {
      if (l.source_type === 'document' && l.source_id === activeDocument.id && l.target_type === 'document') {
        ids.push(l.target_id)
      } else if (l.target_type === 'document' && l.target_id === activeDocument.id && l.source_type === 'document') {
        ids.push(l.source_id)
      }
    }
    return ids
  }, [activeDocument, links])

  const linkedDocuments = useMemo(() => {
    if (!documents) return []
    return documents.filter((d) => linkedDocIds.includes(d.id))
  }, [documents, linkedDocIds])

  async function handleLinkDocument(targetDocId: string) {
    if (!activeDocument) return
    await createLink.mutateAsync({
      source_type: 'document',
      source_id: activeDocument.id,
      target_type: 'document',
      target_id: targetDocId,
    })
    setShowDocLinkMenu(false)
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

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingDivider.current = true

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingDivider.current) return
      const totalWidth = window.innerWidth
      const newPercent = (moveEvent.clientX / totalWidth) * 100
      if (newPercent >= 25 && newPercent <= 75) {
        setSplitPercent(Math.round(newPercent))
      }
    }

    const handleMouseUp = () => {
      isDraggingDivider.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  // LiquidText Dynamic Elastic Spring-Line Tether: recalculate live anchor points
  const updateTether = useCallback(() => {
    if (layoutMode !== 'split' || !activeCardId || !splitContainerRef.current) {
      setTetherCoords(null)
      return
    }

    const containerEl = splitContainerRef.current
    const containerRect = containerEl.getBoundingClientRect()
    const cardEl = containerEl.querySelector(`[data-card-id="${activeCardId}"]`)

    const activeItem = workspaceItems?.find((it) => it.id === activeCardId)
    const activeExcerpt =
      activeItem?.item_type === 'excerpt'
        ? excerpts?.find((x) => x.id === activeItem.target_id)
        : null

    const pageEl = activeExcerpt
      ? containerEl.querySelector(`[data-page-number="${activeExcerpt.page_number}"]`)
      : null

    if (cardEl) {
      const cardRect = cardEl.getBoundingClientRect()
      const x2 = cardRect.left - containerRect.left
      const y2 = cardRect.top - containerRect.top + cardRect.height / 2

      let x1 = (splitPercent / 100) * containerRect.width - 8
      let y1 = y2

      if (pageEl) {
        const pageRect = pageEl.getBoundingClientRect()
        x1 = Math.min(pageRect.right - containerRect.left, (splitPercent / 100) * containerRect.width - 8)
        y1 = Math.max(20, Math.min(containerRect.height - 20, pageRect.top - containerRect.top + 80))
      }

      setTetherCoords({ x1, y1, x2, y2 })
    } else {
      setTetherCoords(null)
    }
  }, [activeCardId, layoutMode, splitPercent, workspaceItems, excerpts])

  useEffect(() => {
    updateTether()
    const handleScroll = () => requestAnimationFrame(updateTether)
    window.addEventListener('resize', handleScroll)
    const el = splitContainerRef.current
    el?.addEventListener('scroll', handleScroll, { capture: true })

    return () => {
      window.removeEventListener('resize', handleScroll)
      el?.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [updateTether])

  function handleNavigateToSource(excerpt: Excerpt) {
    if (activeDocument?.id !== excerpt.document_id) {
      const doc = documents?.find((d) => d.id === excerpt.document_id)
      if (doc) setActiveDocument(doc)
    }
    setFocusPage(excerpt.page_number)
    const item = workspaceItems?.find((it) => it.item_type === 'excerpt' && it.target_id === excerpt.id)
    if (item) setActiveCardId(item.id)
    if (layoutMode === 'workspace') setLayoutMode('split')

    // LiquidText tactile pulse: smoothly scroll to the page and apply pulse halo
    setTimeout(() => {
      const pageEl = splitContainerRef.current?.querySelector(`[data-page-number="${excerpt.page_number}"]`)
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        pageEl.classList.add('ring-4', 'ring-cyan-400', 'shadow-2xl', 'transition-all', 'duration-500')
        setTimeout(() => {
          pageEl.classList.remove('ring-4', 'ring-cyan-400', 'shadow-2xl', 'transition-all', 'duration-500')
        }, 1600)
      }
      updateTether()
    }, 150)
  }

  function handleNavigateToPage(docId: string | undefined, pageNumber: number) {
    if (docId && activeDocument?.id !== docId) {
      const doc = documents?.find((d) => d.id === docId)
      if (doc) setActiveDocument(doc)
    }
    setFocusPage(pageNumber)
    if (layoutMode === 'workspace') setLayoutMode('split')

    setTimeout(() => {
      const pageEl =
        splitContainerRef.current?.querySelector(`[data-page-number="${pageNumber}"]`) ||
        document.querySelector(`[data-page-number="${pageNumber}"]`)
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        pageEl.classList.add('ring-4', 'ring-cyan-400', 'shadow-2xl', 'transition-all', 'duration-500')
        setTimeout(() => {
          pageEl.classList.remove('ring-4', 'ring-cyan-400', 'shadow-2xl', 'transition-all', 'duration-500')
        }, 1600)
      }
      updateTether()
    }, 150)
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

  // Phase 7: project-wide search. Clicking a result that's anchored to a
  // document (page, excerpt, or annotation) switches to the Documents tab,
  // opens that document (if it's among the currently-loaded pages - see
  // openDocumentAtPage), and scrolls straight to the page it was found on.
  const search = useSearch()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchOpenError, setSearchOpenError] = useState<string | null>(null)

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q || !projectId) return
    setSearchError(null)

    try {
      const results = await search.mutateAsync({ projectId, q })
      setSearchResults(results)
    } catch (err) {
      setSearchError(apiErrorMessage(err, 'Search failed.'))
    }
  }

  function openDocumentAtPage(documentId: string, pageNumber: number) {
    const doc = documents?.find((d) => d.id === documentId)
    if (!doc) {
      setSearchOpenError('Open this document from the Documents tab first (it hasn’t loaded on this page yet).')
      return
    }
    setSearchOpenError(null)
    setTab('documents')
    setActiveDocument(doc)
    setFocusPage(pageNumber)
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
    <div className="flex h-[calc(100vh-56px)] flex-col bg-slate-50 text-slate-900">
      {/* Courtroom Jammer / Basement Zero-Internet Alert Banner */}
      {(isOffline || simulatedJammer) && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-5 py-2 text-xs font-semibold text-amber-900">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-ping" />
            <span>⚡ Courtroom Jammer / Offline Vault Active — Zero internet needed for reading, citations & oral arguments.</span>
          </div>
          <div className="flex items-center gap-2">
            {vaultCachedAt && <span className="text-[11px] text-amber-800 font-medium">Cached: {vaultCachedAt}</span>}
            {simulatedJammer && (
              <button
                type="button"
                onClick={() => setSimulatedJammer(false)}
                className="rounded-lg bg-amber-200/80 px-2.5 py-0.5 text-[11px] font-bold text-amber-900 hover:bg-amber-300"
              >
                Disable Test Jammer
              </button>
            )}
          </div>
        </div>
      )}
      {vaultMessage && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-1.5 text-xs font-semibold text-emerald-800 text-center animate-fade-in">
          {vaultMessage}
        </div>
      )}

      {/* Premium Executive Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-200/90 bg-white px-5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex-wrap gap-3">
        {/* Left: Breadcrumbs & Matter Title */}
        <div className="flex items-center gap-3 min-w-0">
          <RouterLink
            to="/"
            className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors"
          >
            <span>←</span>
            <span>Projects</span>
          </RouterLink>
          <span className="text-slate-300">/</span>
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-xs font-bold">
              ⚖️
            </span>
            <h1 className="truncate font-extrabold text-slate-900 text-sm tracking-tight max-w-[180px] sm:max-w-xs md:max-w-md">
              {project?.name}
            </h1>
          </div>
        </div>

        {/* Center: Clean Segmented Control Tabs */}
        <nav className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold border border-slate-200/70 shadow-inner">
          <button
            className={`rounded-lg px-3.5 py-1.5 transition-all cursor-pointer ${
              tab === 'documents'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setTab('documents')}
          >
            📄 Documents
          </button>
          <button
            className={`rounded-lg px-3.5 py-1.5 transition-all cursor-pointer ${
              tab === 'workspace'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setTab('workspace')}
          >
            🧠 Canvas
          </button>
          <button
            className={`rounded-lg px-3.5 py-1.5 transition-all cursor-pointer ${
              tab === 'search'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setTab('search')}
          >
            🔍 Search
          </button>
        </nav>

        {/* Right: Integrated Action Suite */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Hearing Dais (High-Contrast Courtroom Mode) */}
          <button
            type="button"
            onClick={() => setHearingMode(true)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 text-xs font-bold shadow-xs transition-all active:scale-[0.99] cursor-pointer"
            title="Enter Courtroom Hearing Dais Mode (Hotkey: H)"
          >
            <span>⚖️</span>
            <span>Hearing Dais</span>
          </button>

          {/* List of Dates & Case Chronology */}
          <button
            type="button"
            onClick={() => setShowChronologyModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            title="Open List of Dates & Case Chronology Synopsis (Hotkey: C)"
          >
            <span>📅</span>
            <span>Dates</span>
          </button>

          {/* Courtroom Offline Vault Button */}
          <button
            type="button"
            onClick={handleToggleVault}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all shadow-xs cursor-pointer ${
              isOffline || vaultCachedAt
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 font-bold'
                : 'border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            title={
              vaultCachedAt
                ? `Vault cached at ${vaultCachedAt}. Click to update snapshot.`
                : 'Cache full matter locally for Tis Hazari / Basement No-Internet courtrooms'
            }
          >
            <span className={`h-2 w-2 rounded-full ${vaultCachedAt ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            <span>{vaultCachedAt ? 'Vault Ready' : 'Cache Offline'}</span>
          </button>

          {/* Zero-Retention Cloud Shred */}
          <button
            type="button"
            onClick={() => setShowShredModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 px-2.5 py-1.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            title="Zero-Retention Mode: Export encrypted brief & permanently purge all files and database records from server"
          >
            <span>🔒</span>
            <span>Shred</span>
          </button>

          <span className="h-5 w-px bg-slate-200 hidden sm:block" />

          {/* Export Group */}
          <div className="flex items-center gap-1.5">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as 'pdf' | 'pdf_highlights' | 'docx')}
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-xs focus:border-blue-600 focus:outline-none"
            >
              <option value="pdf">Notes/Excerpts (PDF)</option>
              <option value="pdf_highlights">Highlighted PDF</option>
              <option value="docx">Notes/Excerpts (DOCX)</option>
            </select>
            <Button
              variant="secondary"
              onClick={handleStartExport}
              disabled={startExport.isPending}
              className="py-1.5 px-3 text-xs"
            >
              Export
            </Button>
          </div>

          <span className="h-5 w-px bg-slate-200 hidden sm:block" />

          {/* Chambers Quick Link */}
          <button
            type="button"
            onClick={() => setShowChambersModal(true)}
            className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
            title="Manage Chambers & Advocate Team"
          >
            <span>👥</span>
            <span>Chambers</span>
          </button>

          {/* Font Scaler (A / A+ / A++) */}
          <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs shadow-inner" title="Advocate Font Size: Normal (100%), Large (114%), Jumbo (128%)">
            <button
              type="button"
              onClick={() => setFontSizeScale('normal')}
              className={`rounded-lg px-2 py-0.5 text-xs font-bold transition-all cursor-pointer ${
                fontSizeScale === 'normal'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Normal text size (100%)"
            >
              A
            </button>
            <button
              type="button"
              onClick={() => setFontSizeScale('large')}
              className={`rounded-lg px-2 py-0.5 text-xs font-bold transition-all cursor-pointer ${
                fontSizeScale === 'large'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Large font size (114% - Recommended for Advocates 48+)"
            >
              A+
            </button>
            <button
              type="button"
              onClick={() => setFontSizeScale('jumbo')}
              className={`rounded-lg px-2 py-0.5 text-xs font-black transition-all cursor-pointer ${
                fontSizeScale === 'jumbo'
                  ? 'bg-white text-blue-700 shadow-xs font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Jumbo font size (128% - Courtroom brief reading)"
            >
              A++
            </button>
          </div>
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
        <div className="flex flex-1 flex-col overflow-hidden p-4">
          {activeDocument ? (
            // Opening a document replaces the grid with a compact header
            // bar rather than stacking the viewer below it - the grid
            // previously stayed on-screen above an already-tall PdfViewer
            // box, so reaching the bottom mode-switch bar (Drawing/
            // Document/Workspace) needed scrolling the whole outer page,
            // not just the PDF itself. Making the viewer `flex-1` here
            // guarantees it always fills the remaining viewport exactly,
            // so that bar is never pushed below the fold.
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3 flex-wrap">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setActiveDocument(null)
                    setSecondaryDocument(null)
                    setFocusPage(undefined)
                  }}
                >
                  ← Documents
                </Button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {activeDocument.original_filename}
                  </p>
                  {linkedDocuments.length > 0 && (
                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-medium text-slate-500">Linked:</span>
                      {linkedDocuments.map((ld) => (
                        <button
                          key={ld.id}
                          type="button"
                          onClick={() => {
                            if (secondaryDocument?.id === ld.id) {
                              setSecondaryDocument(null)
                            } else {
                              setSecondaryDocument(ld)
                            }
                          }}
                          className="flex items-center gap-1 rounded-lg bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] text-blue-700 font-semibold transition-colors hover:bg-blue-100"
                          title="Click to toggle parallel comparison with this linked document"
                        >
                          🔗 {ld.original_filename}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCitationModal(true)}
                  className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 cursor-pointer"
                  title="View and copy formatted academic citations (APA, MLA, BibTeX)"
                >
                  <span>📜</span>
                  <span>Citation</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {/* Compare Parallel PDF Menu */}
                {documents && documents.length > 1 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCompareMenu((m) => !m)
                        setShowDocLinkMenu(false)
                      }}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        secondaryDocument
                          ? 'border-cyan-500/40 bg-cyan-500/20 text-cyan-300'
                          : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:border-slate-700'
                      }`}
                      title="Open another PDF in parallel view"
                    >
                      <span>⧉</span>
                      <span>{secondaryDocument ? 'Comparing (2 PDFs)' : 'Compare PDF'}</span>
                    </button>

                    {showCompareMenu && (
                      <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-slate-700 bg-slate-900 p-2 shadow-2xl">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Parallel Dual-PDF View
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1">
                          {documents
                            .filter((d) => d.id !== activeDocument.id && d.status === 'ready')
                            .map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => {
                                  setSecondaryDocument(doc)
                                  setShowCompareMenu(false)
                                }}
                                className={`w-full truncate rounded p-1.5 text-left text-xs transition-colors ${
                                  secondaryDocument?.id === doc.id
                                    ? 'bg-cyan-500/20 font-semibold text-cyan-300'
                                    : 'text-slate-200 hover:bg-slate-800'
                                }`}
                              >
                                📄 {doc.original_filename}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Link Document Menu */}
                {documents && documents.length > 1 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDocLinkMenu((m) => !m)
                        setShowCompareMenu(false)
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700"
                      title="Create a direct document-to-document link"
                    >
                      <span>🔗</span>
                      <span>Link Doc</span>
                    </button>

                    {showDocLinkMenu && (
                      <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-slate-700 bg-slate-900 p-2 shadow-2xl">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Link to Another Document
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1">
                          {documents
                            .filter(
                              (d) =>
                                d.id !== activeDocument.id &&
                                d.status === 'ready' &&
                                !linkedDocIds.includes(d.id),
                            )
                            .map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => handleLinkDocument(doc.id)}
                                className="w-full truncate rounded p-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                              >
                                + Link with {doc.original_filename}
                              </button>
                            ))}
                          {documents.filter(
                            (d) =>
                              d.id !== activeDocument.id &&
                              d.status === 'ready' &&
                              !linkedDocIds.includes(d.id),
                          ).length === 0 && (
                            <p className="p-2 text-xs text-slate-500">All other documents are already linked.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Liquid Split-Screen View Mode Switcher */}
                <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs shadow-inner">
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition-all cursor-pointer ${
                      layoutMode === 'split'
                        ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setLayoutMode('split')}
                    title="Side-by-side: Read PDF and organize on Canvas simultaneously"
                  >
                    <span>◫</span>
                    <span>Split View</span>
                  </button>
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition-all cursor-pointer ${
                      layoutMode === 'doc'
                        ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setLayoutMode('doc')}
                    title="Focus on document reader only"
                  >
                    <span>📄</span>
                    <span>Document</span>
                  </button>
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition-all cursor-pointer ${
                      layoutMode === 'workspace'
                        ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setLayoutMode('workspace')}
                    title="Focus on research canvas only"
                  >
                    <span>🧠</span>
                    <span>Canvas</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={`relative overflow-auto pb-12 transition-all duration-200 ${
                isDraggingOver ? 'bg-blue-50/50 ring-4 ring-blue-500 ring-dashed rounded-3xl' : ''
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* Drag & Drop Visual Glow Overlay */}
              {isDraggingOver && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-blue-600/10 backdrop-blur-xs rounded-3xl border-4 border-dashed border-blue-500 pointer-events-none p-8 text-center">
                  <div className="h-20 w-20 rounded-full bg-blue-600 text-white flex items-center justify-center text-3xl shadow-xl animate-bounce mb-4">
                    ⚡
                  </div>
                  <h3 className="text-xl font-black text-blue-950">Release to Fast-Upload Court Briefs</h3>
                  <p className="text-sm font-semibold text-blue-700 mt-1 max-w-sm">
                    High-speed multi-file streaming with instant background OCR and citation indexing.
                  </p>
                </div>
              )}

              {/* Executive Case Dossier Hero Banner (2026 Legal Flagship Standard) */}
              <div className="relative overflow-hidden mb-6 rounded-3xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/70 to-blue-50/40 p-6 sm:p-8 shadow-[0_4px_24px_rgba(15,23,42,0.04)]">
                <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-blue-100/40 blur-3xl pointer-events-none" />
                <div className="absolute left-1/3 bottom-0 -mb-16 h-48 w-48 rounded-full bg-indigo-100/30 blur-2xl pointer-events-none" />

                <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2 mb-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-extrabold text-blue-700 border border-blue-200">
                        ⚖️ Litigation Master Brief
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Chambers Active
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
                        🔒 Zero-Retention Ready
                      </span>
                    </div>

                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                      {project?.name ?? 'Case Workspace Dossier'}
                    </h1>
                    <p className="mt-1.5 text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
                      {project?.description ||
                        'Unified litigation brief with automated OCR indexing, court page referencing, and real-time citation synthesis.'}
                    </p>

                    {/* Quick Stats Grid */}
                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-2xs backdrop-blur-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Filings</span>
                        <p className="text-lg font-black text-slate-900 mt-0.5">{documents?.length ?? 0}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-2xs backdrop-blur-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Indexed Pages</span>
                        <p className="text-lg font-black text-blue-600 mt-0.5">{totalPagesCount}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-2xs backdrop-blur-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Citations Linked</span>
                        <p className="text-lg font-black text-indigo-600 mt-0.5">{workspaceItems?.length ?? 0}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-2xs backdrop-blur-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Vault Privacy</span>
                        <p className="text-lg font-black text-emerald-600 mt-0.5">Isolated</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      multiple
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <Button
                      variant="primary"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadQueue.some((u) => u.status === 'uploading')}
                      className="flex items-center justify-center gap-2 py-3 px-5 text-sm font-bold shadow-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl cursor-pointer"
                    >
                      <span className="text-base">⚡</span>
                      <span>
                        {uploadQueue.some((u) => u.status === 'uploading')
                          ? 'Uploading Filings…'
                          : 'Fast Upload Court PDFs'}
                      </span>
                    </Button>

                    <button
                      type="button"
                      onClick={() => setLayoutMode('workspace')}
                      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                      <span>🧠</span>
                      <span>Open Research Canvas</span>
                    </button>
                    {uploadError && <span className="text-xs text-rose-600 font-bold">{uploadError}</span>}
                  </div>
                </div>
              </div>

              {/* High-Speed Upload Live Stream Progress Bar */}
              {uploadQueue.length > 0 && (
                <div className="mb-6 rounded-3xl border border-blue-200/90 bg-gradient-to-br from-blue-50/90 via-indigo-50/60 to-white p-5 shadow-lg backdrop-blur-md transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-600 text-white text-xs font-black shadow-xs">
                        🚀
                      </span>
                      <div>
                        <span className="text-sm font-black text-slate-900 block leading-tight">
                          High-Speed Vault Ingestion Pipeline
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {uploadQueue.filter((u) => u.status !== 'done').length} court brief(s) streaming
                        </span>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-blue-700 bg-blue-100/90 px-3 py-1 rounded-full border border-blue-200 shadow-2xs">
                      ⚡ Turbo Async Streaming
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {uploadQueue.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-slate-200/80 bg-white/90 p-3.5 shadow-2xs transition-all"
                      >
                        <div className="flex items-center justify-between text-xs mb-2">
                          <div className="flex items-center gap-2 min-w-0 pr-3">
                            <span className="text-base shrink-0">📄</span>
                            <span className="font-extrabold text-slate-900 truncate" title={item.name}>
                              {item.name}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                              ({formatFileSize(item.size)})
                            </span>
                          </div>
                          <div className="shrink-0 font-bold">
                            {item.status === 'uploading' && (
                              <span className="text-blue-600 flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
                                Uploading {item.percent}%
                              </span>
                            )}
                            {item.status === 'processing' && (
                              <span className="text-amber-600 flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                ⚡ Fast Indexing (Instant Vault)
                              </span>
                            )}
                            {item.status === 'done' && (
                              <span className="text-emerald-600 flex items-center gap-1">
                                ✓ Ready in Dossier
                              </span>
                            )}
                            {item.status === 'error' && (
                              <span className="text-rose-600 flex items-center gap-1">
                                ⚠️ {item.error || 'Failed'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200/60">
                          <div
                            className={`h-full transition-all duration-300 rounded-full ${
                              item.status === 'error'
                                ? 'bg-rose-500'
                                : item.status === 'done'
                                  ? 'bg-emerald-500'
                                  : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 animate-pulse'
                            }`}
                            style={{ width: `${item.status === 'done' ? 100 : item.percent}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dossier Filter & Search Control Bar */}
              <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-slate-200/60 border border-slate-200/80">
                  <button
                    type="button"
                    onClick={() => setDocCategory('all')}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      docCategory === 'all'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All Briefs ({documents?.length ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocCategory('pleadings')}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      docCategory === 'pleadings'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Petitions & Pleadings
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocCategory('evidence')}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      docCategory === 'evidence'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Exhibits & Evidence
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocCategory('orders')}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      docCategory === 'orders'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Orders & Decrees
                  </button>
                </div>

                <div className="relative min-w-[260px] sm:max-w-xs">
                  <input
                    type="text"
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    placeholder="Search filing name…"
                    className="w-full rounded-2xl border border-slate-200/90 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none shadow-xs"
                  />
                  <span className="absolute left-3 top-2.5 text-xs text-slate-400">🔍</span>
                </div>
              </div>

              {loadingDocs && (
                <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-slate-200/80 bg-white">
                  <Spinner className="h-7 w-7 mb-3 text-blue-600" />
                  <p className="text-sm font-bold text-slate-800">Loading Case Pleadings…</p>
                  <p className="text-xs text-slate-500 mt-0.5">Fetching document pages and verified checksums</p>
                </div>
              )}

              {(projectError || (docsError && !loadingDocs)) && (
                <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-slate-200 bg-white shadow-xs">
                  <span className="text-3xl mb-2">📁</span>
                  <h3 className="font-bold text-slate-800 text-sm">Case Matter Not Found or Access Changed</h3>
                  <p className="text-xs text-slate-500 max-w-md mt-1 mb-4">
                    This case brief was either purged under Zero-Retention or belongs to another chamber workspace.
                  </p>
                  <RouterLink
                    to="/"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 text-white px-4 py-2 text-xs font-bold shadow-xs hover:bg-blue-700"
                  >
                    <span>← Return to My Projects</span>
                  </RouterLink>
                </div>
              )}

              {!loadingDocs && !projectError && !docsError && documents?.length === 0 && (
                <EmptyState
                  title="No case documents uploaded yet"
                  description="Upload your petitions, trial record, chargesheet, or evidence PDF to begin analysis."
                />
              )}

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDocuments.map((doc) => {
                  const isReady = doc.status === 'ready'
                  const isProcessing = doc.status === 'processing'
                  const isFailed = doc.status === 'failed'

                  return (
                    <div
                      key={doc.id}
                      className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.03)] hover:shadow-[0_12px_36px_rgba(37,99,235,0.08)] hover:border-blue-300 transition-all duration-300"
                    >
                      {/* Document Card Header Preview */}
                      <div>
                        {/* Mock Document Sheet Banner */}
                        <div className="relative mb-4 flex h-32 w-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50 to-slate-100/60 p-3.5 shadow-inner">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-700 shadow-2xs border border-slate-200/60">
                              <span>📄</span>
                              <span>PDF Brief</span>
                            </span>
                            <span
                              className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                                isReady
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : isProcessing
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-rose-100 text-rose-800 border border-rose-200'
                              }`}
                            >
                              {isReady ? '✓ OCR Verified' : isProcessing ? '⏳ Processing' : '⚠️ Error'}
                            </span>
                          </div>

                          {/* Paper lines simulation */}
                          <div className="space-y-1.5 px-1 opacity-40">
                            <div className="h-1.5 w-3/4 rounded-full bg-slate-400" />
                            <div className="h-1.5 w-full rounded-full bg-slate-300" />
                            <div className="h-1.5 w-5/6 rounded-full bg-slate-300" />
                            <div className="h-1.5 w-1/2 rounded-full bg-slate-300" />
                          </div>

                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                            <span>{doc.page_count ? `${doc.page_count} Pages` : 'Paging…'}</span>
                            <span className="rounded bg-slate-200/70 px-1.5 py-0.2">Court Paper</span>
                          </div>
                        </div>

                        {/* Title & Filename */}
                        <h3
                          onClick={() => {
                            if (!isReady) return
                            setActiveDocument(doc)
                            setFocusPage(undefined)
                          }}
                          className="text-sm font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug cursor-pointer"
                          title={doc.original_filename}
                        >
                          {doc.original_filename}
                        </h3>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">
                            ID: {doc.id.slice(0, 8)}…
                          </span>
                          <span className="text-slate-400">•</span>
                          <span>Indexed Brief</span>
                        </div>

                        {isFailed && (
                          <div className="mt-2.5 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                            {doc.failure_reason || 'Document processing failed.'}
                          </div>
                        )}
                      </div>

                      {/* Card Action Footer */}
                      <div className="mt-5 pt-3.5 border-t border-slate-100 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!isReady) return
                              setActiveDocument(doc)
                              setFocusPage(undefined)
                            }}
                            disabled={!isReady}
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white py-2.5 px-4 text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                          >
                            <span>Open in Reader</span>
                            <span>➔</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteDocument(doc.id, doc.original_filename)}
                            disabled={deleteDocument.isPending}
                            className="flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 p-2.5 text-rose-600 hover:text-rose-700 transition-colors cursor-pointer shrink-0"
                            title="Delete this PDF brief"
                          >
                            🗑️
                          </button>
                        </div>

                        {isReady && (
                          <div className="flex items-center gap-2 pt-1">
                            <div className="flex-1">
                              <CitationEditor projectId={projectId!} document={doc} />
                            </div>
                            <div className="shrink-0">
                              <AiDocumentPanel projectId={projectId!} document={doc} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
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
            </div>
          )}

          {activeDocument && (
            <div
              ref={splitContainerRef}
              className="relative flex flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
            >
              {/* Dynamic Elastic Spring-Line Tether between PDF and Canvas */}
              {layoutMode === 'split' && tetherCoords && (
                <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
                  <defs>
                    <linearGradient id="tetherGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
                      <stop offset="50%" stopColor="#818cf8" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.95" />
                    </linearGradient>
                    <filter id="glowDrop" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>
                  {(() => {
                    const { x1, y1, x2, y2 } = tetherCoords
                    const dx = Math.max(Math.abs(x2 - x1), 50)
                    return (
                      <g filter="url(#glowDrop)">
                        {/* Smooth Cubic Bezier Spring Curve */}
                        <path
                          d={`M ${x1} ${y1} C ${x1 + dx * 0.45} ${y1}, ${x2 - dx * 0.45} ${y2}, ${x2} ${y2}`}
                          stroke="url(#tetherGlow)"
                          strokeWidth="3"
                          strokeDasharray="6 4"
                          fill="none"
                          className="animate-pulse"
                        />
                        {/* PDF anchor dot */}
                        <circle cx={x1} cy={y1} r={5} fill="#38bdf8" />
                        <circle cx={x1} cy={y1} r={3.5} fill="#ffffff" stroke="#0284c7" strokeWidth="1.5" />
                        {/* Canvas Card anchor dot */}
                        <circle cx={x2} cy={y2} r={5} fill="#f59e0b" />
                        <circle cx={x2} cy={y2} r={3.5} fill="#ffffff" stroke="#d97706" strokeWidth="1.5" />
                      </g>
                    )
                  })()}
                </svg>
              )}
              {/* Document Pane */}
              <div
                className="flex flex-col overflow-hidden"
                style={{
                  width: layoutMode === 'split' ? `${splitPercent}%` : layoutMode === 'doc' ? '100%' : '0%',
                  display: layoutMode === 'workspace' ? 'none' : 'flex',
                }}
              >
                {secondaryDocument ? (
                  <div className="flex flex-1 overflow-hidden">
                    {/* Primary Document A */}
                    <div className="flex flex-1 flex-col overflow-hidden border-r border-slate-800">
                      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-300">
                        <span className="truncate">{activeDocument.original_filename}</span>
                        <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
                          DOC A
                        </span>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <PdfViewer
                          documentId={activeDocument.id}
                          onSaveExcerpt={(s) => handleSaveExcerptFor(activeDocument.id, s)}
                          initialPage={focusPage}
                          onSwitchToWorkspace={() => setLayoutMode('split')}
                        />
                      </div>
                    </div>

                    {/* Secondary Document B */}
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-300">
                        <span className="truncate">{secondaryDocument.original_filename}</span>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                            DOC B
                          </span>
                          <button
                            type="button"
                            onClick={() => setSecondaryDocument(null)}
                            className="rounded px-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
                            title="Close parallel view"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <PdfViewer
                          documentId={secondaryDocument.id}
                          onSaveExcerpt={(s) => handleSaveExcerptFor(secondaryDocument.id, s)}
                          onSwitchToWorkspace={() => setLayoutMode('split')}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-300">
                      <span className="truncate max-w-md font-semibold text-slate-200">
                        📄 {activeDocument.original_filename}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDeleteDocument(activeDocument.id, activeDocument.original_filename)}
                          className="flex items-center gap-1 rounded bg-rose-950/40 border border-rose-700/50 px-2 py-0.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/60 transition-colors cursor-pointer"
                          title="Delete this PDF brief"
                        >
                          🗑️ Delete PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveDocument(null)}
                          className="rounded bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
                          title="Close reader and return to documents"
                        >
                          ✕ Close Reader
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <PdfViewer
                        documentId={activeDocument.id}
                        onSaveExcerpt={handleSaveExcerpt}
                        initialPage={focusPage}
                        onSwitchToWorkspace={() => setLayoutMode('split')}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Draggable Divider in Split Mode */}
              {layoutMode === 'split' && (
                <div
                  className="group relative z-10 flex w-2.5 shrink-0 cursor-col-resize select-none items-center justify-center border-x border-slate-800/80 bg-slate-950 transition-colors hover:bg-cyan-500/20 active:bg-cyan-500/40"
                  onMouseDown={handleDividerMouseDown}
                  onDoubleClick={() => setSplitPercent(52)}
                  title="Drag to resize Document and Canvas (double-click to reset 50/50)"
                >
                  <div className="h-8 w-1 rounded-full bg-slate-700 transition-colors group-hover:bg-cyan-400" />
                </div>
              )}

              {/* Research Canvas Pane */}
              <div
                className="relative flex flex-1 flex-col overflow-hidden bg-slate-950"
                style={{
                  width: layoutMode === 'split' ? `${100 - splitPercent}%` : layoutMode === 'workspace' ? '100%' : '0%',
                  display: layoutMode === 'doc' ? 'none' : 'flex',
                }}
              >
                <div className="flex flex-1 overflow-hidden">
                  <div className="flex-1 overflow-hidden">
                    <WorkspaceCanvas
                      projectId={projectId!}
                      items={workspaceItems ?? []}
                      excerpts={excerpts ?? []}
                      notes={notes ?? []}
                      links={links ?? []}
                      tags={tags ?? []}
                      documents={documents ?? []}
                      onOpenCard={handleOpenCard}
                      onNavigateToSource={handleNavigateToSource}
                      activeCardId={activeCardId}
                      onCardHover={(cardId) => {
                        if (cardId) setActiveCardId(cardId)
                      }}
                      onCardSelect={(cardId) => setActiveCardId(cardId)}
                      onDropExcerpt={handleDropExcerpt}
                    />
                  </div>

                  {showCanvasSidebar ? (
                    <aside className="w-64 shrink-0 overflow-y-auto border-l border-slate-200/90 bg-white p-3.5 shadow-xs">
                      <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">New Note</h2>
                        <button
                          type="button"
                          onClick={() => setShowCanvasSidebar(false)}
                          className="rounded-lg p-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                          title="Collapse sidebar"
                        >
                          ✕
                        </button>
                      </div>
                      <form onSubmit={handleCreateNote} className="mb-4 space-y-2">
                        <textarea
                          name="content"
                          rows={2}
                          placeholder="Write a thought or note…"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none shadow-2xs"
                        />
                        <Button type="submit" className="w-full text-xs" disabled={createNote.isPending}>
                          Add Note
                        </Button>
                      </form>

                      <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-800">Tags</h2>
                      <form onSubmit={handleCreateTag} className="mb-2 flex gap-1">
                        <input
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          placeholder="New tag…"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none shadow-2xs"
                        />
                        <Button type="submit" variant="secondary" disabled={createTag.isPending} className="text-xs">
                          Add
                        </Button>
                      </form>
                    </aside>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCanvasSidebar(true)}
                      className="absolute right-3 top-3 z-10 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-md hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
                      title="Open note & tag sidebar"
                    >
                      + Note / Tags
                    </button>
                  )}
                </div>
              </div>
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
              documents={documents ?? []}
              onOpenCard={handleOpenCard}
              onNavigateToSource={handleNavigateToSource}
              activeCardId={activeCardId}
              onDropExcerpt={handleDropExcerpt}
            />
          </div>
          <aside className="w-72 shrink-0 border-l border-slate-200/90 bg-white p-4 shadow-xs text-slate-800">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-800">New note</h2>
            <form onSubmit={handleCreateNote} className="mb-6 space-y-2">
              <textarea
                name="content"
                rows={3}
                placeholder="Write a note…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none shadow-2xs"
              />
              <Button type="submit" className="w-full" disabled={createNote.isPending}>
                Add note
              </Button>
            </form>

            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-800">Tags</h2>
            <form onSubmit={handleCreateTag} className="mb-2 flex gap-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="New tag…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none shadow-2xs"
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

      {tab === 'search' && (
        <div className="flex-1 overflow-auto p-4">
          <form onSubmit={handleSearch} className="mb-4 flex max-w-xl gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search document text, excerpts, notes, and highlights…"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <Button type="submit" disabled={search.isPending}>
              {search.isPending ? 'Searching…' : 'Search'}
            </Button>
          </form>

          {searchError && <p className="mb-3 text-sm text-red-400">{searchError}</p>}
          {searchOpenError && <p className="mb-3 text-sm text-amber-400">{searchOpenError}</p>}

          {searchResults && (
            <div className="max-w-xl space-y-6">
              <SearchResultSection title="Document pages">
                {searchResults.document_pages.map((r, i) => (
                  <SearchResultCard
                    key={i}
                    onClick={() => openDocumentAtPage(r.document_id, r.page_number)}
                    meta={`${r.document_name ?? 'Document'} · page ${r.page_number}`}
                  />
                ))}
              </SearchResultSection>

              <SearchResultSection title="Excerpts">
                {searchResults.excerpts.map((r) => (
                  <SearchResultCard
                    key={r.id}
                    onClick={() => openDocumentAtPage(r.document_id, r.page_number)}
                    meta={`Page ${r.page_number}`}
                    snippet={r.snippet}
                  />
                ))}
              </SearchResultSection>

              <SearchResultSection title="Highlights & comments">
                {searchResults.annotations.map((r) => (
                  <SearchResultCard
                    key={r.id}
                    onClick={() => openDocumentAtPage(r.document_id, r.page_number)}
                    meta={`${r.annotation_type} · page ${r.page_number}`}
                    snippet={r.snippet}
                  />
                ))}
              </SearchResultSection>

              <SearchResultSection title="Notes">
                {searchResults.notes.map((r) => (
                  <SearchResultCard
                    key={r.id}
                    onClick={() => setTab('workspace')}
                    meta={r.title ?? 'Untitled note'}
                    snippet={r.snippet}
                  />
                ))}
              </SearchResultSection>
            </div>
          )}
        </div>
      )}

      {/* Organization Analytics Modal */}
      {showAnalyticsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowAnalyticsModal(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📊</span>
                <h2 className="text-lg font-bold text-slate-100">Organization Analytics & Audit</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAnalyticsModal(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                ✕
              </button>
            </div>

            {orgAnalytics ? (
              <div className="space-y-6">
                {/* Metrics Grid */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-center">
                    <p className="text-2xl font-bold text-cyan-400">{orgAnalytics.total_projects}</p>
                    <p className="text-xs text-slate-400">Total Projects</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-center">
                    <p className="text-2xl font-bold text-amber-400">{orgAnalytics.total_documents}</p>
                    <p className="text-xs text-slate-400">PDF Documents</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-400">
                      {orgAnalytics.total_excerpts + orgAnalytics.total_notes}
                    </p>
                    <p className="text-xs text-slate-400">Excerpts & Notes</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-center">
                    <p className="text-2xl font-bold text-purple-400">{orgAnalytics.total_members}</p>
                    <p className="text-xs text-slate-400">Team Members</p>
                  </div>
                </div>

                {/* Storage Quota Progress */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Cloud Storage Used</span>
                    <span className="text-slate-400">
                      {(orgAnalytics.total_storage_bytes / (1024 * 1024)).toFixed(1)} MB of 5.0 GB Quota
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            4,
                            (orgAnalytics.total_storage_bytes / (5 * 1024 * 1024 * 1024)) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Recent Activity Audit Trail */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Recent Audit Activity
                  </h3>
                  <div className="max-h-52 overflow-y-auto space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/80 p-2">
                    {orgAnalytics.recent_activity.length === 0 ? (
                      <p className="p-2 text-xs text-slate-500">No recent audit logs recorded.</p>
                    ) : (
                      orgAnalytics.recent_activity.map((log) => (
                        <div
                          key={log.id}
                          className="flex items-center justify-between rounded p-2 text-xs text-slate-300 hover:bg-slate-900"
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
                              {log.action}
                            </span>
                            <span className="text-slate-400">{log.target_type}</span>
                          </div>
                          <span className="text-[10px] text-slate-500">
                            {new Date(log.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-slate-400">Loading organization analytics…</p>
            )}
          </div>
        </div>
      )}

      {/* Citation Modal */}
      {showCitationModal && activeDocument && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowCitationModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📜</span>
                <h2 className="text-lg font-bold text-slate-100">Academic Citations</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCitationModal(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                ✕
              </button>
            </div>

            <p className="mb-4 text-xs text-slate-400">
              Citations for <span className="font-semibold text-slate-200">{activeDocument.original_filename}</span>:
            </p>

            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-300">APA Format</span>
                  <button
                    type="button"
                    onClick={() => {
                      const text =
                        activeDocument.citation_apa ||
                        `${activeDocument.citation_metadata?.author ?? 'Author'}. (${activeDocument.citation_metadata?.year ?? new Date().getFullYear()}). ${activeDocument.citation_metadata?.title ?? activeDocument.original_filename}.`
                      navigator.clipboard.writeText(text)
                      setCopiedCitation('apa')
                      setTimeout(() => setCopiedCitation(null), 1500)
                    }}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-slate-700"
                  >
                    {copiedCitation === 'apa' ? '✓ Copied' : 'Copy APA'}
                  </button>
                </div>
                <div className="rounded border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-300 font-serif leading-relaxed">
                  {activeDocument.citation_apa ||
                    `${activeDocument.citation_metadata?.author ?? 'Author'}. (${activeDocument.citation_metadata?.year ?? new Date().getFullYear()}). ${activeDocument.citation_metadata?.title ?? activeDocument.original_filename}.`}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-cyan-300">BibTeX Format</span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = `@article{chandak_${activeDocument.id.slice(0, 6)},\n  title={${activeDocument.citation_metadata?.title ?? activeDocument.original_filename}},\n  author={${activeDocument.citation_metadata?.author ?? 'Unknown'}},\n  year={${activeDocument.citation_metadata?.year ?? new Date().getFullYear()}}\n}`
                      navigator.clipboard.writeText(text)
                      setCopiedCitation('bibtex')
                      setTimeout(() => setCopiedCitation(null), 1500)
                    }}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-slate-700"
                  >
                    {copiedCitation === 'bibtex' ? '✓ Copied' : 'Copy BibTeX'}
                  </button>
                </div>
                <pre className="rounded border border-slate-800 bg-slate-950 p-2.5 text-[11px] font-mono text-slate-300 overflow-x-auto">
{`@article{chandak_${activeDocument.id.slice(0, 6)},
  title={${activeDocument.citation_metadata?.title ?? activeDocument.original_filename}},
  author={${activeDocument.citation_metadata?.author ?? 'Unknown'}},
  year={${activeDocument.citation_metadata?.year ?? new Date().getFullYear()}}
}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowShortcutsModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⌨️</span>
                <h2 className="text-lg font-bold text-slate-100">Keyboard Shortcuts</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between rounded p-2 bg-slate-950">
                <span className="text-slate-300">Toggle View (Split / Doc / Canvas)</span>
                <kbd className="rounded bg-slate-800 px-2 py-0.5 font-mono text-cyan-300">S</kbd>
              </div>
              <div className="flex items-center justify-between rounded p-2 bg-slate-950">
                <span className="text-slate-300">Toggle Shortcuts Help</span>
                <kbd className="rounded bg-slate-800 px-2 py-0.5 font-mono text-cyan-300">?</kbd>
              </div>
              <div className="flex items-center justify-between rounded p-2 bg-slate-950">
                <span className="text-slate-300">Dismiss / Close active popup</span>
                <kbd className="rounded bg-slate-800 px-2 py-0.5 font-mono text-cyan-300">Esc</kbd>
              </div>
              <div className="flex items-center justify-between rounded p-2 bg-slate-950">
                <span className="text-slate-300">Direct Excerpt Pin</span>
                <span className="text-amber-300">Drag ✋ from selection to Canvas</span>
              </div>
              <div className="flex items-center justify-between rounded p-2 bg-slate-950">
                <span className="text-slate-300">Magnetic Card Snapping</span>
                <span className="text-cyan-300">Auto-aligns within 16px of cards</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Case Chronology & List of Dates Modal */}
      <CaseChronologyModal
        isOpen={showChronologyModal}
        onClose={() => setShowChronologyModal(false)}
        projectId={projectId!}
        documents={documents ?? []}
        excerpts={excerpts ?? []}
        onNavigateToPage={handleNavigateToPage}
      />

      {/* Chambers Team Manager Modal */}
      <ChambersManagerModal
        isOpen={showChambersModal}
        onClose={() => setShowChambersModal(false)}
        onOpenPlans={() => setShowPlansModal(true)}
      />

      {/* Subscription Plans Modal */}
      <SubscriptionPlansModal
        isOpen={showPlansModal}
        onClose={() => setShowPlansModal(false)}
      />

      {/* Zero-Retention Shred Modal */}
      <ZeroRetentionShredModal
        isOpen={showShredModal}
        onClose={() => setShowShredModal(false)}
        projectId={projectId!}
        projectName={project?.name}
      />

      {/* Document Delete Confirmation In-App Modal */}
      {documentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 text-2xl shrink-0">
                🗑️
              </div>
              <div>
                <h3 className="text-base font-black text-slate-950">Delete Court Brief?</h3>
                <p className="text-xs text-slate-500 font-semibold">Remove this document from matter</p>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3.5 mb-5">
              <p className="text-xs font-bold text-slate-900 break-all leading-snug">
                📄 {documentToDelete.name}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                This document will be deleted from your workspace and will no longer appear in the dossier.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDocumentToDelete(null)}
                disabled={deleteDocument.isPending}
                className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async () => {
                  const targetId = documentToDelete.id
                  try {
                    await deleteDocument.mutateAsync(targetId)
                    if (activeDocument?.id === targetId) {
                      setActiveDocument(null)
                    }
                    if (secondaryDocument?.id === targetId) {
                      setSecondaryDocument(null)
                    }
                    setDocumentToDelete(null)
                  } catch (err) {
                    alert(apiErrorMessage(err, 'Could not delete the document.'))
                  }
                }}
                disabled={deleteDocument.isPending}
                className="flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 text-xs font-bold transition-all shadow-md cursor-pointer disabled:opacity-50"
              >
                {deleteDocument.isPending ? (
                  <>
                    <span className="h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    <span>Deleting Brief…</span>
                  </>
                ) : (
                  <span>Yes, Delete Document</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Courtroom Hearing Dais Mode (Full Screen Argument Dais) */}
      {hearingMode && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100">
          {/* Dais Top Bar */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-3 shadow-lg flex-wrap gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-purple-600/30 text-amber-300 font-bold border border-amber-500/30 text-lg shadow-sm">
                ⚖️
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-base font-black text-slate-100">
                    {project?.name ?? 'Court Case Workspace'}
                  </h1>
                  <span className="rounded bg-gradient-to-r from-purple-500/30 to-purple-600/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-purple-200 border border-purple-500/40">
                    Courtroom Dais
                  </span>
                </div>
                {activeDocument && (
                  <p className="truncate text-xs text-slate-400">
                    Argued Pleadings: <span className="text-cyan-300 font-semibold">{activeDocument.original_filename}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Document Selector */}
            {documents && documents.length > 1 && (
              <select
                value={activeDocument?.id ?? ''}
                onChange={(e) => {
                  const doc = documents.find((d) => d.id === e.target.value)
                  if (doc) setActiveDocument(doc)
                }}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 focus:border-cyan-500 max-w-[260px] truncate"
              >
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    📄 {d.original_filename}
                  </option>
                ))}
              </select>
            )}

            {/* Dais Controls */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                className={`rounded px-2.5 py-1 text-xs font-bold transition-colors ${
                  theme === 'light'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-300 hover:text-white border border-slate-700'
                }`}
              >
                {theme === 'light' ? '☀️ Paper' : '🌙 Dark'}
              </button>

              <div className="flex items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-950/80 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setFontSizeScale('normal')}
                  className={`rounded px-2 py-0.5 font-bold ${fontSizeScale === 'normal' ? 'bg-cyan-500/30 text-cyan-300' : 'text-slate-400'}`}
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => setFontSizeScale('large')}
                  className={`rounded px-2 py-0.5 font-bold ${fontSizeScale === 'large' ? 'bg-cyan-500/30 text-cyan-300' : 'text-slate-400'}`}
                >
                  A+
                </button>
                <button
                  type="button"
                  onClick={() => setFontSizeScale('jumbo')}
                  className={`rounded px-2 py-0.5 font-black ${fontSizeScale === 'jumbo' ? 'bg-cyan-500/30 text-cyan-200' : 'text-slate-400'}`}
                >
                  A++
                </button>
              </div>

              <Button
                variant="secondary"
                onClick={() => setHearingMode(false)}
                className="border-red-500/40 text-red-300 hover:bg-red-500/20 text-xs py-1.5 font-bold"
              >
                ✕ Exit Dais
              </Button>
            </div>
          </div>

          {/* Dais Main Area: Left PDF (62%), Right Dais Arguments (38%) */}
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden border-r border-slate-800">
              {activeDocument ? (
                <PdfViewer
                  documentId={activeDocument.id}
                  initialPage={focusPage}
                  onSaveExcerpt={handleSaveExcerpt}
                />
              ) : documents && documents[0] ? (
                <PdfViewer
                  documentId={documents[0].id}
                  initialPage={focusPage}
                  onSaveExcerpt={handleSaveExcerpt}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-400 text-sm">
                  No document uploaded in this matter yet.
                </div>
              )}
            </div>

            {/* Right Advocate Dais Panel */}
            <div className="w-[430px] max-w-[42%] shrink-0 flex flex-col bg-slate-900 overflow-hidden shadow-2xl">
              {/* Dais Tabs */}
              <div className="flex items-center border-b border-slate-800 bg-slate-950 p-1.5 text-xs gap-1">
                <button
                  type="button"
                  onClick={() => setHearingDaisTab('chronology')}
                  className={`flex-1 py-1.5 px-2 font-bold rounded text-center transition-colors ${
                    hearingDaisTab === 'chronology' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📅 Dates
                </button>
                <button
                  type="button"
                  onClick={() => setHearingDaisTab('issues')}
                  className={`flex-1 py-1.5 px-2 font-bold rounded text-center transition-colors ${
                    hearingDaisTab === 'issues' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ⚖️ Issues
                </button>
                <button
                  type="button"
                  onClick={() => setHearingDaisTab('exhibits')}
                  className={`flex-1 py-1.5 px-2 font-bold rounded text-center transition-colors ${
                    hearingDaisTab === 'exhibits' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🔍 Exhibits
                </button>
                <button
                  type="button"
                  onClick={() => setHearingDaisTab('contradictions')}
                  className={`flex-1 py-1.5 px-2 font-bold rounded text-center transition-colors ${
                    hearingDaisTab === 'contradictions' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ⚠️ Rebuttal
                </button>
                <button
                  type="button"
                  onClick={() => setHearingDaisTab('notes')}
                  className={`flex-1 py-1.5 px-2 font-bold rounded text-center transition-colors ${
                    hearingDaisTab === 'notes' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📝 Notes
                </button>
              </div>

              {/* Dais Tab Contents */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {hearingDaisTab === 'chronology' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Case Synopsis (1-Tap Jump)
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowChronologyModal(true)}
                        className="text-xs text-cyan-400 hover:underline"
                      >
                        + Add / View Full
                      </button>
                    </div>
                    {excerpts && excerpts.length > 0 ? (
                      excerpts.map((exc) => (
                        <div
                          key={exc.id}
                          className="rounded-xl border border-slate-800 bg-slate-950 p-3 hover:border-cyan-500/40 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-500/30">
                              Page {exc.page_number}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleNavigateToPage(exc.document_id, exc.page_number)}
                              className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30"
                            >
                              <span>Jump ➔</span>
                            </button>
                          </div>
                          <p className="text-xs text-slate-200 line-clamp-3 leading-relaxed">
                            "{exc.text}"
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        No excerpts tagged in this matter yet.
                      </p>
                    )}
                  </div>
                )}

                {hearingDaisTab === 'issues' && (
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-purple-300 uppercase tracking-wider block mb-1">
                      ⚖️ Questions of Law & Key Issues
                    </span>
                    {(excerpts ?? [])
                      .filter((e) => e.tags?.some((t) => t.name.toLowerCase().includes('issue')))
                      .map((exc) => (
                        <div
                          key={exc.id}
                          className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-bold text-purple-300">
                              PAGE {exc.page_number}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleNavigateToPage(exc.document_id, exc.page_number)}
                              className="rounded bg-purple-500/30 px-2 py-0.5 text-xs font-bold text-purple-200 hover:bg-purple-500/40"
                            >
                              Show Bench ➔
                            </button>
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed">"{exc.text}"</p>
                        </div>
                      ))}
                    {(excerpts ?? []).filter((e) => e.tags?.some((t) => t.name.toLowerCase().includes('issue'))).length === 0 && (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        Tag excerpts with ⚖️ Issue to show them here during arguments.
                      </p>
                    )}
                  </div>
                )}

                {hearingDaisTab === 'exhibits' && (
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-amber-300 uppercase tracking-wider block mb-1">
                      🔍 Marked Court Exhibits & Pleadings
                    </span>
                    {(excerpts ?? [])
                      .filter((e) => e.tags?.some((t) => t.name.toLowerCase().includes('exhibit')))
                      .map((exc) => (
                        <div
                          key={exc.id}
                          className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-bold text-amber-300">
                              EXHIBIT · PAGE {exc.page_number}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleNavigateToPage(exc.document_id, exc.page_number)}
                              className="rounded bg-amber-500/30 px-2 py-0.5 text-xs font-bold text-amber-200 hover:bg-amber-500/40"
                            >
                              Display ➔
                            </button>
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed">"{exc.text}"</p>
                        </div>
                      ))}
                    {(excerpts ?? []).filter((e) => e.tags?.some((t) => t.name.toLowerCase().includes('exhibit'))).length === 0 && (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        Tag excerpts with 🔍 Exhibit to show them here.
                      </p>
                    )}
                  </div>
                )}

                {hearingDaisTab === 'contradictions' && (
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-rose-300 uppercase tracking-wider block mb-1">
                      ⚠️ Contradictions for Cross-Examination
                    </span>
                    {(excerpts ?? [])
                      .filter((e) => e.tags?.some((t) => t.name.toLowerCase().includes('contradiction')))
                      .map((exc) => (
                        <div
                          key={exc.id}
                          className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-bold text-rose-300">
                              CROSS-EXAM · PAGE {exc.page_number}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleNavigateToPage(exc.document_id, exc.page_number)}
                              className="rounded bg-rose-500/30 px-2 py-0.5 text-xs font-bold text-rose-200 hover:bg-rose-500/40"
                            >
                              Confront ➔
                            </button>
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed">"{exc.text}"</p>
                        </div>
                      ))}
                    {(excerpts ?? []).filter((e) => e.tags?.some((t) => t.name.toLowerCase().includes('contradiction'))).length === 0 && (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        Tag excerpts with ⚠️ Contradiction to prepare cross-examination.
                      </p>
                    )}
                  </div>
                )}

                {hearingDaisTab === 'notes' && (
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-1">
                      📝 Oral Submissions & Case Notes
                    </span>
                    {(notes ?? []).map((note) => (
                      <div
                        key={note.id}
                        className="rounded-xl border border-slate-800 bg-slate-950 p-3"
                      >
                        <h4 className="text-xs font-bold text-cyan-300 mb-1">{note.title || 'Submission Note'}</h4>
                        <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{note.content}</p>
                      </div>
                    ))}
                    {(notes ?? []).length === 0 && (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        No argument notes recorded in this matter yet.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SearchResultSection({ title, children }: { title: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  if (items.every((c) => c === null || c === undefined || c === false)) return null

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function SearchResultCard({
  onClick,
  meta,
  snippet,
}: {
  onClick: () => void
  meta: string
  snippet?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md border border-slate-800 bg-slate-900 p-3 text-left text-sm hover:border-accent"
    >
      <p className="text-xs text-slate-500">{meta}</p>
      {snippet && <p className="mt-1 text-slate-200">{snippet}</p>}
    </button>
  )
}
