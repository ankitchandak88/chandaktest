import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import { getStroke } from 'perfect-freehand'
import { pdfjsLib } from '@/lib/pdf'
import { api } from '@/lib/api'
import { getSvgPathFromStroke } from '@/lib/freehand'
import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useSuggestHighlights,
  useSummarizeHighlights,
} from '@/lib/queries'
import type { Annotation, SourceRect } from '@/types/api'
import { Button } from '@/components/ui'

interface SelectionInfo {
  pageNumber: number
  text: string
  rects: SourceRect[]
  anchor: { x: number; y: number }
}

interface PdfViewerProps {
  documentId: string
  onSaveExcerpt: (selection: { pageNumber: number; text: string; rects: SourceRect[]; tag?: string }) => void
  // Phase 7: lets a search result deep-link straight to the page it was
  // found on, reusing the same scroll-into-view jumpToPage already used by
  // Outline/HiLiteView - not a new navigation mechanism, just a new caller.
  initialPage?: number
  // Mode-tabs restructuring: "Workspace" is a sibling top-level tab
  // (ProjectWorkspacePage's own WorkspaceCanvas), not something PdfViewer
  // can render itself - clicking it in the in-reader mode switch delegates
  // back up to the parent rather than PdfViewer owning that navigation.
  onSwitchToWorkspace?: () => void
}

type AnnotationTool = 'select' | 'comment' | 'pen' | 'highlighter' | 'eraser' | 'lasso'

// Drawing/Document/Workspace mode-tabs (matches the LiquidText reference
// screenshots the user compared against): "Workspace" switches to the
// sibling project-wide canvas tab (see onSwitchToWorkspace above);
// "Drawing" and "Document" both stay right here, just reprioritizing which
// tools are up front and which tool is active by default - nothing is
// ever hidden or removed, every tool stays reachable in both modes, since
// reducing functionality to make a toolbar look tidier would be a
// regression against "100x better than LiquidText, no compromise".
type ReaderMode = 'drawing' | 'document'

interface StrokePoint {
  x: number
  y: number
  pressure: number
}

interface InkPayload {
  points: [number, number, number][]
  size: number
  tool: 'pen' | 'highlighter'
}

interface CreateAnnotationInput {
  page_number: number
  type: Annotation['type']
  color?: string
  comment_text?: string
  payload: Record<string, unknown>
}

// Undo/redo for drawing actions: a single chronological stack per the
// usual editor convention (undoing an older entry out of order would risk
// operating on an id another, newer entry already changed - LIFO order
// guarantees whichever entry is being toggled is always the most recent
// thing that touched that annotation). `present` tracks whether the
// annotation currently exists server-side; `id` is only meaningful while
// `present` is true. Both undo and redo perform the exact same toggle
// (delete if present, recreate from `data` if not) - they only differ in
// which stack they pop from and push back onto.
interface UndoEntry {
  id: string
  present: boolean
  data: CreateAnnotationInput
}

interface OutlineNode {
  title: string
  pageNumber: number | null
  items: OutlineNode[]
}

type SidePanel = 'none' | 'outline' | 'hilite' | 'comments' | 'pages'

// Shared palette: amber for highlight matches the existing export-time
// highlight-overlay color (PdfHighlightOverlayGenerator's amber-400), so a
// highlight looks the same whether you're viewing it live or in an export.
const HIGHLIGHT_COLOR = '#facc15'
const UNDERLINE_COLOR = '#38bdf8'
const COMMENT_COLOR = '#f472b6'

// Default (first) color must be visible against a white PDF page - code
// review caught that both platforms defaulted to a near-white pen color,
// which made the very first stroke a new user draws effectively invisible.
const PEN_COLORS = ['#1e293b', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b']
const HIGHLIGHTER_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#fb923c']
const PEN_SIZE = 0.004
const HIGHLIGHTER_SIZE = 0.016

const ANNOTATION_HINT_STORAGE_KEY = 'chandaktext:annotation-toolbar-hint-dismissed'

// perfect-freehand's `size` option is in the same unit as the input
// points - since our points are 0-1 page-normalized, `size` must also be
// normalized (a fraction of page width) and denormalized back to pixels at
// render time, same as every other coordinate in this component.
function strokeToSvgPath(points: [number, number, number][], sizeFraction: number, pageSize: { width: number; height: number }) {
  const pixelPoints = points.map(([x, y, pressure]) => [x * pageSize.width, y * pageSize.height, pressure])
  const outline = getStroke(pixelPoints, {
    size: sizeFraction * pageSize.width,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  })
  return getSvgPathFromStroke(outline)
}

// Shortest distance from a point to the segment [a, b], not just to a and
// b themselves - code review caught that checking only the stroke's
// stored sample points let a fast/sparse stroke have a visually
// continuous middle span with no erase hit-test coverage at all.
function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  const closestX = a.x + t * dx
  const closestY = a.y + t * dy
  return Math.hypot(p.x - closestX, p.y - closestY)
}

// Standard ray-casting point-in-polygon test for the lasso tool.
function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function annotationAnchor(a: Annotation): { x: number; y: number } | null {
  if (a.type === 'highlight' || a.type === 'underline') {
    const rects = (a.payload.rects as SourceRect[] | undefined) ?? []
    if (!rects.length) return null
    const r = rects[0]
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }
  if (a.type === 'comment') {
    return { x: a.payload.x as number, y: a.payload.y as number }
  }
  if (a.type === 'ink') {
    const points = (a.payload.points as [number, number, number][] | undefined) ?? []
    if (!points.length) return null
    const mid = points[Math.floor(points.length / 2)]
    return { x: mid[0], y: mid[1] }
  }
  return null
}

/**
 * Renders every page of a document (fetched as a blob through the
 * authenticated API, never a public URL - docs/02 section 2.6 "keep storage
 * private") with PDF.js, overlays a real text layer so the browser's native
 * text selection works, and turns a selection into a normalized-rectangle
 * excerpt or annotation (docs/03 section 3.3: store rects in 0-1 page space
 * so zoom never breaks alignment). Annotations (highlight/underline/comment/
 * ink) persist via the Annotation API and render as a live overlay.
 *
 * Phase 2: real drawing tools. Pen/highlighter use perfect-freehand for
 * pressure-tapered, smooth strokes (one Annotation row per stroke, so erase
 * is just "delete that row"). Eraser hit-tests the pointer's path against
 * existing ink strokes/highlight rects live as you drag. Lasso is a
 * transient selection gesture (closed freehand path -> point-in-polygon
 * against every annotation's anchor point on the page), not a stored type.
 */
export default function PdfViewer({
  documentId,
  onSaveExcerpt,
  initialPage,
  onSwitchToWorkspace,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfDoc, setPdfDoc] = useState<Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']> | null>(
    null,
  )
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [scale] = useState(1.2)
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [readerMode, setReaderMode] = useState<ReaderMode>('document')
  const [readingTheme, setReadingTheme] = useState<'dark' | 'sepia' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('chandaktext:theme')
      return saved === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const t = document.documentElement.getAttribute('data-theme')
      if (t === 'light') setReadingTheme('light')
      else if (t === 'dark') setReadingTheme('dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Entering Drawing mode gets you drawing immediately (auto-picks the pen
  // if you weren't already using a drawing tool); entering Document mode
  // hands reading/selection back immediately (drops out of whatever
  // drawing tool was active) - matches the LiquidText reference
  // screenshots' mode-switch behavior. Comment is deliberately excluded
  // from both resets: it isn't a drawing tool and isn't disruptive to
  // reading, so switching modes shouldn't interrupt placing one.
  function switchReaderMode(mode: ReaderMode) {
    setReaderMode(mode)
    if (mode === 'drawing' && tool === 'select') {
      setTool('pen')
    } else if (mode === 'document' && (tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'lasso')) {
      setTool('select')
    }
  }

  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [highlighterColor, setHighlighterColor] = useState(HIGHLIGHTER_COLORS[0])
  const [pendingComment, setPendingComment] = useState<{
    pageNumber: number
    x: number
    y: number
    anchor: { x: number; y: number }
  } | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [openComment, setOpenComment] = useState<Annotation | null>(null)
  const [activeStroke, setActiveStroke] = useState<{ pageNumber: number; points: StrokePoint[] } | null>(null)
  const [lassoPoints, setLassoPoints] = useState<{ pageNumber: number; points: StrokePoint[] } | null>(null)
  const [lassoSelection, setLassoSelection] = useState<{ pageNumber: number; ids: string[] } | null>(null)
  const erasedThisDragRef = useRef<Set<string>>(new Set())
  const [sidePanel, setSidePanel] = useState<SidePanel>('none')
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [squeezeMode, setSqueezeMode] = useState<boolean>(false)
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set())

  // Advocate Court Paper-Book States (reorder pleadings, rotate scans, tag exhibits, exclude unneeded pages)
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({})
  const [pageLabels, setPageLabels] = useState<Record<number, string>>({})
  const [pageOrder, setPageOrder] = useState<number[]>([])
  const [excludedPages, setExcludedPages] = useState<Set<number>>(new Set())
  const [copyCitationSuccess, setCopyCitationSuccess] = useState(false)

  useEffect(() => {
    if (numPages > 0) {
      setPageOrder((prev) => (prev.length === numPages ? prev : Array.from({ length: numPages }, (_, i) => i + 1)))
    }
  }, [numPages])

  function rotatePage(pageNumber: number) {
    setPageRotations((prev) => {
      const cur = prev[pageNumber] ?? 0
      return { ...prev, [pageNumber]: (cur + 90) % 360 }
    })
  }

  function movePage(index: number, direction: 'up' | 'down') {
    setPageOrder((prev) => {
      const targetIdx = direction === 'up' ? index - 1 : index + 1
      if (targetIdx < 0 || targetIdx >= prev.length) return prev
      const next = [...prev]
      const temp = next[index]
      next[index] = next[targetIdx]
      next[targetIdx] = temp
      return next
    })
  }

  function toggleExcludePage(pageNumber: number) {
    setExcludedPages((prev) => {
      const next = new Set(prev)
      if (next.has(pageNumber)) {
        next.delete(pageNumber)
      } else {
        next.add(pageNumber)
      }
      return next
    })
  }

  function setPageLegalLabel(pageNumber: number, label: string) {
    setPageLabels((prev) => {
      if (!label.trim()) {
        const next = { ...prev }
        delete next[pageNumber]
        return next
      }
      return { ...prev, [pageNumber]: label.trim() }
    })
  }

  function resetPaperBook() {
    setPageOrder(Array.from({ length: numPages }, (_, i) => i + 1))
    setPageRotations({})
    setExcludedPages(new Set())
  }

  function toggleExpandRange(startPage: number, endPage: number) {
    setExpandedPages((prev) => {
      const next = new Set(prev)
      for (let p = startPage; p <= endPage; p++) {
        if (next.has(p)) {
          next.delete(p)
        } else {
          next.add(p)
        }
      }
      return next
    })
  }

  // Phase 5 (discoverability): the drawing engine is real and fully built,
  // but nothing on the page points at it - a first-time user has no reason
  // to notice Pen/Highlighter/Lasso exist. Shown once, globally (not
  // per-document - it's introducing the toolbar itself, not this PDF), then
  // never again on this browser.
  const [showAnnotationHint, setShowAnnotationHint] = useState(() => {
    try {
      return localStorage.getItem(ANNOTATION_HINT_STORAGE_KEY) !== '1'
    } catch {
      return true
    }
  })
  const dismissAnnotationHint = useCallback(() => {
    setShowAnnotationHint(false)
    try {
      localStorage.setItem(ANNOTATION_HINT_STORAGE_KEY, '1')
    } catch {
      // Private-browsing/blocked storage: dismissal just won't persist
      // across reloads, which is a harmless degradation, not a bug.
    }
  }, [])

  const { data: annotations } = useAnnotations(documentId)
  const createAnnotation = useCreateAnnotation(documentId)
  const deleteAnnotation = useDeleteAnnotation(documentId)

  // Undo/redo for drawing actions - see UndoEntry's docblock.
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([])

  function recordCreate(data: CreateAnnotationInput, created: Annotation) {
    setRedoStack([])
    setUndoStack((s) => [...s, { id: created.id, present: true, data }])
  }

  function recordDelete(annotation: Annotation) {
    setRedoStack([])
    setUndoStack((s) => [
      ...s,
      {
        id: annotation.id,
        present: false,
        data: {
          page_number: annotation.page_number,
          type: annotation.type,
          color: annotation.color ?? undefined,
          comment_text: annotation.comment_text ?? undefined,
          payload: annotation.payload,
        },
      },
    ])
  }

  async function toggleEntry(entry: UndoEntry): Promise<UndoEntry> {
    if (entry.present) {
      await deleteAnnotation.mutateAsync(entry.id)
      return { ...entry, present: false }
    }
    const created = await createAnnotation.mutateAsync(entry.data)
    return { ...entry, id: created.id, present: true }
  }

  async function handleUndo() {
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    const toggled = await toggleEntry(entry)
    setUndoStack((s) => s.slice(0, -1))
    setRedoStack((s) => [...s, toggled])
  }

  async function handleRedo() {
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return
    const toggled = await toggleEntry(entry)
    setRedoStack((s) => s.slice(0, -1))
    setUndoStack((s) => [...s, toggled])
  }

  // Phase 6 (AI annotation assistance): both suggest-only / read-only -
  // summarizing synthesizes the highlights that already exist, suggesting
  // just surfaces candidate passages as text for the reader to go find and
  // highlight themselves (no bounding-box info comes back from the model,
  // so there's nothing to auto-apply even if we wanted to).
  const summarizeHighlights = useSummarizeHighlights()
  const suggestHighlights = useSuggestHighlights()
  const [highlightsSummary, setHighlightsSummary] = useState<string | null>(null)
  const [suggestedHighlights, setSuggestedHighlights] = useState<string[] | null>(null)

  // Phase 7: jump to the requested page once pages have actually rendered
  // (pdfDoc truthy means numPages/PdfPage elements exist for jumpToPage's
  // DOM query to find) - re-runs if the caller passes a new initialPage
  // while already viewing this same document (e.g. clicking a second
  // search result for the same PDF).
  useEffect(() => {
    if (pdfDoc && initialPage) {
      jumpToPage(initialPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, initialPage])

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const a of annotations ?? []) {
      const list = map.get(a.page_number) ?? []
      list.push(a)
      map.set(a.page_number, list)
    }
    return map
  }, [annotations])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await api.get(`/documents/${documentId}/download`, {
          responseType: 'arraybuffer',
        })
        // Pass raw bytes rather than an object: URL - some Chrome builds
        // (including the one this project was built/tested against) don't
        // yet implement the `URL.parse()` static method pdf.js's URL-based
        // loader path relies on, which throws "URL.parse is not a
        // function". Loading from `data` skips that code path entirely.
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(response.data) }).promise
        if (!cancelled) {
          setPdfDoc(doc)
          setNumPages(doc.numPages)
        }

        // Outline (Phase 3): pdf.js's own bookmark/TOC tree. `dest` can be a
        // named destination (string, needs resolving via getDestination) or
        // an explicit [ref, ...] array already - either way it resolves to
        // a page *index* (0-based) via getPageIndex, +1 for this app's
        // 1-based page_number convention everywhere else.
        async function resolveDest(dest: string | unknown[] | null): Promise<number | null> {
          try {
            const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
            if (!explicit || !Array.isArray(explicit)) return null
            const pageIndex = await doc.getPageIndex(explicit[0])
            return pageIndex + 1
          } catch {
            return null
          }
        }

        async function resolveOutline(
          nodes: { title: string; dest: string | unknown[] | null; items: unknown[] }[],
        ): Promise<OutlineNode[]> {
          return Promise.all(
            nodes.map(async (node) => ({
              title: node.title,
              pageNumber: await resolveDest(node.dest),
              items: await resolveOutline(node.items as typeof nodes),
            })),
          )
        }

        const rawOutline = await doc.getOutline()
        if (!cancelled && rawOutline) {
          setOutline(await resolveOutline(rawOutline))
        }
      } catch (err) {
        console.error('[PdfViewer] failed to load', err)
        if (!cancelled) setError('Could not load this PDF.')
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [documentId])

  const handleMouseUp = useCallback(
    (pageNumber: number, pageEl: HTMLDivElement) => {
      if (tool !== 'select') return

      const sel = window.getSelection()

      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null)
        return
      }

      const text = sel.toString().trim()
      if (!text) {
        setSelection(null)
        return
      }

      const range = sel.getRangeAt(0)
      const pageRect = pageEl.getBoundingClientRect()
      const clientRects = Array.from(range.getClientRects())

      if (clientRects.length === 0) return

      // Normalize every rect to 0-1 page space so re-rendering at a different
      // zoom/scale never breaks the stored coordinates.
      const rects: SourceRect[] = clientRects.map((r) => ({
        x: (r.left - pageRect.left) / pageRect.width,
        y: (r.top - pageRect.top) / pageRect.height,
        width: r.width / pageRect.width,
        height: r.height / pageRect.height,
      }))

      const first = clientRects[0]

      // BUG-002 fix: the popup used to render at a hardcoded {left:32, top:32}
      // regardless of where the selection actually was. `first`/`pageRect` are
      // viewport-relative (getBoundingClientRect), but the popup is an
      // absolutely-positioned child of the *scrollable* containerRef, where
      // top/left mean "pixels from the top of the scrollable content", not
      // "pixels from the visible viewport". Converting through
      // containerRef's own rect + its current scroll offset gives a position
      // that's correct both right now and if the container is scrolled
      // further (the content coordinate doesn't change, only what's visible
      // does).
      const container = containerRef.current
      let anchorX = first.left - pageRect.left
      let anchorY = first.top - pageRect.top

      if (container) {
        const containerRect = container.getBoundingClientRect()
        anchorX += pageRect.left - containerRect.left + container.scrollLeft
        anchorY += pageRect.top - containerRect.top + container.scrollTop
      }

      setSelection({
        pageNumber,
        text,
        rects,
        anchor: { x: anchorX, y: anchorY },
      })
    },
    [tool],
  )

  const handlePageClick = useCallback(
    (pageNumber: number, pageEl: HTMLDivElement, e: React.MouseEvent) => {
      if (tool !== 'comment') return

      const pageRect = pageEl.getBoundingClientRect()
      const x = (e.clientX - pageRect.left) / pageRect.width
      const y = (e.clientY - pageRect.top) / pageRect.height

      const container = containerRef.current
      let anchorX = e.clientX - pageRect.left
      let anchorY = e.clientY - pageRect.top

      if (container) {
        const containerRect = container.getBoundingClientRect()
        anchorX += pageRect.left - containerRect.left + container.scrollLeft
        anchorY += pageRect.top - containerRect.top + container.scrollTop
      }

      setPendingComment({ pageNumber, x, y, anchor: { x: anchorX, y: anchorY } })
      setCommentDraft('')
    },
    [tool],
  )

  // Scroll/resize invalidates the popup's anchor coordinates (BUG-002:
  // "reposition after scroll/resize"). Re-deriving the exact position live
  // would mean re-walking the selection geometry on every scroll event;
  // dismissing the popup instead is simpler and never shows it in the wrong
  // place - the user just re-selects, which also re-confirms the text is
  // still what they meant to save.
  useEffect(() => {
    const container = containerRef.current
    if (!container || (!selection && !pendingComment)) return

    const dismiss = () => {
      setSelection(null)
      setPendingComment(null)
    }
    container.addEventListener('scroll', dismiss)
    window.addEventListener('resize', dismiss)

    return () => {
      container.removeEventListener('scroll', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [selection, pendingComment])

  function confirmExcerpt(tag?: string) {
    if (!selection) return
    onSaveExcerpt({ pageNumber: selection.pageNumber, text: selection.text, rects: selection.rects, tag })
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  function confirmLegalExcerpt(tag: string) {
    confirmExcerpt(tag)
  }

  function confirmHighlight(type: 'highlight' | 'underline') {
    if (!selection) return
    const input: CreateAnnotationInput = {
      page_number: selection.pageNumber,
      type,
      color: type === 'highlight' ? HIGHLIGHT_COLOR : UNDERLINE_COLOR,
      payload: { rects: selection.rects, text: selection.text },
    }
    createAnnotation.mutate(input, { onSuccess: (created) => recordCreate(input, created) })
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  function confirmComment() {
    if (!pendingComment || !commentDraft.trim()) {
      setPendingComment(null)
      return
    }
    const input: CreateAnnotationInput = {
      page_number: pendingComment.pageNumber,
      type: 'comment',
      color: COMMENT_COLOR,
      comment_text: commentDraft.trim(),
      payload: { x: pendingComment.x, y: pendingComment.y },
    }
    createAnnotation.mutate(input, { onSuccess: (created) => recordCreate(input, created) })
    setPendingComment(null)
    setCommentDraft('')
    setTool('select')
  }

  const handleStrokeStart = useCallback(
    (pageNumber: number, point: StrokePoint) => {
      if (tool === 'pen' || tool === 'highlighter') {
        setActiveStroke({ pageNumber, points: [point] })
      } else if (tool === 'lasso') {
        setLassoPoints({ pageNumber, points: [point] })
      } else if (tool === 'eraser') {
        erasedThisDragRef.current = new Set()
      }
    },
    [tool],
  )

  const handleStrokeMove = useCallback(
    (pageNumber: number, point: StrokePoint, pageAnnotations: Annotation[], pageSize: { width: number; height: number }) => {
      if ((tool === 'pen' || tool === 'highlighter') && activeStroke?.pageNumber === pageNumber) {
        setActiveStroke((prev) => (prev ? { ...prev, points: [...prev.points, point] } : prev))
      } else if (tool === 'lasso' && lassoPoints?.pageNumber === pageNumber) {
        setLassoPoints((prev) => (prev ? { ...prev, points: [...prev.points, point] } : prev))
      } else if (tool === 'eraser') {
        const thresholdPx = 14
        for (const a of pageAnnotations) {
          if (erasedThisDragRef.current.has(a.id)) continue

          let hit = false
          if (a.type === 'ink') {
            const points = (a.payload.points as [number, number, number][] | undefined) ?? []
            const pixelPoints = points.map(([px, py]) => ({ x: px * pageSize.width, y: py * pageSize.height }))
            const pointerPx = { x: point.x * pageSize.width, y: point.y * pageSize.height }
            // Distance to each *segment*, not just each stored sample
            // point - a fast/sparse stroke can have a visually continuous
            // span between two stored points that's nowhere near either
            // point itself.
            hit = pixelPoints.some(
              (p, i) => i > 0 && distanceToSegment(pointerPx, pixelPoints[i - 1], p) < thresholdPx,
            )
          } else if (a.type === 'highlight' || a.type === 'underline') {
            const rects = (a.payload.rects as SourceRect[] | undefined) ?? []
            hit = rects.some(
              (r) => point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height,
            )
          }

          if (hit) {
            erasedThisDragRef.current.add(a.id)
            deleteAnnotation.mutate(a.id)
            recordDelete(a)
          }
        }
      }
    },
    [tool, activeStroke, lassoPoints, deleteAnnotation],
  )

  const handleStrokeEnd = useCallback(
    (pageAnnotations: Annotation[]) => {
      if ((tool === 'pen' || tool === 'highlighter') && activeStroke && activeStroke.points.length > 1) {
        const payload: InkPayload = {
          points: activeStroke.points.map((p) => [p.x, p.y, p.pressure]),
          size: tool === 'pen' ? PEN_SIZE : HIGHLIGHTER_SIZE,
          tool,
        }
        const input: CreateAnnotationInput = {
          page_number: activeStroke.pageNumber,
          type: 'ink',
          color: tool === 'pen' ? penColor : highlighterColor,
          payload: payload as unknown as Record<string, unknown>,
        }
        createAnnotation.mutate(input, { onSuccess: (created) => recordCreate(input, created) })
      }
      setActiveStroke(null)

      if (tool === 'lasso' && lassoPoints && lassoPoints.points.length > 2) {
        const polygon = lassoPoints.points
        const ids = pageAnnotations
          .filter((a) => {
            const anchor = annotationAnchor(a)
            return anchor && pointInPolygon(anchor, polygon)
          })
          .map((a) => a.id)

        setLassoSelection(ids.length > 0 ? { pageNumber: lassoPoints.pageNumber, ids } : null)
      }
      setLassoPoints(null)
    },
    [tool, activeStroke, lassoPoints, createAnnotation, penColor, highlighterColor],
  )

  function deleteLassoSelection() {
    if (!lassoSelection) return
    for (const id of lassoSelection.ids) {
      const annotation = annotations?.find((a) => a.id === id)
      deleteAnnotation.mutate(id)
      if (annotation) recordDelete(annotation)
    }
    setLassoSelection(null)
  }

  function jumpToPage(pageNumber: number) {
    containerRef.current
      ?.querySelector(`[data-page-number="${pageNumber}"]`)
      ?.scrollIntoView({ block: 'start' })
  }

  // HiLiteView (Phase 3): every highlight-type annotation across the whole
  // document, using the text already captured at creation time (see
  // confirmHighlight) - no reverse rect-to-text mapping needed, no new
  // backend endpoint.
  const highlightList = useMemo(
    () =>
      (annotations ?? [])
        .filter((a) => a.type === 'highlight')
        .sort((a, b) => a.page_number - b.page_number),
    [annotations],
  )

  const commentList = useMemo(
    () =>
      (annotations ?? [])
        .filter((a) => a.type === 'comment')
        .sort((a, b) => a.page_number - b.page_number),
    [annotations],
  )

  type PageSegment =
    | { type: 'page'; pageNumber: number }
    | { type: 'collapsed'; startPage: number; endPage: number; count: number }

  const pageSegments: PageSegment[] = useMemo(() => {
    const activeOrder = (pageOrder.length === numPages ? pageOrder : Array.from({ length: numPages }, (_, i) => i + 1))
      .filter((p) => !excludedPages.has(p))

    if (!squeezeMode || activeOrder.length === 0) {
      return activeOrder.map((p) => ({ type: 'page' as const, pageNumber: p }))
    }

    const segments: PageSegment[] = []
    let collapsedCount = 0
    let collapsedStart: number | null = null
    let collapsedEnd: number | null = null

    for (const p of activeOrder) {
      const hasAnnotations = (annotationsByPage.get(p)?.length ?? 0) > 0
      const isManuallyExpanded = expandedPages.has(p)

      if (hasAnnotations || isManuallyExpanded) {
        if (collapsedCount > 0 && collapsedStart !== null && collapsedEnd !== null) {
          segments.push({
            type: 'collapsed',
            startPage: collapsedStart,
            endPage: collapsedEnd,
            count: collapsedCount,
          })
          collapsedCount = 0
          collapsedStart = null
          collapsedEnd = null
        }
        segments.push({ type: 'page', pageNumber: p })
      } else {
        if (collapsedStart === null) collapsedStart = p
        collapsedEnd = p
        collapsedCount++
      }
    }

    if (collapsedCount > 0 && collapsedStart !== null && collapsedEnd !== null) {
      segments.push({
        type: 'collapsed',
        startPage: collapsedStart,
        endPage: collapsedEnd,
        count: collapsedCount,
      })
    }

    return segments
  }, [squeezeMode, numPages, pageOrder, excludedPages, annotationsByPage, expandedPages])

  if (error) {
    return <p className="p-4 text-sm text-red-400">{error}</p>
  }

  const drawingToolActive = tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'lasso'

  return (
    <div className="flex h-full flex-col">
      {showAnnotationHint && (
        <div className="flex items-center gap-3 border-b border-cyan-500/20 bg-cyan-500/[0.07] px-4 py-2 text-xs text-cyan-100">
          <span className="text-base leading-none" aria-hidden="true">
            ✨
          </span>
          <p className="flex-1 leading-snug">
            New: draw, highlight, and annotate the page directly with{' '}
            <span className="font-medium text-cyan-300">Pen</span>,{' '}
            <span className="font-medium text-cyan-300">Highlighter</span>, and{' '}
            <span className="font-medium text-cyan-300">Lasso</span> in the Drawing tab below.
          </p>
          <button
            type="button"
            onClick={dismissAnnotationHint}
            className="shrink-0 rounded px-1.5 py-0.5 text-cyan-300/70 transition-colors hover:bg-cyan-500/10 hover:text-cyan-200"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {sidePanel !== 'none' && (
          <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-200/90 bg-white p-3.5 shadow-xs text-slate-800">
            {sidePanel === 'outline' &&
              (outline.length === 0 ? (
                <p className="text-xs text-slate-500">This PDF has no table of contents.</p>
              ) : (
                <OutlineList nodes={outline} onJump={jumpToPage} />
              ))}

            {sidePanel === 'hilite' && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 border-b border-slate-200 pb-3">
                  <button
                    type="button"
                    disabled={summarizeHighlights.isPending}
                    onClick={() =>
                      summarizeHighlights.mutate(documentId, {
                        onSuccess: (summary) => setHighlightsSummary(summary),
                      })
                    }
                    className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors shadow-xs"
                  >
                    {summarizeHighlights.isPending ? 'Summarizing…' : '✨ AI: Summarize my highlights'}
                  </button>
                  {highlightsSummary && (
                    <p className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-xs leading-relaxed text-slate-700">
                      {highlightsSummary}
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={suggestHighlights.isPending}
                    onClick={() =>
                      suggestHighlights.mutate(documentId, {
                        onSuccess: (suggestions) => setSuggestedHighlights(suggestions),
                      })
                    }
                    className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors shadow-xs"
                  >
                    {suggestHighlights.isPending ? 'Thinking…' : '✨ AI: Suggest highlights'}
                  </button>
                  {suggestedHighlights && (
                    <div className="flex flex-col gap-1.5">
                      {suggestedHighlights.length === 0 ? (
                        <p className="text-xs text-slate-500">No suggestions found.</p>
                      ) : (
                        <>
                          <p className="text-[10px] text-slate-500 font-medium">
                            Find and select these passages to highlight them yourself:
                          </p>
                          {suggestedHighlights.map((s, i) => (
                            <p key={i} className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-xs leading-snug text-slate-700">
                              “{s}”
                            </p>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {highlightList.length === 0 ? (
                  <p className="text-xs text-slate-500">No highlights yet - select text and choose Highlight.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {highlightList.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => jumpToPage(a.page_number)}
                          className="w-full rounded-xl border border-slate-200/80 border-l-4 bg-slate-50 p-2.5 text-left text-xs text-slate-800 hover:bg-slate-100 transition-colors shadow-xs"
                          style={{ borderLeftColor: a.color ?? HIGHLIGHT_COLOR }}
                        >
                          <span className="block text-[10px] font-semibold text-slate-500">Page {a.page_number}</span>
                          {(a.payload.text as string | undefined) ?? ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {sidePanel === 'comments' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Comments ({commentList.length})
                  </h3>
                  <span className="text-[10px] text-slate-500">Click to jump</span>
                </div>

                {commentList.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No comments yet — in Document mode, select Comment and click anywhere on the page to leave one.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {commentList.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            jumpToPage(c.page_number)
                            setOpenComment(c)
                          }}
                          className="w-full rounded-xl border border-slate-200/80 border-l-4 bg-slate-50 p-2.5 text-left text-xs text-slate-800 transition-colors hover:bg-slate-100 shadow-xs"
                          style={{ borderLeftColor: c.color ?? COMMENT_COLOR }}
                        >
                          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                            <span className="font-bold text-rose-600">Page {c.page_number}</span>
                            <span className="text-[10px] text-slate-400">Open 💬</span>
                          </div>
                          <p className="line-clamp-3 font-normal leading-snug text-slate-700">{c.comment_text}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {sidePanel === 'pages' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-700">
                      <span>⚖️</span>
                      <span>Paper-Book Manager</span>
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      {pageOrder.length - excludedPages.size} of {numPages} pages active
                    </p>
                  </div>
                  {(pageOrder.some((p, i) => p !== i + 1) || Object.keys(pageRotations).length > 0 || excludedPages.size > 0) && (
                    <button
                      type="button"
                      onClick={resetPaperBook}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-700 transition-colors hover:bg-slate-200 border border-slate-200"
                      title="Reset pages to original document order and 0° rotation"
                    >
                      ↺ Reset
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-[11px] leading-relaxed text-amber-900">
                  <span className="font-bold text-amber-800">Advocate Court Tool:</span> Reorder pleadings, rotate inverted scans, assign exhibit stamps, or exclude unneeded pages for courtroom presentation.
                </div>

                <div className="flex flex-col gap-2.5">
                  {(pageOrder.length === numPages ? pageOrder : Array.from({ length: numPages }, (_, i) => i + 1)).map((p, idx) => {
                    const pageAnnos = annotationsByPage.get(p) ?? []
                    const isExcluded = excludedPages.has(p)
                    const rot = pageRotations[p] ?? 0
                    const label = pageLabels[p]

                    return (
                      <div
                        key={p}
                        className={`rounded-xl border p-2.5 transition-all shadow-xs ${
                          isExcluded
                            ? 'border-red-200 bg-red-50/60 opacity-60'
                            : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-700">
                              #{idx + 1}
                            </span>
                            <span className="text-xs font-bold text-slate-800">Page {p}</span>
                            {rot > 0 && (
                              <span className="rounded bg-sky-500/20 px-1 text-[9px] font-semibold text-sky-300">
                                ↻ {rot}°
                              </span>
                            )}
                            {pageAnnos.length > 0 && (
                              <span className="rounded-full bg-cyan-500/20 px-1.5 text-[9px] font-semibold text-cyan-300">
                                {pageAnnos.length} {pageAnnos.length === 1 ? 'item' : 'items'}
                              </span>
                            )}
                          </div>
                          {isExcluded && (
                            <span className="rounded bg-red-500/20 px-1.5 text-[9px] font-semibold text-red-300">
                              Excluded
                            </span>
                          )}
                        </div>

                        {/* Exhibit / Court Label */}
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {label ? (
                            <div className="flex items-center gap-1 rounded-md bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-900 shadow-xs">
                              <span>⚖️ {label}</span>
                              <button
                                type="button"
                                onClick={() => setPageLegalLabel(p, '')}
                                className="ml-1 text-amber-600 hover:text-amber-900 cursor-pointer"
                                title="Remove label"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {['Petition', 'Order', 'Exh. P-1', 'Exh. D-1', 'Annexure', 'Affidavit'].map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => setPageLegalLabel(p, preset)}
                                  className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-slate-600 transition-colors hover:border-amber-400 hover:text-amber-800 hover:bg-amber-50 cursor-pointer"
                                >
                                  +{preset}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => movePage(idx, 'up')}
                              className="rounded-lg bg-slate-200/70 p-1 text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-30 cursor-pointer"
                              title="Move page up in Paper-Book"
                            >
                              ⬆
                            </button>
                            <button
                              type="button"
                              disabled={idx === (pageOrder.length || numPages) - 1}
                              onClick={() => movePage(idx, 'down')}
                              className="rounded-lg bg-slate-200/70 p-1 text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-30 cursor-pointer"
                              title="Move page down in Paper-Book"
                            >
                              ⬇
                            </button>
                            <button
                              type="button"
                              onClick={() => rotatePage(p)}
                              className="rounded-lg bg-slate-200/70 px-2 py-1 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-300 cursor-pointer"
                              title="Rotate 90 degrees clockwise"
                            >
                              ↻ 90°
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleExcludePage(p)}
                              className={`rounded-lg px-2 py-1 text-[10px] font-bold transition-colors cursor-pointer ${
                                isExcluded
                                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                                  : 'bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300'
                              }`}
                              title={isExcluded ? 'Include back in Paper-Book' : 'Exclude from Paper-Book'}
                            >
                              {isExcluded ? 'Include' : 'Exclude'}
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => jumpToPage(p)}
                            className="rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-[10px] font-bold text-blue-700 transition-colors hover:bg-blue-100 cursor-pointer"
                          >
                            Jump →
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

      <div
        ref={containerRef}
        className={`relative flex-1 overflow-auto p-4 transition-colors duration-300 ${
          readingTheme === 'sepia'
            ? 'bg-[#f4ecd8] text-[#433422]'
            : readingTheme === 'light'
              ? 'bg-slate-100 text-slate-900'
              : 'bg-slate-900 text-slate-100'
        }`}
      >
        {!pdfDoc && <p className="text-sm text-slate-400">Loading PDF…</p>}

        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {squeezeMode && (
            <div
              className={`sticky top-0 z-10 flex items-center justify-between rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-md transition-all ${
                readingTheme === 'sepia'
                  ? 'border-[#b45309]/50 bg-[#fffbeb] text-[#451a03]'
                  : readingTheme === 'dark'
                    ? 'border-amber-500/40 bg-amber-950/40 text-amber-200'
                    : 'border-amber-300 bg-amber-50 text-amber-950'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🤏</span>
                <div>
                  <span
                    className={`text-xs font-black tracking-tight ${
                      readingTheme === 'sepia'
                        ? 'text-[#78350f]'
                        : readingTheme === 'dark'
                          ? 'text-amber-300'
                          : 'text-amber-900'
                    }`}
                  >
                    Squeeze Mode Active
                  </span>
                  <p
                    className={`text-[11px] font-semibold leading-snug ${
                      readingTheme === 'sepia'
                        ? 'text-[#92400e]'
                        : readingTheme === 'dark'
                          ? 'text-amber-200/80'
                          : 'text-amber-800'
                    }`}
                  >
                    Unhighlighted pages collapsed so your notes and highlights meet side-by-side
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedPages(new Set())}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all shadow-2xs cursor-pointer ${
                    readingTheme === 'sepia'
                      ? 'bg-[#b45309] text-white hover:bg-[#92400e]'
                      : readingTheme === 'dark'
                        ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                        : 'bg-amber-200/90 text-amber-950 hover:bg-amber-300'
                  }`}
                >
                  Collapse All
                </button>
                <button
                  type="button"
                  onClick={() => setSqueezeMode(false)}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-black cursor-pointer shadow-2xs"
                >
                  Exit Squeeze
                </button>
              </div>
            </div>
          )}

          {pdfDoc &&
            pageSegments.map((segment) => {
              if (segment.type === 'collapsed') {
                return (
                  <div
                    key={`collapsed-${segment.startPage}-${segment.endPage}`}
                    onClick={() => toggleExpandRange(segment.startPage, segment.endPage)}
                    className={`group flex cursor-pointer items-center justify-between rounded-2xl border-2 border-dashed px-4 py-3.5 shadow-sm transition-all active:scale-[0.99] ${
                      readingTheme === 'sepia'
                        ? 'border-[#b45309]/50 bg-[#eedcb4] text-[#451a03] hover:bg-[#e4d1a3]'
                        : readingTheme === 'dark'
                          ? 'border-cyan-500/40 bg-slate-800/80 text-slate-100 hover:bg-slate-800'
                          : 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-blue-50/40'
                    }`}
                    title="Click to expand these unannotated pages"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-extrabold ${
                          readingTheme === 'sepia'
                            ? 'bg-[#b45309] text-white'
                            : readingTheme === 'dark'
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        ↕
                      </span>
                      <div>
                        <span
                          className={`text-xs font-extrabold ${
                            readingTheme === 'sepia'
                              ? 'text-[#451a03]'
                              : readingTheme === 'dark'
                                ? 'text-slate-100'
                                : 'text-slate-900'
                          }`}
                        >
                          Pages {segment.startPage}{segment.startPage === segment.endPage ? '' : `–${segment.endPage}`} Collapsed
                        </span>
                        <p
                          className={`text-[11px] font-medium ${
                            readingTheme === 'sepia'
                              ? 'text-[#78350f]'
                              : readingTheme === 'dark'
                                ? 'text-slate-400'
                                : 'text-slate-500'
                          }`}
                        >
                          {segment.count} {segment.count === 1 ? 'page' : 'pages'} with no annotations
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold shadow-2xs ${
                        readingTheme === 'sepia'
                          ? 'bg-[#78350f] text-white hover:bg-[#451a03]'
                          : readingTheme === 'dark'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'bg-blue-600 text-white'
                      }`}
                    >
                      Expand ＋
                    </span>
                  </div>
                )
              }

              const pageNumber = segment.pageNumber
              return (
                <PdfPage
                  key={pageNumber}
                  pdfDoc={pdfDoc}
                  theme={readingTheme}
                  pageNumber={pageNumber}
                  scale={scale}
                  rotation={pageRotations[pageNumber] ?? 0}
                  label={pageLabels[pageNumber]}
                  onMouseUp={handleMouseUp}
                  onPageClick={handlePageClick}
                  tool={tool}
                  drawingToolActive={drawingToolActive}
                  annotations={annotationsByPage.get(pageNumber) ?? []}
                  onOpenComment={setOpenComment}
                  onDeleteAnnotation={(id) => {
                    const annotation = annotations?.find((a) => a.id === id)
                    deleteAnnotation.mutate(id)
                    if (annotation) recordDelete(annotation)
                  }}
                  activeStroke={activeStroke?.pageNumber === pageNumber ? activeStroke.points : null}
                  activeStrokeColor={tool === 'pen' ? penColor : highlighterColor}
                  activeStrokeSize={tool === 'pen' ? PEN_SIZE : HIGHLIGHTER_SIZE}
                  lassoPoints={lassoPoints?.pageNumber === pageNumber ? lassoPoints.points : null}
                  lassoSelection={lassoSelection?.pageNumber === pageNumber ? lassoSelection.ids : []}
                  onStrokeStart={handleStrokeStart}
                  onStrokeMove={handleStrokeMove}
                  onStrokeEnd={handleStrokeEnd}
                />
              )
            })}
        </div>

        {selection &&
          (() => {
            const containerWidth = containerRef.current?.clientWidth ?? 800
            // The popup has 9 action buttons and is around 660px wide
            const popupWidth = 660
            // Use available space ahead/left by centering over selection anchor and clamping safely
            const idealLeft = selection.anchor.x - popupWidth / 2
            const maxLeft = Math.max(16, containerWidth - popupWidth - 24)
            const left = containerWidth > 0 ? Math.max(16, Math.min(idealLeft, maxLeft)) : selection.anchor.x
            const top = Math.max(selection.anchor.y - 12, 12)

            return (
              <div
                className="absolute z-30 flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur-md text-slate-800 max-w-[calc(100%-32px)]"
                style={{ left, top }}
              >
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'application/json',
                      JSON.stringify({
                        type: 'chandaktext/excerpt',
                        documentId,
                        pageNumber: selection.pageNumber,
                        text: selection.text,
                        rects: selection.rects,
                      }),
                    )
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => confirmExcerpt()}
                  className="flex cursor-grab items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-all hover:from-blue-700 hover:to-indigo-700 active:cursor-grabbing active:scale-95 cursor-pointer"
                  title="Drag directly to workspace canvas on the right, or click to add"
                >
                  <span>✋ Excerpt</span>
                  <span className="rounded bg-white/20 px-1 text-[9px] font-medium uppercase tracking-wider text-white">
                    Drag ➜
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => confirmHighlight('highlight')}
                  className="rounded-xl px-2.5 py-1.5 text-xs font-bold text-amber-950 bg-amber-300 hover:bg-amber-400 border border-amber-400/60 shadow-xs transition-colors cursor-pointer"
                >
                  Highlight
                </button>
                <button
                  type="button"
                  onClick={() => confirmHighlight('underline')}
                  className="rounded-xl border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 transition-colors cursor-pointer"
                >
                  Underline
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selection) return
                    const quote = `"${selection.text}" — Page ${selection.pageNumber} (ChandakText Court Workspace)`
                    navigator.clipboard.writeText(quote)
                    setCopyCitationSuccess(true)
                    setTimeout(() => setCopyCitationSuccess(false), 2000)
                  }}
                  className="flex items-center gap-1 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200/80 px-2.5 py-1.5 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                  title="1-Tap copy formatted legal quote with page reference for court submissions"
                >
                  <span>📋</span>
                  <span>{copyCitationSuccess ? '✓ Copied!' : 'Citation'}</span>
                </button>
                <div className="flex items-center gap-1 border-l border-slate-200 pl-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selection) return
                      const eventDate = window.prompt('Enter Event Date for Chronology (e.g. 14/03/2022 or 2022-03-14):', '')
                      if (eventDate !== null) {
                        const tag = eventDate.trim() ? `Date: ${eventDate.trim()}` : 'Chronology'
                        confirmLegalExcerpt(tag)
                      }
                    }}
                    className="rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-800 transition-colors cursor-pointer"
                    title="Advocate: Pin to Case Chronology / List of Dates"
                  >
                    📅 Chronology
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmLegalExcerpt('Issue')}
                    className="rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2 py-1 text-xs font-semibold text-purple-800 transition-colors cursor-pointer"
                    title="Advocate: Tag as Legal Issue / Question of Law"
                  >
                    ⚖️ Issue
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmLegalExcerpt('Precedent')}
                    className="rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-800 transition-colors cursor-pointer"
                    title="Advocate: Tag as Legal Citation / Precedent"
                  >
                    📜 Precedent
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmLegalExcerpt('Exhibit')}
                    className="rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-800 transition-colors cursor-pointer"
                    title="Advocate: Tag as Court Evidence / Exhibit"
                  >
                    🔍 Exhibit
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmLegalExcerpt('Contradiction')}
                    className="rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-800 transition-colors cursor-pointer"
                    title="Advocate: Tag as Contradiction for Cross-Exam"
                  >
                    ⚠️ Contradiction
                  </button>
                </div>
              </div>
            )
          })()}

        {pendingComment &&
          (() => {
            const containerWidth = containerRef.current?.clientWidth ?? 0
            const popupWidthEstimate = 240
            const left = containerWidth
              ? Math.min(Math.max(pendingComment.anchor.x, 8), Math.max(containerWidth - popupWidthEstimate, 8))
              : pendingComment.anchor.x
            const top = pendingComment.anchor.y + 8

            return (
              <div
                className="absolute z-10 w-60 rounded-md border border-slate-700 bg-slate-800 p-2 shadow-lg"
                style={{ left, top }}
              >
                <textarea
                  autoFocus
                  rows={3}
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="Add a comment…"
                  className="w-full rounded border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-100 outline-none focus:border-accent"
                />
                <div className="mt-1.5 flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setPendingComment(null)}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <Button onClick={confirmComment} className="text-xs">
                    Save
                  </Button>
                </div>
              </div>
            )
          })()}

        {lassoSelection && (
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-800 px-4 py-2 shadow-lg">
            <span className="text-xs text-slate-300">{lassoSelection.ids.length} selected</span>
            <button
              type="button"
              onClick={deleteLassoSelection}
              className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/30"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setLassoSelection(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        )}

        {openComment && (
          <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/40 pt-24" onClick={() => setOpenComment(null)}>
            <div
              className="w-72 rounded-md border border-slate-700 bg-slate-800 p-3 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="whitespace-pre-wrap text-sm text-slate-100">{openComment.comment_text}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    deleteAnnotation.mutate(openComment.id)
                    recordDelete(openComment)
                    setOpenComment(null)
                  }}
                  className="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setOpenComment(null)}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Bottom-anchored contextual row + mode switch - matches the
          LiquidText reference screenshots the user compared against: the
          icon row directly above the mode switch is genuinely different
          per mode (not the same tools reordered), and the mode switch
          itself lives at the very bottom of the screen, not the top. */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-200/90 bg-white/95 px-3 py-1.5 shadow-[0_-1px_3px_rgba(0,0,0,0.03)] backdrop-blur-md">
        {readerMode === 'drawing' ? (
          <>
            <BottomActionButton active={tool === 'select'} onClick={() => setTool('select')} icon="👆" label="Select" />
            <BottomActionButton active={tool === 'pen'} onClick={() => setTool('pen')} icon="✏️" label="Pen" title="Freehand pen" />
            <BottomActionButton
              active={tool === 'highlighter'}
              onClick={() => setTool('highlighter')}
              icon="🖊️"
              label="Highlighter"
              title="Freehand highlighter"
            />
            <BottomActionButton
              active={tool === 'eraser'}
              onClick={() => setTool('eraser')}
              icon="🧽"
              label="Eraser"
              title="Drag over a stroke or highlight to remove it"
            />
            <BottomActionButton
              active={tool === 'lasso'}
              onClick={() => setTool('lasso')}
              icon="🔗"
              label="Lasso"
              title="Draw a loop to select annotations"
            />
            {tool === 'pen' && <ColorSwatches colors={PEN_COLORS} active={penColor} onPick={setPenColor} />}
            {tool === 'highlighter' && (
              <ColorSwatches colors={HIGHLIGHTER_COLORS} active={highlighterColor} onPick={setHighlighterColor} />
            )}
          </>
        ) : (
          <>
            <BottomActionButton
              active={tool === 'comment'}
              onClick={() => setTool('comment')}
              icon="💬"
              label="Comment"
              title="Click anywhere on the page to pin a comment"
            />
            <BottomActionButton
              active={sidePanel === 'outline'}
              onClick={() => setSidePanel((p) => (p === 'outline' ? 'none' : 'outline'))}
              icon="📑"
              label="Outline"
              title="Table of contents"
            />
            <BottomActionButton
              active={sidePanel === 'hilite'}
              onClick={() => setSidePanel((p) => (p === 'hilite' ? 'none' : 'hilite'))}
              icon="🟨"
              label="HiLiteView"
              title="All highlights in this document"
            />
            <BottomActionButton
              active={sidePanel === 'pages'}
              onClick={() => setSidePanel((p) => (p === 'pages' ? 'none' : 'pages'))}
              icon="🖼️"
              label="Pages"
              title="Page thumbnails and manager"
            />
            <BottomActionButton
              active={squeezeMode}
              onClick={() => setSqueezeMode((s) => !s)}
              icon="🤏"
              label={squeezeMode ? 'Squeezed' : 'Squeeze'}
              title="Squeeze document: collapses pages without annotations so highlights meet"
            />
            <BottomActionButton
              active={readingTheme !== 'dark'}
              onClick={() => {
                const next = readingTheme === 'light' ? 'sepia' : readingTheme === 'sepia' ? 'dark' : 'light'
                setReadingTheme(next)
                document.documentElement.setAttribute('data-theme', next)
                try {
                  localStorage.setItem('chandaktext:theme', next)
                } catch {}
              }}
              icon={readingTheme === 'dark' ? '🌙' : readingTheme === 'sepia' ? '📜' : '☀️'}
              label={readingTheme === 'dark' ? 'Dark' : readingTheme === 'sepia' ? 'Sepia' : 'Light'}
              title={`Reading theme: ${readingTheme}. Click to cycle Light, Warm Sepia, and Dark modes.`}
            />
          </>
        )}

        {/* Undo/redo: always available regardless of mode */}
        <div className="ml-auto flex items-center gap-1">
          <BottomActionButton
            active={false}
            disabled={undoStack.length === 0}
            onClick={handleUndo}
            icon="↩️"
            label="Undo"
            title={undoStack.length ? 'Undo the last drawing action' : 'Nothing to undo'}
          />
          <BottomActionButton
            active={false}
            disabled={redoStack.length === 0}
            onClick={handleRedo}
            icon="↪️"
            label="Redo"
            title={redoStack.length ? 'Redo the last undone action' : 'Nothing to redo'}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-slate-200/90 bg-slate-50/95">
        <ModeTab active={readerMode === 'drawing'} onClick={() => switchReaderMode('drawing')}>
          Drawing
        </ModeTab>
        <ModeTab active={readerMode === 'document'} onClick={() => switchReaderMode('document')}>
          Document
        </ModeTab>
        <ModeTab active={false} onClick={() => onSwitchToWorkspace?.()}>
          Workspace
        </ModeTab>
      </div>
    </div>
  )
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full py-2.5 text-xs font-bold transition-all duration-200 cursor-pointer ${
        active
          ? 'bg-white text-blue-700 shadow-xs border-b-2 border-blue-600 font-extrabold'
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/60'
      }`}
    >
      {children}
    </button>
  )
}

function BottomActionButton({
  active,
  onClick,
  icon,
  label,
  title,
  disabled,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 transition-all cursor-pointer ${
        disabled
          ? 'cursor-not-allowed opacity-30 text-slate-400'
          : active
            ? 'bg-blue-50 text-blue-700 shadow-xs font-bold border border-blue-200/80'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
      }`}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  )
}

// Memoized separately from PdfPage (code review finding: without this, every
// pointer-move frame of an in-progress stroke re-rendered PdfPage and
// recomputed getStroke() for *every* existing ink annotation on the page,
// not just the active one, going O(existing ink strokes) per drag frame
// instead of O(1)). React.memo on PdfPage itself wouldn't have helped here -
// onStrokeMove's reference legitimately changes every frame (it closes over
// the in-progress activeStroke) - so memoizing at this finer grain, where
// `annotation`/`pageSize` stay referentially stable for every stroke except
// the one actively being drawn, is what actually avoids the recomputation.
const InkStrokePath = memo(function InkStrokePath({
  annotation,
  pageSize,
  selected,
  deletable,
  onDelete,
}: {
  annotation: Annotation
  pageSize: { width: number; height: number }
  selected: boolean
  deletable: boolean
  onDelete: () => void
}) {
  const payload = annotation.payload as unknown as InkPayload
  const path = useMemo(
    () => strokeToSvgPath(payload.points, payload.size, pageSize),
    [payload.points, payload.size, pageSize],
  )

  return (
    <path
      d={path}
      fill={annotation.color ?? '#f8fafc'}
      opacity={payload.tool === 'highlighter' ? 0.4 : 1}
      stroke={selected ? '#38bdf8' : 'none'}
      strokeWidth={2}
      className="pointer-events-auto cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        if (deletable) onDelete()
      }}
    />
  )
})

function ColorSwatches({
  colors,
  active,
  onPick,
}: {
  colors: string[]
  active: string
  onPick: (color: string) => void
}) {
  return (
    <div className="ml-1 flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200/90 px-2 py-1 shadow-xs">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className={`h-5 w-5 rounded-full border-2 transition-transform cursor-pointer ${
            active === c ? 'scale-110 border-blue-600 ring-2 ring-blue-100' : 'border-white'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

function PdfPage({
  pdfDoc,
  theme = 'light',
  pageNumber,
  scale,
  rotation = 0,
  label,
  onMouseUp,
  onPageClick,
  tool,
  drawingToolActive,
  annotations,
  onOpenComment,
  onDeleteAnnotation,
  activeStroke,
  activeStrokeColor,
  activeStrokeSize,
  lassoPoints,
  lassoSelection,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
}: {
  pdfDoc: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
  theme?: 'dark' | 'sepia' | 'light'
  pageNumber: number
  scale: number
  rotation?: number
  label?: string
  onMouseUp: (pageNumber: number, pageEl: HTMLDivElement) => void
  onPageClick: (pageNumber: number, pageEl: HTMLDivElement, e: React.MouseEvent) => void
  tool: AnnotationTool
  drawingToolActive: boolean
  annotations: Annotation[]
  onOpenComment: (annotation: Annotation) => void
  onDeleteAnnotation: (id: string) => void
  activeStroke: StrokePoint[] | null
  activeStrokeColor: string
  activeStrokeSize: number
  lassoPoints: StrokePoint[] | null
  lassoSelection: string[]
  onStrokeStart: (pageNumber: number, point: StrokePoint) => void
  onStrokeMove: (pageNumber: number, point: StrokePoint, annotations: Annotation[], pageSize: { width: number; height: number }) => void
  onStrokeEnd: (annotations: Annotation[]) => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const isDrawingRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function render() {
      const page = await pdfDoc.getPage(pageNumber)
      const viewport = page.getViewport({ scale, rotation })

      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      await page.render({ canvasContext: ctx, viewport }).promise
      if (cancelled) return

      setSize({ width: viewport.width, height: viewport.height })

      const textLayerDiv = textLayerRef.current
      if (textLayerDiv) {
        textLayerDiv.innerHTML = ''
        textLayerDiv.style.width = `${viewport.width}px`
        textLayerDiv.style.height = `${viewport.height}px`

        const textContent = await page.getTextContent()
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        })
        await textLayer.render()
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [pdfDoc, pageNumber, scale, rotation])

  function pointFromEvent(e: React.PointerEvent): StrokePoint {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!drawingToolActive) return
    try {
      // Pointer capture keeps move/up events routed here even if the
      // pointer leaves the SVG mid-stroke (fast strokes near a page
      // edge) - a nice-to-have, not a requirement for drawing to work,
      // so a capture failure (observed: Chrome throws
      // "No active pointer with the given id is found" for some
      // non-standard pointer sources) must not abort the stroke itself.
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Ignored - see above.
    }
    isDrawingRef.current = true
    onStrokeStart(pageNumber, pointFromEvent(e))
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drawingToolActive || !isDrawingRef.current) return
    onStrokeMove(pageNumber, pointFromEvent(e), annotations, size)
  }

  function handlePointerUp() {
    if (!drawingToolActive || !isDrawingRef.current) return
    isDrawingRef.current = false
    onStrokeEnd(annotations)
  }

  const cursorClass =
    tool === 'comment'
      ? 'cursor-crosshair'
      : tool === 'pen' || tool === 'highlighter'
        ? 'cursor-crosshair'
        : tool === 'eraser'
          ? 'cursor-cell'
          : tool === 'lasso'
            ? 'cursor-crosshair'
            : ''

  return (
    <div className="relative mx-auto flex flex-col items-center">
      {label && (
        <div className="mb-1 flex w-full items-center justify-between rounded-t-md bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white shadow-md">
          <div className="flex items-center gap-1.5">
            <span>⚖️</span>
            <span>{label}</span>
          </div>
          <span className="rounded bg-black/25 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
            Paper-Book Exhibit
          </span>
        </div>
      )}
      <div
        ref={wrapperRef}
        data-page-number={pageNumber}
        className={`relative mx-auto bg-white shadow-md ${cursorClass} ${label ? 'rounded-b-md' : 'rounded-md'}`}
        style={{
          filter:
            theme === 'sepia'
              ? 'sepia(0.24) contrast(1.05)'
              : theme === 'dark'
                ? 'invert(0.9) hue-rotate(180deg) contrast(1.08)'
                : 'none',
          transition: 'filter 0.25s ease',
        }}
        onMouseUp={() => wrapperRef.current && onMouseUp(pageNumber, wrapperRef.current)}
        onClick={(e) => wrapperRef.current && onPageClick(pageNumber, wrapperRef.current, e)}
      >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />

      {size.width > 0 && (
        <svg
          ref={svgRef}
          className={`absolute left-0 top-0 ${drawingToolActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {annotations.map((a) => {
            const isLassoSelected = lassoSelection.includes(a.id)

            if (a.type === 'highlight' || a.type === 'underline') {
              const rects = (a.payload.rects as SourceRect[] | undefined) ?? []
              return rects.map((r, i) => {
                const x = r.x * size.width
                const y = r.y * size.height
                const w = r.width * size.width
                const h = r.height * size.height
                return a.type === 'highlight' ? (
                  <rect
                    key={`${a.id}-${i}`}
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={a.color ?? HIGHLIGHT_COLOR}
                    opacity={0.35}
                    stroke={isLassoSelected ? '#38bdf8' : 'none'}
                    strokeWidth={2}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (tool === 'select') onDeleteAnnotation(a.id)
                    }}
                  >
                    <title>Click to remove highlight</title>
                  </rect>
                ) : (
                  <rect
                    key={`${a.id}-${i}`}
                    x={x}
                    y={y + h - 2}
                    width={w}
                    height={2}
                    fill={a.color ?? UNDERLINE_COLOR}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (tool === 'select') onDeleteAnnotation(a.id)
                    }}
                  >
                    <title>Click to remove underline</title>
                  </rect>
                )
              })
            }

            if (a.type === 'comment') {
              const px = (a.payload.x as number) * size.width
              const py = (a.payload.y as number) * size.height
              const pinColor = a.color ?? COMMENT_COLOR
              return (
                <g
                  key={a.id}
                  transform={`translate(${px}, ${py})`}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (tool === 'select' || tool === 'comment') onOpenComment(a)
                  }}
                >
                  {/* Subtle pulsing background glow ring */}
                  <circle r={14} fill={pinColor} opacity={0.25} />
                  {/* Speech bubble pin shape with pointer tail */}
                  <path
                    d="M -11 -22 h 22 a 6 6 0 0 1 6 6 v 11 a 6 6 0 0 1 -6 6 h -13 l -6 6 v -6 a 6 6 0 0 1 -3 -5 v -12 a 6 6 0 0 1 6 -6 z"
                    fill={pinColor}
                    stroke={isLassoSelected ? '#38bdf8' : '#ffffff'}
                    strokeWidth={isLassoSelected ? 2.5 : 1.5}
                    style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.35))' }}
                  />
                  {/* Icon detail inside pin: 3 speech bubble dots */}
                  <circle cx="-5" cy="-12" r={1.5} fill="#ffffff" />
                  <circle cx="0" cy="-12" r={1.5} fill="#ffffff" />
                  <circle cx="5" cy="-12" r={1.5} fill="#ffffff" />
                  <title>{a.comment_text ? `Comment: ${a.comment_text}` : 'Click to view comment'}</title>
                </g>
              )
            }

            if (a.type === 'ink') {
              return (
                <InkStrokePath
                  key={a.id}
                  annotation={a}
                  pageSize={size}
                  selected={isLassoSelected}
                  deletable={tool === 'select'}
                  onDelete={() => onDeleteAnnotation(a.id)}
                />
              )
            }

            return null
          })}

          {activeStroke && activeStroke.length > 1 && (
            <path
              d={strokeToSvgPath(
                activeStroke.map((p) => [p.x, p.y, p.pressure]),
                activeStrokeSize,
                size,
              )}
              fill={activeStrokeColor}
              opacity={0.7}
            />
          )}

          {lassoPoints && lassoPoints.length > 1 && (
            <polyline
              points={lassoPoints.map((p) => `${p.x * size.width},${p.y * size.height}`).join(' ')}
              fill="rgba(56, 189, 248, 0.1)"
              stroke="#38bdf8"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}
        </svg>
      )}

      <div className="absolute bottom-1 right-2 rounded bg-black/40 px-1.5 py-0.5 text-xs text-white">
        {pageNumber}
      </div>
    </div>
  </div>
  )
}

function OutlineList({ nodes, onJump, depth = 0 }: { nodes: OutlineNode[]; onJump: (pageNumber: number) => void; depth?: number }) {
  return (
    <ul className="flex flex-col gap-0.5" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      {nodes.map((node, i) => (
        <li key={`${node.title}-${i}`}>
          <button
            type="button"
            disabled={node.pageNumber == null}
            onClick={() => node.pageNumber != null && onJump(node.pageNumber)}
            className="w-full truncate rounded px-1.5 py-1 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:text-slate-600"
          >
            {node.title}
          </button>
          {node.items.length > 0 && <OutlineList nodes={node.items} onJump={onJump} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}
