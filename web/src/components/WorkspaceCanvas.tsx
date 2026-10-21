import { useEffect, useMemo, useRef, useState } from 'react'
import type { Excerpt, Link, Note, WorkspaceItem } from '@/types/api'
import { useSaveWorkspaceBatch } from '@/lib/queries'

interface CanvasCard {
  key: string
  item: WorkspaceItem
  kind: 'excerpt' | 'note'
  title: string
  body: string
}

interface WorkspaceCanvasProps {
  projectId: string
  items: WorkspaceItem[]
  excerpts: Excerpt[]
  notes: Note[]
  links: Link[]
  /** Fired on double-clicking any card - used to drive the link-mode flow
   * (both excerpts and notes can be either end of a link). */
  onOpenCard?: (card: { type: 'excerpt' | 'note'; id: string }) => void
}

/**
 * The research canvas (docs/01 "Organize excerpts and notes on a flexible
 * workspace canvas" / docs/05 section 5.4). Deliberately plain
 * drag-and-drop divs rather than a canvas library (Konva/tldraw) for this
 * first pass - docs/02 section 2.1 asks to "evaluate" those for
 * accessibility/licensing fit, which is follow-up work; this still
 * delivers drag, persisted positions, and links, which is the part of the
 * spec that's load-bearing for the core user journey.
 */
export default function WorkspaceCanvas({
  projectId,
  items,
  excerpts,
  notes,
  links,
  onOpenCard,
}: WorkspaceCanvasProps) {
  const saveBatch = useSaveWorkspaceBatch(projectId)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const dragState = useRef<{ itemId: string; offsetX: number; offsetY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // FE-001: this looks like the "sync state from a prop in an effect"
  // anti-pattern, but `positions` genuinely can't be derived from `items`
  // during render - it has to be real state, because an active drag must
  // diverge from the last server-confirmed `items` until the debounced
  // autosave (scheduleSave) confirms it. This effect's only job is to
  // re-sync from the server after `items` changes for a reason OTHER than
  // this component's own drag (e.g. another tab/device moved a card, or the
  // initial load) - it intentionally does not run on every render.
  useEffect(() => {
    const next: Record<string, { x: number; y: number }> = {}
    for (const item of items) next[item.id] = { x: item.x, y: item.y }
    setPositions(next)
  }, [items])

  const cards: CanvasCard[] = useMemo(() => {
    const result: CanvasCard[] = []
    for (const item of items) {
      if (item.item_type === 'excerpt') {
        const excerpt = excerpts.find((e) => e.id === item.target_id)
        if (excerpt) {
          result.push({
            key: item.id,
            item,
            kind: 'excerpt',
            title: `Page ${excerpt.page_number}`,
            body: excerpt.text,
          })
        }
      } else {
        const note = notes.find((n) => n.id === item.target_id)
        if (note) {
          result.push({
            key: item.id,
            item,
            kind: 'note',
            title: note.title || 'Note',
            body: note.content ?? '',
          })
        }
      }
    }
    return result
  }, [items, excerpts, notes])

  function scheduleSave(itemId: string, x: number, y: number) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveBatch.mutate([{ id: itemId, x, y }])
    }, 400)
  }

  function handlePointerDown(e: React.PointerEvent, itemId: string) {
    const pos = positions[itemId]
    if (!pos || !containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()
    dragState.current = {
      itemId,
      offsetX: e.clientX - containerRect.left - pos.x,
      offsetY: e.clientY - containerRect.top - pos.y,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragState.current
    if (!drag || !containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, e.clientX - containerRect.left - drag.offsetX)
    const y = Math.max(0, e.clientY - containerRect.top - drag.offsetY)
    setPositions((prev) => ({ ...prev, [drag.itemId]: { x, y } }))
  }

  function handlePointerUp() {
    const drag = dragState.current
    if (!drag) return
    const pos = positions[drag.itemId]
    if (pos) scheduleSave(drag.itemId, pos.x, pos.y)
    dragState.current = null
  }

  // FE-003 fix: the svg used to be `absolute inset-0 h-full w-full` sized to
  // the *visible* container box, while cards are positioned using world
  // coordinates that can extend well beyond that (scrolled-to) area. SVGs
  // clip to their own box by default, so a line to/from an off-screen card
  // got cut off. Sizing an inner content wrapper (shared by the svg and the
  // cards) to the actual extent of the content - not just the viewport -
  // means both line and card coordinates stay correct no matter how far
  // the canvas has scrolled.
  const contentSize = useMemo(() => {
    let maxX = 0
    let maxY = 0
    for (const card of cards) {
      const pos = positions[card.item.id] ?? { x: card.item.x, y: card.item.y }
      maxX = Math.max(maxX, pos.x + card.item.width)
      maxY = Math.max(maxY, pos.y + card.item.height)
    }
    return { width: Math.max(maxX + 200, 1200), height: Math.max(maxY + 200, 800) }
  }, [cards, positions])

  function linkEndpoints(link: Link) {
    const source = cards.find((c) => c.kind === link.source_type && c.item.target_id === link.source_id)
    const target = cards.find((c) => c.kind === link.target_type && c.item.target_id === link.target_id)
    if (!source || !target) return null
    const from = positions[source.item.id]
    const to = positions[target.item.id]
    if (!from || !to) return null
    return {
      x1: from.x + source.item.width / 2,
      y1: from.y + source.item.height / 2,
      x2: to.x + target.item.width / 2,
      y2: to.y + target.item.height / 2,
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[600px] w-full overflow-auto bg-[radial-gradient(circle,theme(colors.slate.800)_1px,transparent_1px)] bg-[length:20px_20px]"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        className="relative"
        style={{ width: contentSize.width, height: contentSize.height }}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          {links.map((link) => {
            const endpoints = linkEndpoints(link)
            if (!endpoints) return null
            return (
              <line
                key={link.id}
                x1={endpoints.x1}
                y1={endpoints.y1}
                x2={endpoints.x2}
                y2={endpoints.y2}
                stroke="#22d3ee"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )
          })}
        </svg>

        {cards.map((card) => {
          const pos = positions[card.item.id] ?? { x: card.item.x, y: card.item.y }
          return (
            <div
              key={card.key}
              className="absolute flex cursor-grab flex-col gap-1 rounded-md border border-slate-700 bg-slate-900 p-3 shadow-lg active:cursor-grabbing"
              style={{ left: pos.x, top: pos.y, width: card.item.width, minHeight: card.item.height }}
              onPointerDown={(e) => handlePointerDown(e, card.item.id)}
              onDoubleClick={() => onOpenCard?.({ type: card.kind, id: card.item.target_id })}
            >
              <span
                className={
                  card.kind === 'excerpt'
                    ? 'w-fit rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300'
                    : 'w-fit rounded bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300'
                }
              >
                {card.kind === 'excerpt' ? card.title : 'Note'}
              </span>
              <p className="line-clamp-4 select-none text-sm text-slate-200">{card.body}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
