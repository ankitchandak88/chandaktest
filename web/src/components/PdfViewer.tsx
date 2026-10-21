import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { getStroke } from 'perfect-freehand'
import { pdfjsLib } from '@/lib/pdf'
import { api } from '@/lib/api'
import { getSvgPathFromStroke } from '@/lib/freehand'
import { useAnnotations, useCreateAnnotation, useDeleteAnnotation } from '@/lib/queries'
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
  onSaveExcerpt: (selection: { pageNumber: number; text: string; rects: SourceRect[] }) => void
}

type AnnotationTool = 'select' | 'comment' | 'pen' | 'highlighter' | 'eraser' | 'lasso'

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

interface OutlineNode {
  title: string
  pageNumber: number | null
  items: OutlineNode[]
}

type SidePanel = 'none' | 'outline' | 'hilite'

// Shared palette: amber for highlight matches the existing export-time
// highlight-overlay color (PdfHighlightOverlayGenerator's amber-400), so a
// highlight looks the same whether you're viewing it live or in an export.
const HIGHLIGHT_COLOR = '#facc15'
const UNDERLINE_COLOR = '#38bdf8'
const COMMENT_COLOR = '#f472b6'

const PEN_COLORS = ['#f8fafc', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b']
const HIGHLIGHTER_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#fb923c']
const PEN_SIZE = 0.004
const HIGHLIGHTER_SIZE = 0.016

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
export default function PdfViewer({ documentId, onSaveExcerpt }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfDoc, setPdfDoc] = useState<Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']> | null>(
    null,
  )
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [scale] = useState(1.2)
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('select')
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

  const { data: annotations } = useAnnotations(documentId)
  const createAnnotation = useCreateAnnotation(documentId)
  const deleteAnnotation = useDeleteAnnotation(documentId)

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

  function confirmExcerpt() {
    if (!selection) return
    onSaveExcerpt({ pageNumber: selection.pageNumber, text: selection.text, rects: selection.rects })
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  function confirmHighlight(type: 'highlight' | 'underline') {
    if (!selection) return
    createAnnotation.mutate({
      page_number: selection.pageNumber,
      type,
      color: type === 'highlight' ? HIGHLIGHT_COLOR : UNDERLINE_COLOR,
      payload: { rects: selection.rects, text: selection.text },
    })
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  function confirmComment() {
    if (!pendingComment || !commentDraft.trim()) {
      setPendingComment(null)
      return
    }
    createAnnotation.mutate({
      page_number: pendingComment.pageNumber,
      type: 'comment',
      color: COMMENT_COLOR,
      comment_text: commentDraft.trim(),
      payload: { x: pendingComment.x, y: pendingComment.y },
    })
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
            hit = points.some(
              ([px, py]) =>
                Math.hypot((px - point.x) * pageSize.width, (py - point.y) * pageSize.height) < thresholdPx,
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
        createAnnotation.mutate({
          page_number: activeStroke.pageNumber,
          type: 'ink',
          color: tool === 'pen' ? penColor : highlighterColor,
          payload: payload as unknown as Record<string, unknown>,
        })
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
      deleteAnnotation.mutate(id)
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

  if (error) {
    return <p className="p-4 text-sm text-red-400">{error}</p>
  }

  const drawingToolActive = tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'lasso'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-900/80 px-2 py-1.5">
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')}>
          Select
        </ToolButton>
        <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} title="Freehand pen">
          ✏️ Pen
        </ToolButton>
        <ToolButton active={tool === 'highlighter'} onClick={() => setTool('highlighter')} title="Freehand highlighter">
          🖊️ Highlighter
        </ToolButton>
        <ToolButton active={tool === 'lasso'} onClick={() => setTool('lasso')} title="Draw a loop to select annotations">
          🔗 Lasso
        </ToolButton>
        <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Drag over a stroke or highlight to remove it">
          🧽 Eraser
        </ToolButton>
        <ToolButton active={tool === 'comment'} onClick={() => setTool('comment')} title="Click anywhere on the page to pin a comment">
          💬 Comment
        </ToolButton>

        {tool === 'pen' && (
          <ColorSwatches colors={PEN_COLORS} active={penColor} onPick={setPenColor} />
        )}
        {tool === 'highlighter' && (
          <ColorSwatches colors={HIGHLIGHTER_COLORS} active={highlighterColor} onPick={setHighlighterColor} />
        )}

        <div className="ml-auto flex items-center gap-1">
          <ToolButton active={sidePanel === 'outline'} onClick={() => setSidePanel((p) => (p === 'outline' ? 'none' : 'outline'))} title="Table of contents">
            📑 Outline
          </ToolButton>
          <ToolButton active={sidePanel === 'hilite'} onClick={() => setSidePanel((p) => (p === 'hilite' ? 'none' : 'hilite'))} title="All highlights in this document">
            🟨 Highlights
          </ToolButton>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {sidePanel !== 'none' && (
          <div className="w-64 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900 p-3">
            {sidePanel === 'outline' &&
              (outline.length === 0 ? (
                <p className="text-xs text-slate-500">This PDF has no table of contents.</p>
              ) : (
                <OutlineList nodes={outline} onJump={jumpToPage} />
              ))}

            {sidePanel === 'hilite' &&
              (highlightList.length === 0 ? (
                <p className="text-xs text-slate-500">No highlights yet - select text and choose Highlight.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {highlightList.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => jumpToPage(a.page_number)}
                        className="w-full rounded-md border-l-2 bg-slate-800/60 p-2 text-left text-xs text-slate-200 hover:bg-slate-800"
                        style={{ borderColor: a.color ?? HIGHLIGHT_COLOR }}
                      >
                        <span className="block text-[10px] text-slate-500">Page {a.page_number}</span>
                        {(a.payload.text as string | undefined) ?? ''}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}

      <div ref={containerRef} className="relative flex-1 overflow-auto bg-slate-900 p-4">
        {!pdfDoc && <p className="text-sm text-slate-400">Loading PDF…</p>}

        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {pdfDoc &&
            Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
              <PdfPage
                key={pageNumber}
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                scale={scale}
                onMouseUp={handleMouseUp}
                onPageClick={handlePageClick}
                tool={tool}
                drawingToolActive={drawingToolActive}
                annotations={annotationsByPage.get(pageNumber) ?? []}
                onOpenComment={setOpenComment}
                onDeleteAnnotation={(id) => deleteAnnotation.mutate(id)}
                activeStroke={activeStroke?.pageNumber === pageNumber ? activeStroke.points : null}
                activeStrokeColor={tool === 'pen' ? penColor : highlighterColor}
                activeStrokeSize={tool === 'pen' ? PEN_SIZE : HIGHLIGHTER_SIZE}
                lassoPoints={lassoPoints?.pageNumber === pageNumber ? lassoPoints.points : null}
                lassoSelection={lassoSelection?.pageNumber === pageNumber ? lassoSelection.ids : []}
                onStrokeStart={handleStrokeStart}
                onStrokeMove={handleStrokeMove}
                onStrokeEnd={handleStrokeEnd}
              />
            ))}
        </div>

        {selection &&
          (() => {
            const containerWidth = containerRef.current?.clientWidth ?? 0
            const popupWidthEstimate = 260
            const left = containerWidth
              ? Math.min(Math.max(selection.anchor.x, 8), Math.max(containerWidth - popupWidthEstimate, 8))
              : selection.anchor.x
            const top = Math.max(selection.anchor.y - 8, 8)

            return (
              <div
                className="absolute z-10 flex -translate-y-full gap-1 rounded-md bg-slate-800 p-1 shadow-lg"
                style={{ left, top }}
              >
                <Button onClick={confirmExcerpt} className="text-xs">
                  Excerpt
                </Button>
                <button
                  type="button"
                  onClick={() => confirmHighlight('highlight')}
                  className="rounded px-2 py-1 text-xs font-medium text-slate-900"
                  style={{ backgroundColor: HIGHLIGHT_COLOR }}
                >
                  Highlight
                </button>
                <button
                  type="button"
                  onClick={() => confirmHighlight('underline')}
                  className="rounded border px-2 py-1 text-xs font-medium"
                  style={{ borderColor: UNDERLINE_COLOR, color: UNDERLINE_COLOR }}
                >
                  Underline
                </button>
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
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
        active ? 'scale-105 bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

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
    <div className="ml-1 flex items-center gap-1 rounded-full bg-slate-800 px-1.5 py-1">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className={`h-5 w-5 rounded-full border-2 transition-transform ${
            active === c ? 'scale-110 border-white' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

function PdfPage({
  pdfDoc,
  pageNumber,
  scale,
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
  pageNumber: number
  scale: number
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
      const viewport = page.getViewport({ scale })

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
  }, [pdfDoc, pageNumber, scale])

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
    e.currentTarget.setPointerCapture(e.pointerId)
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
    <div
      ref={wrapperRef}
      data-page-number={pageNumber}
      className={`relative mx-auto bg-white shadow-md ${cursorClass}`}
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
              return (
                <g
                  key={a.id}
                  transform={`translate(${px}, ${py})`}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (tool === 'select') onOpenComment(a)
                  }}
                >
                  <circle r={8} fill={a.color ?? COMMENT_COLOR} stroke={isLassoSelected ? '#38bdf8' : 'white'} strokeWidth={isLassoSelected ? 3 : 1.5} />
                  <title>{a.comment_text}</title>
                </g>
              )
            }

            if (a.type === 'ink') {
              const payload = a.payload as unknown as InkPayload
              const path = strokeToSvgPath(payload.points, payload.size, size)
              return (
                <path
                  key={a.id}
                  d={path}
                  fill={a.color ?? '#f8fafc'}
                  opacity={payload.tool === 'highlighter' ? 0.4 : 1}
                  stroke={isLassoSelected ? '#38bdf8' : 'none'}
                  strokeWidth={2}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (tool === 'select') onDeleteAnnotation(a.id)
                  }}
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
