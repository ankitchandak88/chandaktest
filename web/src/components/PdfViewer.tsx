import { useEffect, useRef, useState, useCallback } from 'react'
import { pdfjsLib } from '@/lib/pdf'
import { api } from '@/lib/api'
import type { SourceRect } from '@/types/api'
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

/**
 * Renders every page of a document (fetched as a blob through the
 * authenticated API, never a public URL - docs/02 section 2.6 "keep storage
 * private") with PDF.js, overlays a real text layer so the browser's native
 * text selection works, and turns a selection into a normalized-rectangle
 * excerpt (docs/03 section 3.3: store rects in 0-1 page space so zoom never
 * breaks alignment).
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

  const handleMouseUp = useCallback((pageNumber: number, pageEl: HTMLDivElement) => {
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
  }, [])

  // Scroll/resize invalidates the popup's anchor coordinates (BUG-002:
  // "reposition after scroll/resize"). Re-deriving the exact position live
  // would mean re-walking the selection geometry on every scroll event;
  // dismissing the popup instead is simpler and never shows it in the wrong
  // place - the user just re-selects, which also re-confirms the text is
  // still what they meant to save.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !selection) return

    const dismiss = () => setSelection(null)
    container.addEventListener('scroll', dismiss)
    window.addEventListener('resize', dismiss)

    return () => {
      container.removeEventListener('scroll', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [selection])

  function confirmExcerpt() {
    if (!selection) return
    onSaveExcerpt({ pageNumber: selection.pageNumber, text: selection.text, rects: selection.rects })
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  if (error) {
    return <p className="p-4 text-sm text-red-400">{error}</p>
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-auto bg-slate-900 p-4">
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
            />
          ))}
      </div>

      {selection &&
        (() => {
          // Clamp within the visible container so the popup never renders
          // partially off-screen for a selection near an edge.
          const containerWidth = containerRef.current?.clientWidth ?? 0
          const popupWidthEstimate = 200
          const left = containerWidth
            ? Math.min(Math.max(selection.anchor.x, 8), Math.max(containerWidth - popupWidthEstimate, 8))
            : selection.anchor.x
          const top = Math.max(selection.anchor.y - 8, 8)

          return (
            <div
              className="absolute z-10 -translate-y-full rounded-md bg-slate-800 p-1 shadow-lg"
              style={{ left, top }}
            >
              <Button onClick={confirmExcerpt} className="text-xs">
                Save selection as excerpt
              </Button>
            </div>
          )
        })()}
    </div>
  )
}

function PdfPage({
  pdfDoc,
  pageNumber,
  scale,
  onMouseUp,
}: {
  pdfDoc: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
  pageNumber: number
  scale: number
  onMouseUp: (pageNumber: number, pageEl: HTMLDivElement) => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)

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
      className="relative mx-auto bg-white shadow-md"
      onMouseUp={() => wrapperRef.current && onMouseUp(pageNumber, wrapperRef.current)}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />
      <div className="absolute bottom-1 right-2 rounded bg-black/40 px-1.5 py-0.5 text-xs text-white">
        {pageNumber}
      </div>
    </div>
  )
}
