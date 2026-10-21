import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { pdfjsLib } from '@/lib/pdf'
import { api } from '@/lib/api'
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

type AnnotationTool = 'select' | 'comment'

// Shared palette: amber for highlight matches the existing export-time
// highlight-overlay color (PdfHighlightOverlayGenerator's amber-400), so a
// highlight looks the same whether you're viewing it live or in an export.
const HIGHLIGHT_COLOR = '#facc15'
const UNDERLINE_COLOR = '#38bdf8'
const COMMENT_COLOR = '#f472b6'

/**
 * Renders every page of a document (fetched as a blob through the
 * authenticated API, never a public URL - docs/02 section 2.6 "keep storage
 * private") with PDF.js, overlays a real text layer so the browser's native
 * text selection works, and turns a selection into a normalized-rectangle
 * excerpt or annotation (docs/03 section 3.3: store rects in 0-1 page space
 * so zoom never breaks alignment). Annotations (highlight/underline/comment)
 * persist via the Annotation API and render as a live overlay - this is the
 * first UI consumer of that API; it previously had no frontend at all.
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
  const [pendingComment, setPendingComment] = useState<{
    pageNumber: number
    x: number
    y: number
    anchor: { x: number; y: number }
  } | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [openComment, setOpenComment] = useState<Annotation | null>(null)

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

  if (error) {
    return <p className="p-4 text-sm text-red-400">{error}</p>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-900/80 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setTool('select')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            tool === 'select' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Select
        </button>
        <button
          type="button"
          onClick={() => setTool('comment')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            tool === 'comment' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'
          }`}
          title="Click anywhere on the page to pin a comment"
        >
          💬 Comment
        </button>
      </div>

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
                annotations={annotationsByPage.get(pageNumber) ?? []}
                onOpenComment={setOpenComment}
                onDeleteAnnotation={(id) => deleteAnnotation.mutate(id)}
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
  )
}

function PdfPage({
  pdfDoc,
  pageNumber,
  scale,
  onMouseUp,
  onPageClick,
  tool,
  annotations,
  onOpenComment,
  onDeleteAnnotation,
}: {
  pdfDoc: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
  pageNumber: number
  scale: number
  onMouseUp: (pageNumber: number, pageEl: HTMLDivElement) => void
  onPageClick: (pageNumber: number, pageEl: HTMLDivElement, e: React.MouseEvent) => void
  tool: AnnotationTool
  annotations: Annotation[]
  onOpenComment: (annotation: Annotation) => void
  onDeleteAnnotation: (id: string) => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

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

  return (
    <div
      ref={wrapperRef}
      className={`relative mx-auto bg-white shadow-md ${tool === 'comment' ? 'cursor-crosshair' : ''}`}
      onMouseUp={() => wrapperRef.current && onMouseUp(pageNumber, wrapperRef.current)}
      onClick={(e) => wrapperRef.current && onPageClick(pageNumber, wrapperRef.current, e)}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />

      {size.width > 0 && (
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          {annotations.map((a) => {
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
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteAnnotation(a.id)
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
                      onDeleteAnnotation(a.id)
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
                    onOpenComment(a)
                  }}
                >
                  <circle r={8} fill={a.color ?? COMMENT_COLOR} stroke="white" strokeWidth={1.5} />
                  <title>{a.comment_text}</title>
                </g>
              )
            }

            return null
          })}
        </svg>
      )}

      <div className="absolute bottom-1 right-2 rounded bg-black/40 px-1.5 py-0.5 text-xs text-white">
        {pageNumber}
      </div>
    </div>
  )
}
