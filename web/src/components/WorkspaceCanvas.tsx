import { useEffect, useMemo, useRef, useState } from 'react'
import type { Document, Excerpt, Link, Note, Tag, WorkspaceItem } from '@/types/api'
import {
  useCreateLink,
  useCreateNote,
  useCreateTag,
  useDeleteNote,
  useDeleteWorkspaceItem,
  useSaveWorkspaceBatch,
  useSuggestExcerptTags,
  useSuggestNoteTags,
  useSyncExcerptTags,
  useSyncNoteTags,
  useUpdateNote,
} from '@/lib/queries'

export interface RichTextStyle {
  b?: boolean
  i?: boolean
  u?: boolean
  size?: 'sm' | 'base' | 'lg'
  color?: string
}

export function parseRichText(content: string): { style: RichTextStyle; text: string } {
  if (content && content.startsWith('<!--rt-->')) {
    const newlineIndex = content.indexOf('\n')
    if (newlineIndex !== -1) {
      try {
        const jsonStr = content.slice('<!--rt-->'.length, newlineIndex)
        const style = JSON.parse(jsonStr) as RichTextStyle
        const text = content.slice(newlineIndex + 1)
        return { style, text }
      } catch {
        // Fallback
      }
    }
  }
  return { style: {}, text: content ?? '' }
}

function RichTextContent({ content }: { content: string }) {
  const { style, text } = parseRichText(content)
  const isTooLight =
    style.color &&
    ['#f8fafc', '#ffffff', '#fff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8'].includes(
      style.color.toLowerCase(),
    )
  const textColor = isTooLight ? '#0f172a' : style.color || '#0f172a'

  return (
    <span
      className="canvas-card-text block whitespace-pre-wrap leading-relaxed text-[13.5px] font-medium text-slate-900"
      style={{
        fontWeight: style.b ? 'bold' : 'normal',
        fontStyle: style.i ? 'italic' : 'normal',
        textDecoration: style.u ? 'underline' : 'none',
        fontSize: style.size === 'sm' ? '12px' : style.size === 'lg' ? '16px' : '13.5px',
        color: textColor,
      }}
    >
      {text}
    </span>
  )
}

interface CanvasCard {
  key: string
  item: WorkspaceItem
  kind: 'excerpt' | 'note'
  targetId: string
  title: string
  body: string
  tags: Tag[]
  accentColor?: string
}

interface WorkspaceCanvasProps {
  projectId: string
  workspaceId?: string | null
  items: WorkspaceItem[]
  excerpts: Excerpt[]
  notes: Note[]
  links: Link[]
  tags: Tag[]
  documents?: Document[]
  /** Fired on double-clicking any card - used to drive the link-mode flow
   * (both excerpts and notes can be either end of a link). */
  onOpenCard?: (card: { type: 'excerpt' | 'note'; id: string }) => void
  /** Fired when clicking 'View in Doc' on an excerpt card to jump straight to source page in PDF */
  onNavigateToSource?: (excerpt: Excerpt) => void
  /** Currently active or focused card key */
  activeCardId?: string | null
  /** Hover event on card - used for dynamic elastic tethers */
  onCardHover?: (cardId: string | null) => void
  /** Selection event on card */
  onCardSelect?: (cardId: string) => void
  /** Direct drag-and-drop excerpt pin from PDF reader */
  onDropExcerpt?: (
    data: { documentId?: string; pageNumber: number; text: string; rects: Excerpt['source_rects'] },
    pos: { x: number; y: number },
  ) => void
}

// Tags don't require a color up front (PROD-003 kept that optional); a
// stable hash-based swatch keeps uncolored tags visually distinct from each
// other instead of all rendering the same default gray.
const TAG_PALETTE = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9']

function tagColor(tag: Tag): string {
  if (tag.color) return tag.color
  let hash = 0
  for (let i = 0; i < tag.id.length; i++) hash = (hash * 31 + tag.id.charCodeAt(i)) | 0
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length]
}

export const LEGAL_TAG_DEFS = [
  { name: 'exhibit', label: 'Exhibit', icon: '🔍', color: '#fbbf24' },
  { name: 'issue', label: 'Issue', icon: '⚖️', color: '#c084fc' },
  { name: 'precedent', label: 'Precedent', icon: '📜', color: '#60a5fa' },
  { name: 'contradiction', label: 'Contradiction', icon: '⚠️', color: '#f87171' },
] as const

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
  workspaceId,
  items,
  excerpts,
  notes,
  links,
  tags,
  onOpenCard,
  onNavigateToSource,
  activeCardId,
  onCardHover,
  onCardSelect,
  onDropExcerpt,
  documents,
}: WorkspaceCanvasProps) {
  const saveBatch = useSaveWorkspaceBatch(projectId, workspaceId)
  const createLink = useCreateLink(projectId)
  const [isDragOver, setIsDragOver] = useState(false)
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number } | null>(null)
  const [stackTargetId, setStackTargetId] = useState<string | null>(null)
  const [expandedStackCardId, setExpandedStackCardId] = useState<string | null>(null)
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null)
  const syncExcerptTags = useSyncExcerptTags(projectId)
  const syncNoteTags = useSyncNoteTags(projectId)
  const suggestExcerptTags = useSuggestExcerptTags()
  const suggestNoteTags = useSuggestNoteTags()
  const createTag = useCreateTag(projectId)
  const deleteWorkspaceItem = useDeleteWorkspaceItem(projectId)
  const deleteNote = useDeleteNote(projectId)
  const [legalFilter, setLegalFilter] = useState<'all' | 'issue' | 'precedent' | 'exhibit' | 'contradiction'>('all')
  const [hideNonMatching, setHideNonMatching] = useState<boolean>(true)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [tagMenuFor, setTagMenuFor] = useState<string | null>(null)
  const [suggestionsFor, setSuggestionsFor] = useState<{ cardKey: string; names: string[] } | null>(null)
  const dragState = useRef<{ itemId: string; offsetX: number; offsetY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const createNote = useCreateNote(projectId)
  const updateNote = useUpdateNote(projectId)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState<string>('')
  const [editBold, setEditBold] = useState<boolean>(false)
  const [editItalic, setEditItalic] = useState<boolean>(false)
  const [editUnderline, setEditUnderline] = useState<boolean>(false)
  const [editFontSize, setEditFontSize] = useState<'sm' | 'base' | 'lg'>('base')
  const [editColor, setEditColor] = useState<string>('#0f172a')

  async function handleAddTextBox() {
    const defaultText = 'New text box'
    const note = await createNote.mutateAsync({
      title: 'Text Box',
      content: defaultText,
    })
    const count = items.length % 8
    const pos = { x: 80 + count * 30, y: 80 + count * 30 }
    await saveBatch.mutateAsync([
      { item_type: 'note', target_id: note.id, width: 280, height: 160, ...pos },
    ])
    setEditingCardId(note.id)
    setEditBody(defaultText)
    setEditBold(false)
    setEditItalic(false)
    setEditUnderline(false)
    setEditFontSize('base')
    setEditColor('#0f172a')
  }

  function handleStartEditNote(card: CanvasCard) {
    const { style, text } = parseRichText(card.body)
    setEditingCardId(card.targetId)
    setEditBody(text)
    setEditBold(!!style.b)
    setEditItalic(!!style.i)
    setEditUnderline(!!style.u)
    setEditFontSize(style.size || 'base')
    const isLight = style.color && ['#f8fafc', '#ffffff', '#fff'].includes(style.color.toLowerCase())
    setEditColor(isLight || !style.color ? '#0f172a' : style.color)
  }

  async function handleSaveNoteEdit(noteId: string) {
    const style: RichTextStyle = {}
    if (editBold) style.b = true
    if (editItalic) style.i = true
    if (editUnderline) style.u = true
    if (editFontSize !== 'base') style.size = editFontSize
    if (editColor !== '#0f172a') style.color = editColor

    const hasCustomStyle = Object.keys(style).length > 0
    const serialized = hasCustomStyle
      ? `<!--rt-->${JSON.stringify(style)}\n${editBody}`
      : editBody

    await updateNote.mutateAsync({ id: noteId, content: serialized })
    setEditingCardId(null)
  }

  function handleAutoLayout() {
    if (cards.length === 0) return

    const cardMap = new Map<string, CanvasCard>()
    for (const c of cards) cardMap.set(c.key, c)

    // Build undirected adjacency graph
    const adj = new Map<string, Set<string>>()
    for (const c of cards) adj.set(c.key, new Set())

    for (const link of links) {
      const srcKey = `${link.source_type}:${link.source_id}`
      const tgtKey = `${link.target_type}:${link.target_id}`
      if (adj.has(srcKey) && adj.has(tgtKey)) {
        adj.get(srcKey)!.add(tgtKey)
        adj.get(tgtKey)!.add(srcKey)
      }
    }

    const visited = new Set<string>()
    const clusters: string[][] = []

    for (const c of cards) {
      if (visited.has(c.key)) continue
      const cluster: string[] = []
      const queue = [c.key]
      visited.add(c.key)
      while (queue.length > 0) {
        const curr = queue.shift()!
        cluster.push(curr)
        for (const neighbor of adj.get(curr) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }
      clusters.push(cluster)
    }

    const newPositions: Record<string, { x: number; y: number }> = { ...positions }
    const batchUpdates: Array<{ item_type: 'excerpt' | 'note'; target_id: string; x: number; y: number }> = []

    let curY = 60
    const startX = 60
    const unlinkedCards: string[] = []

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        unlinkedCards.push(cluster[0])
        continue
      }

      // Pick root node with highest connections
      let rootKey = cluster[0]
      let maxDeg = -1
      for (const k of cluster) {
        const deg = adj.get(k)?.size ?? 0
        if (deg > maxDeg) {
          maxDeg = deg
          rootKey = k
        }
      }

      // BFS layers
      const levels: string[][] = []
      const levelMap = new Map<string, number>()
      const q = [rootKey]
      levelMap.set(rootKey, 0)

      while (q.length > 0) {
        const node = q.shift()!
        const lvl = levelMap.get(node)!
        if (!levels[lvl]) levels[lvl] = []
        levels[lvl].push(node)

        for (const n of adj.get(node) ?? []) {
          if (!levelMap.has(n)) {
            levelMap.set(n, lvl + 1)
            q.push(n)
          }
        }
      }

      let maxClusterHeight = 0
      levels.forEach((nodesInLevel, colIdx) => {
        const levelX = startX + colIdx * 320
        const totalHeight = nodesInLevel.length * 190
        if (totalHeight > maxClusterHeight) maxClusterHeight = totalHeight

        nodesInLevel.forEach((cardKey, rowIdx) => {
          const card = cardMap.get(cardKey)
          if (!card) return
          const cardX = levelX
          const cardY = curY + rowIdx * 190
          newPositions[card.item.id] = { x: cardX, y: cardY }
          batchUpdates.push({
            item_type: card.kind,
            target_id: card.targetId,
            x: cardX,
            y: cardY,
          })
        })
      })

      curY += Math.max(maxClusterHeight + 60, 240)
    }

    // Layout unlinked cards in a neat 3-column grid
    unlinkedCards.forEach((cardKey, idx) => {
      const card = cardMap.get(cardKey)
      if (!card) return
      const col = idx % 3
      const row = Math.floor(idx / 3)
      const cardX = startX + col * 300
      const cardY = curY + row * 180
      newPositions[card.item.id] = { x: cardX, y: cardY }
      batchUpdates.push({
        item_type: card.kind,
        target_id: card.targetId,
        x: cardX,
        y: cardY,
      })
    })

    setPositions(newPositions)
    if (batchUpdates.length > 0) {
      saveBatch.mutate(batchUpdates)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('application/json')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (!isDragOver) setIsDragOver(true)
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    setIsDragOver(false)
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      if (data.type === 'chandaktext/excerpt' && onDropExcerpt) {
        e.preventDefault()
        const rect = containerRef.current?.getBoundingClientRect()
        const scrollLeft = containerRef.current?.scrollLeft ?? 0
        const scrollTop = containerRef.current?.scrollTop ?? 0
        const dropX = e.clientX - (rect?.left ?? 0) + scrollLeft
        const dropY = e.clientY - (rect?.top ?? 0) + scrollTop
        onDropExcerpt(data, { x: Math.max(20, dropX - 110), y: Math.max(20, dropY - 40) })
      }
    } catch (err) {
      console.error('Failed to parse dropped excerpt', err)
    }
  }

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

  const EXCERPT_ACCENT_PALETTE = ['#f59e0b', '#ec4899', '#10b981', '#06b6d4', '#8b5cf6', '#f97316']

  const cards: CanvasCard[] = useMemo(() => {
    const result: CanvasCard[] = []
    for (const item of items) {
      if (item.item_type === 'excerpt') {
        const excerpt = excerpts.find((e) => e.id === item.target_id)
        if (excerpt) {
          const tagWithColor = excerpt.tags?.find((t) => !!t.color)
          const accentColor =
            tagWithColor?.color ||
            EXCERPT_ACCENT_PALETTE[excerpt.page_number % EXCERPT_ACCENT_PALETTE.length]

          result.push({
            key: item.id,
            item,
            kind: 'excerpt',
            targetId: excerpt.id,
            title: `Page ${excerpt.page_number}`,
            body: excerpt.text,
            tags: excerpt.tags ?? [],
            accentColor,
          })
        }
      } else {
        const note = notes.find((n) => n.id === item.target_id)
        if (note) {
          const { style } = parseRichText(note.content ?? '')
          const accentColor = style.color || '#22d3ee'
          result.push({
            key: item.id,
            item,
            kind: 'note',
            targetId: note.id,
            title: note.title || 'Note',
            body: note.content ?? '',
            tags: note.tags ?? [],
            accentColor,
          })
        }
      }
    }
    return result
  }, [items, excerpts, notes])

  function toggleTag(card: CanvasCard, tag: Tag) {
    const currentIds = card.tags.map((t) => t.id)
    const nextIds = currentIds.includes(tag.id)
      ? currentIds.filter((id) => id !== tag.id)
      : [...currentIds, tag.id]

    if (card.kind === 'excerpt') {
      syncExcerptTags.mutate({ excerptId: card.targetId, tagIds: nextIds })
    } else {
      syncNoteTags.mutate({ noteId: card.targetId, tagIds: nextIds })
    }
  }

  async function handleQuickTag(card: CanvasCard, tagName: string) {
    let tag = tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase())
    if (!tag) {
      const def = LEGAL_TAG_DEFS.find((d) => d.name === tagName)
      tag = await createTag.mutateAsync({ name: tagName, color: def?.color })
    }
    toggleTag(card, tag)
  }

  async function handleDeleteCard(card: CanvasCard, e: React.MouseEvent) {
    e.stopPropagation()
    const label = card.kind === 'note' ? 'note' : 'excerpt card'
    if (!window.confirm(`Are you sure you want to remove this ${label} from the workspace canvas?`)) return
    if (card.kind === 'note') {
      await deleteNote.mutateAsync(card.targetId)
    } else {
      await deleteWorkspaceItem.mutateAsync(card.item.id)
    }
  }

  const legalCounts = useMemo(() => {
    const counts = { all: cards.length, exhibit: 0, issue: 0, precedent: 0, contradiction: 0 }
    for (const c of cards) {
      const lTag = c.tags.find((t) =>
        ['issue', 'precedent', 'exhibit', 'contradiction', 'ruling'].includes(t.name.toLowerCase())
      )?.name.toLowerCase()
      if (lTag === 'exhibit') counts.exhibit++
      else if (lTag === 'issue') counts.issue++
      else if (lTag === 'precedent') counts.precedent++
      else if (lTag === 'contradiction') counts.contradiction++
    }
    return counts
  }, [cards])

  const visibleCards = useMemo(() => {
    if (legalFilter === 'all' || !hideNonMatching) return cards
    return cards.filter((c) => {
      const lTag = c.tags.find((t) =>
        ['issue', 'precedent', 'exhibit', 'contradiction', 'ruling'].includes(t.name.toLowerCase())
      )?.name.toLowerCase()
      return lTag === legalFilter
    })
  }, [cards, legalFilter, hideNonMatching])

  async function handleSuggestTags(card: CanvasCard) {
    const names =
      card.kind === 'excerpt'
        ? await suggestExcerptTags.mutateAsync(card.targetId)
        : await suggestNoteTags.mutateAsync(card.targetId)

    setSuggestionsFor({ cardKey: card.key, names })
  }

  async function acceptSuggestion(card: CanvasCard, name: string) {
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
    const tag = existing ?? (await createTag.mutateAsync({ name }))

    toggleTag(card, tag)
    setSuggestionsFor((prev) =>
      prev && prev.cardKey === card.key ? { ...prev, names: prev.names.filter((n) => n !== name) } : prev,
    )
  }

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
    let x = Math.max(0, e.clientX - containerRect.left - drag.offsetX)
    let y = Math.max(0, e.clientY - containerRect.top - drag.offsetY)

    // Magnetic Card Snapping
    const SNAP_DIST = 16
    let guideX: number | undefined
    let guideY: number | undefined
    let candidateStackTarget: string | null = null

    for (const card of cards) {
      if (card.item.id === drag.itemId) continue
      const otherPos = positions[card.item.id] ?? { x: card.item.x, y: card.item.y }

      // Magnetic Card Snapping & Stacking Detection
      const dist = Math.hypot(x - otherPos.x, y - otherPos.y)
      if (dist < 65) {
        candidateStackTarget = card.item.id
      }

      if (Math.abs(x - otherPos.x) < SNAP_DIST) {
        x = otherPos.x
        guideX = x
      }
      const stackY = otherPos.y + card.item.height + 12
      if (Math.abs(y - stackY) < SNAP_DIST) {
        y = stackY
        guideY = y
      } else if (Math.abs(y - otherPos.y) < SNAP_DIST) {
        y = otherPos.y
        guideY = y
      }
    }

    setStackTargetId(candidateStackTarget)
    setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null)

    const prevPos = positions[drag.itemId] ?? { x, y }
    const deltaX = x - prevPos.x
    const deltaY = y - prevPos.y

    const stackChildren = stackGroups.get(drag.itemId)
    if (stackChildren && stackChildren.length > 1) {
      setPositions((prev) => {
        const next = { ...prev, [drag.itemId]: { x, y } }
        for (const childId of stackChildren) {
          if (childId !== drag.itemId) {
            const cp = prev[childId] ?? { x: 0, y: 0 }
            next[childId] = { x: cp.x + deltaX, y: cp.y + deltaY }
          }
        }
        return next
      })
    } else {
      setPositions((prev) => ({ ...prev, [drag.itemId]: { x, y } }))
    }
  }

  function handlePointerUp() {
    const drag = dragState.current
    setSnapGuide(null)
    if (!drag) return

    if (stackTargetId) {
      const targetCard = cards.find((c) => c.item.id === stackTargetId)
      const sourceCard = cards.find((c) => c.item.id === drag.itemId)
      if (targetCard && sourceCard) {
        const targetPos = positions[stackTargetId] ?? { x: targetCard.item.x, y: targetCard.item.y }
        const stackedPos = { x: targetPos.x + 14, y: targetPos.y + 14 }
        setPositions((prev) => ({ ...prev, [drag.itemId]: stackedPos }))
        scheduleSave(drag.itemId, stackedPos.x, stackedPos.y)
        createLink.mutate({
          source_type: sourceCard.kind,
          source_id: sourceCard.targetId,
          target_type: targetCard.kind,
          target_id: targetCard.targetId,
          label: 'stacked',
        })
      }
      setStackTargetId(null)
    } else {
      const stackChildren = stackGroups.get(drag.itemId)
      if (stackChildren && stackChildren.length > 1) {
        for (const cid of stackChildren) {
          const p = positions[cid]
          if (p) scheduleSave(cid, p.x, p.y)
        }
      } else {
        const pos = positions[drag.itemId]
        if (pos) scheduleSave(drag.itemId, pos.x, pos.y)
      }
    }
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

  // Magnetic Idea Stacking: Group cards that are linked with label 'stacked'
  const stackGroups = useMemo(() => {
    const parentMap = new Map<string, string[]>()
    const stackedLinks = (links ?? []).filter((l) => l.label === 'stacked')
    for (const link of stackedLinks) {
      const srcCard = cards.find((c) => c.kind === link.source_type && c.item.target_id === link.source_id)
      const tgtCard = cards.find((c) => c.kind === link.target_type && c.item.target_id === link.target_id)
      if (srcCard && tgtCard && srcCard.item.id !== tgtCard.item.id) {
        const root = tgtCard.item.id
        const list = parentMap.get(root) ?? [root]
        if (!list.includes(srcCard.item.id)) list.push(srcCard.item.id)
        parentMap.set(root, list)
      }
    }
    return parentMap
  }, [cards, links])

  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-[600px] w-full overflow-auto workspace-canvas-bg bg-[radial-gradient(circle,theme(colors.slate.800)_1px,transparent_1px)] bg-[length:20px_20px] transition-colors ${
        isDragOver ? 'ring-2 ring-indigo-500/80 bg-indigo-950/20' : ''
      }`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Visual Drop Zone Indicator */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-indigo-950/40 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-indigo-400/60 bg-slate-900/95 px-6 py-4 shadow-2xl">
            <span className="text-3xl animate-bounce">📥</span>
            <span className="text-sm font-bold text-indigo-300">Drop Excerpt Here</span>
            <span className="text-xs text-slate-400">Card will pin precisely at your drop position</span>
          </div>
        </div>
      )}

      {/* Floating Canvas Action Toolbar */}
      <div className="sticky left-3 top-3 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/90 bg-white/95 px-3 py-1.5 shadow-md backdrop-blur-md text-slate-800">
        <button
          type="button"
          onClick={handleAddTextBox}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-50 border border-blue-200/80 px-2.5 py-1 text-xs font-bold text-blue-700 transition-all hover:bg-blue-100 active:scale-95 cursor-pointer shadow-2xs"
          title="Add a rich styled Text Box to the canvas"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-[10px] font-extrabold text-white">T</span>
          <span className="whitespace-nowrap">+ Add Text Box</span>
        </button>
        <span className="h-4 w-px bg-slate-200" />
        <button
          type="button"
          onClick={handleAutoLayout}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-amber-50 border border-amber-200/80 px-2.5 py-1 text-xs font-bold text-amber-800 transition-all hover:bg-amber-100 active:scale-95 cursor-pointer shadow-2xs"
          title="Automatically organize connected excerpts and notes into a structured mindmap hierarchy"
        >
          <span>🗂️</span>
          <span className="whitespace-nowrap">Auto-Layout Mindmap</span>
        </button>
        <span className="h-4 w-px bg-slate-200" />
        {/* Advocate Tablet Legal Filters */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-0.5 border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setLegalFilter('all')}
            className={`rounded-lg px-2.5 py-1 font-bold whitespace-nowrap transition-all cursor-pointer ${
              legalFilter === 'all' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({legalCounts.all})
          </button>
          <button
            type="button"
            onClick={() => setLegalFilter('exhibit')}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 font-bold whitespace-nowrap transition-all cursor-pointer ${
              legalFilter === 'exhibit' ? 'bg-amber-100 text-amber-900 border border-amber-200/80 shadow-xs' : 'text-slate-600 hover:text-amber-800'
            }`}
            title="Show Court Exhibits only"
          >
            <span>🔍</span>
            <span>Exhibits</span>
            <span className="ml-0.5 rounded-full bg-amber-200/80 px-1.5 text-[10px] text-amber-950 font-black">
              {legalCounts.exhibit}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setLegalFilter('issue')}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 font-bold whitespace-nowrap transition-all cursor-pointer ${
              legalFilter === 'issue' ? 'bg-purple-100 text-purple-900 border border-purple-200/80 shadow-xs' : 'text-slate-600 hover:text-purple-800'
            }`}
            title="Show Legal Issues only"
          >
            <span>⚖️</span>
            <span>Issues</span>
            <span className="ml-0.5 rounded-full bg-purple-200/80 px-1.5 text-[10px] text-purple-950 font-black">
              {legalCounts.issue}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setLegalFilter('precedent')}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 font-bold whitespace-nowrap transition-all cursor-pointer ${
              legalFilter === 'precedent' ? 'bg-blue-100 text-blue-900 border border-blue-200/80 shadow-xs' : 'text-slate-600 hover:text-blue-800'
            }`}
            title="Show Precedents / Case Laws only"
          >
            <span>📜</span>
            <span>Precedents</span>
            <span className="ml-0.5 rounded-full bg-blue-200/80 px-1.5 text-[10px] text-blue-950 font-black">
              {legalCounts.precedent}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setLegalFilter('contradiction')}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 font-bold whitespace-nowrap transition-all cursor-pointer ${
              legalFilter === 'contradiction' ? 'bg-rose-100 text-rose-900 border border-rose-200/80 shadow-xs' : 'text-slate-600 hover:text-rose-800'
            }`}
            title="Show Contradictions for Cross-Examination"
          >
            <span>⚠️</span>
            <span>Contradictions</span>
            <span className="ml-0.5 rounded-full bg-rose-200/80 px-1.5 text-[10px] text-rose-950 font-black">
              {legalCounts.contradiction}
            </span>
          </button>
        </div>

        {legalFilter !== 'all' && (
          <button
            type="button"
            onClick={() => setHideNonMatching((h) => !h)}
            className={`flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-bold transition-all cursor-pointer shadow-2xs ${
              hideNonMatching
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
            }`}
            title={hideNonMatching ? 'Only matching cards are shown (Screen is clean)' : 'Non-matching cards are dimmed'}
          >
            <span>{hideNonMatching ? '🎯 Focus (Filtered)' : '👁️ Show Dimmed'}</span>
          </button>
        )}
      </div>

      <div
        className="relative"
        style={{ width: contentSize.width, height: contentSize.height }}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          {snapGuide?.x !== undefined && (
            <line
              x1={snapGuide.x}
              y1={0}
              x2={snapGuide.x}
              y2={contentSize.height}
              stroke="#38bdf8"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.8}
            />
          )}
          {snapGuide?.y !== undefined && (
            <line
              x1={0}
              y1={snapGuide.y}
              x2={contentSize.width}
              y2={snapGuide.y}
              stroke="#38bdf8"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.8}
            />
          )}
          {links.map((link) => {
            const endpoints = linkEndpoints(link)
            if (!endpoints) return null
            if (legalFilter !== 'all' && hideNonMatching) {
              const srcVisible = visibleCards.some((c) => c.kind === link.source_type && c.item.target_id === link.source_id)
              const tgtVisible = visibleCards.some((c) => c.kind === link.target_type && c.item.target_id === link.target_id)
              if (!srcVisible || !tgtVisible) return null
            }
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

        {/* Empty filter message banner */}
        {visibleCards.length === 0 && legalFilter !== 'all' && (
          <div className="absolute left-1/2 top-24 -translate-x-1/2 z-20 flex flex-col items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/95 p-6 shadow-2xl text-center max-w-sm">
            <span className="text-3xl">🔍</span>
            <h3 className="text-sm font-bold text-slate-200">No cards tagged as "{legalFilter}"</h3>
            <p className="text-xs text-slate-400">
              Click <span className="text-cyan-400 font-bold">+ tag</span> on any card to tag it as {legalFilter}, or view all cards.
            </p>
            <button
              type="button"
              onClick={() => setLegalFilter('all')}
              className="rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-bold text-white transition-all shadow-xs cursor-pointer"
            >
              Show All Cards ({cards.length})
            </button>
          </div>
        )}

        {visibleCards.map((card) => {
          const pos = positions[card.item.id] ?? { x: card.item.x, y: card.item.y }
          const isActive = activeCardId === card.key || activeCardId === card.item.id
          const isMagneticTarget = stackTargetId === card.item.id
          const stackItems = stackGroups.get(card.item.id)
          const isStackHead = Boolean(stackItems && stackItems.length > 1)
          const legalTag = card.tags.find((t) =>
            ['issue', 'precedent', 'exhibit', 'contradiction', 'ruling'].includes(t.name.toLowerCase())
          )?.name.toLowerCase()
          const isDimmed = !hideNonMatching && legalFilter !== 'all' && legalTag !== legalFilter

          return (
            <div
              key={card.key}
              data-card-id={card.item.id}
              data-target-id={card.targetId}
              data-card-kind={card.kind}
              className={`absolute flex cursor-grab flex-col gap-2 rounded-2xl border bg-white p-3.5 active:cursor-grabbing transition-all text-slate-900 ${
                isMagneticTarget
                  ? 'ring-4 ring-indigo-500 bg-indigo-50/90 scale-[1.04] shadow-[0_0_30px_rgba(99,102,241,0.25)] z-30'
                  : isActive
                  ? 'ring-2 ring-blue-600 shadow-xl z-20 border-blue-400'
                  : 'border-slate-200/90 hover:border-slate-300 shadow-[0_4px_16px_rgba(15,23,42,0.06)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.1)]'
              }`}
              style={{
                left: pos.x,
                top: pos.y,
                width: card.item.width,
                minHeight: card.item.height,
                borderLeftColor:
                  legalTag === 'issue'
                    ? '#7c3aed'
                    : legalTag === 'precedent'
                    ? '#2563eb'
                    : legalTag === 'exhibit'
                    ? '#d97706'
                    : legalTag === 'contradiction'
                    ? '#dc2626'
                    : card.accentColor || '#2563eb',
                borderLeftWidth: '5px',
                borderColor: isMagneticTarget ? '#818cf8' : isActive ? '#2563eb' : undefined,
                opacity: isDimmed ? 0.25 : 1,
                boxShadow: isStackHead
                  ? '4px 4px 0px rgba(226, 232, 240, 0.9), 8px 8px 0px rgba(203, 213, 225, 0.7)'
                  : undefined,
              }}
              onPointerDown={(e) => handlePointerDown(e, card.item.id)}
              onMouseEnter={() => onCardHover?.(card.item.id)}
              onMouseLeave={() => onCardHover?.(null)}
              onClick={() => onCardSelect?.(card.item.id)}
              onDoubleClick={() => onOpenCard?.({ type: card.kind, id: card.item.target_id })}
            >
              {/* Advocate Legal Stamp Banner */}
              {legalTag === 'issue' && (
                <div className="mb-0.5 flex items-center gap-1.5 rounded-lg bg-purple-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-purple-900 border border-purple-200">
                  <span>⚖️</span>
                  <span>LEGAL ISSUE / QUESTION</span>
                </div>
              )}
              {legalTag === 'precedent' && (
                <div className="mb-0.5 flex items-center gap-1.5 rounded-lg bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-blue-900 border border-blue-200">
                  <span>📜</span>
                  <span>PRECEDENT / CITATION</span>
                </div>
              )}
              {legalTag === 'exhibit' && (
                <div className="mb-0.5 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-950 border border-amber-200">
                  <span>🔍</span>
                  <span>COURT EXHIBIT</span>
                </div>
              )}
              {legalTag === 'contradiction' && (
                <div className="mb-0.5 flex items-center gap-1.5 rounded-lg bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-900 border border-rose-200">
                  <span>⚠️</span>
                  <span>CONTRADICTION</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={
                      card.kind === 'excerpt'
                        ? 'w-fit rounded-md bg-amber-50 border border-amber-200/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 shadow-2xs'
                        : 'w-fit rounded-md bg-sky-50 border border-sky-200/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-900 shadow-2xs'
                    }
                  >
                    {card.kind === 'excerpt' ? card.title : 'Note'}
                  </span>
                  {isMagneticTarget && (
                    <span className="animate-pulse rounded bg-indigo-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                      🧲 Release to Stack!
                    </span>
                  )}
                  {isStackHead && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedStackCardId(card.item.id)
                      }}
                      className="flex items-center gap-1 rounded-md bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
                      title="Click to view all cards in this stack"
                    >
                      <span>📚 Stack ({stackItems!.length})</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {card.kind === 'excerpt' && (
                    <>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200/90 px-2 py-0.5 text-[10px] font-bold text-slate-700 transition-colors shadow-2xs cursor-pointer"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          const exc = excerpts.find((x) => x.id === card.targetId)
                          if (!exc) return
                          const doc = documents?.find((d) => d.id === exc.document_id)
                          const docName = doc ? ` (${doc.original_filename})` : ''
                          const deepUrl = `${window.location.origin}/projects/${projectId}?card=${card.item.id}`
                          const citationText = `"${exc.text.trim()}" — Page ${exc.page_number}${docName}\nDeep Link: ${deepUrl}`
                          navigator.clipboard.writeText(citationText)
                          setCopiedCardId(card.key)
                          setTimeout(() => setCopiedCardId(null), 1800)
                        }}
                        title="1-Tap Court Citation Copier: formatted quote with document, page citation, and deep link"
                      >
                        {copiedCardId === card.key ? '✓ Copied' : '📋 Quote'}
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 transition-colors shadow-2xs cursor-pointer"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          const deepUrl = `${window.location.origin}/projects/${projectId}?card=${card.item.id}`
                          navigator.clipboard.writeText(deepUrl)
                          setCopiedCardId(card.key + '-link')
                          setTimeout(() => setCopiedCardId(null), 1800)
                        }}
                        title="Copy Deep Link to this card (LiquidText Lesson 9)"
                      >
                        {copiedCardId === card.key + '-link' ? '✓ Copied' : '🔗 Link'}
                      </button>
                      {onNavigateToSource && (
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 transition-colors shadow-2xs cursor-pointer"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            const exc = excerpts.find((x) => x.id === card.targetId)
                            if (exc) onNavigateToSource(exc)
                          }}
                          title="Jump to source page in PDF reader"
                        >
                          ↗ View in Doc
                        </button>
                      )}
                    </>
                  )}
                  {card.kind === 'note' && (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200/90 px-2 py-0.5 text-[10px] font-bold text-slate-700 transition-colors shadow-2xs cursor-pointer"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStartEditNote(card)
                      }}
                      title="Edit text and styling"
                    >
                      ✎ Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex items-center justify-center rounded-md p-1 text-[11px] text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => handleDeleteCard(card, e)}
                    title="Delete card from canvas"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {editingCardId === card.targetId ? (
                <div
                  className="mt-1 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 shadow-xs"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Rich Styling Toolbar */}
                  <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-1.5 text-xs">
                    <button
                      type="button"
                      className={`h-6 w-6 rounded font-bold transition-colors cursor-pointer ${
                        editBold ? 'bg-blue-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                      onClick={() => setEditBold((b) => !b)}
                      title="Bold"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      className={`h-6 w-6 rounded font-serif italic transition-colors cursor-pointer ${
                        editItalic ? 'bg-blue-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                      onClick={() => setEditItalic((i) => !i)}
                      title="Italic"
                    >
                      I
                    </button>
                    <button
                      type="button"
                      className={`h-6 w-6 rounded underline transition-colors cursor-pointer ${
                        editUnderline ? 'bg-blue-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                      onClick={() => setEditUnderline((u) => !u)}
                      title="Underline"
                    >
                      U
                    </button>
                    <span className="h-4 w-px bg-slate-200" />
                    <button
                      type="button"
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold cursor-pointer ${
                        editFontSize === 'sm' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                      onClick={() => setEditFontSize('sm')}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold cursor-pointer ${
                        editFontSize === 'base' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                      onClick={() => setEditFontSize('base')}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold cursor-pointer ${
                        editFontSize === 'lg' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                      onClick={() => setEditFontSize('lg')}
                    >
                      L
                    </button>
                    <span className="h-4 w-px bg-slate-200" />
                    {['#0f172a', '#1e3a8a', '#b45309', '#047857', '#b91c1c'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`h-4 w-4 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                          editColor === color ? 'ring-2 ring-blue-500 scale-110' : 'border-slate-300'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setEditColor(color)}
                      />
                    ))}
                  </div>

                  <textarea
                    rows={3}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none text-xs"
                    style={{
                      fontWeight: editBold ? 'bold' : 'normal',
                      fontStyle: editItalic ? 'italic' : 'normal',
                      textDecoration: editUnderline ? 'underline' : 'none',
                      fontSize: editFontSize === 'sm' ? '12px' : editFontSize === 'lg' ? '16px' : '13.5px',
                      color: editColor,
                    }}
                    autoFocus
                  />

                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                      onClick={() => setEditingCardId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 shadow-2xs transition-colors cursor-pointer"
                      onClick={() => handleSaveNoteEdit(card.targetId)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="cursor-text py-1 px-0.5 rounded-lg hover:bg-slate-50/70 transition-colors"
                  onDoubleClick={(e) => {
                    if (card.kind === 'note') {
                      e.stopPropagation()
                      handleStartEditNote(card)
                    }
                  }}
                >
                  <RichTextContent content={card.body} />
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
                {card.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-md border border-slate-200/90 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-800 shadow-2xs"
                    style={{
                      borderLeftColor: tagColor(tag),
                      borderLeftWidth: '3px',
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
                <button
                  type="button"
                  className="rounded-md border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 px-2 py-0.5 text-[10px] font-bold text-slate-700 transition-colors cursor-pointer shadow-2xs"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setTagMenuFor((prev) => (prev === card.key ? null : card.key))
                  }}
                >
                  + tag
                </button>
                <button
                  type="button"
                  className="rounded-md border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                  disabled={suggestExcerptTags.isPending || suggestNoteTags.isPending}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSuggestTags(card)
                  }}
                >
                  ✨ suggest
                </button>
              </div>

              {suggestionsFor?.cardKey === card.key && (
                <div
                  className="mt-1 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2 shadow-xs"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {suggestionsFor.names.length === 0 ? (
                    <span className="text-[10px] text-slate-500">No suggestions.</span>
                  ) : (
                    suggestionsFor.names.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-800 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors cursor-pointer"
                        onClick={() => acceptSuggestion(card, name)}
                      >
                        + {name}
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    className="ml-auto text-[10px] text-slate-500 hover:underline cursor-pointer"
                    onClick={() => setSuggestionsFor(null)}
                  >
                    dismiss
                  </button>
                </div>
              )}

              {tagMenuFor === card.key && (
                <div
                  className="absolute left-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-slate-700 bg-slate-900/98 p-2.5 shadow-2xl backdrop-blur-md"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Quick Legal Tag Categories */}
                  <div className="mb-2 border-b border-slate-800 pb-2">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Legal Categories
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {LEGAL_TAG_DEFS.map((def) => {
                        const hasTag = card.tags.some((t) => t.name.toLowerCase() === def.name)
                        return (
                          <button
                            key={def.name}
                            type="button"
                            onClick={() => handleQuickTag(card, def.name)}
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                              hasTag
                                ? 'bg-blue-600 text-white shadow-xs ring-1 ring-blue-400'
                                : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                            }`}
                          >
                            <span>{def.icon}</span>
                            <span>{def.label}</span>
                            {hasTag && <span className="ml-auto text-[10px] font-black">✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Custom Tags
                  </p>
                  {tags.filter((t) => !['issue', 'precedent', 'exhibit', 'contradiction', 'ruling'].includes(t.name.toLowerCase())).length === 0 && (
                    <p className="px-1 py-0.5 text-[11px] text-slate-500">No custom tags yet.</p>
                  )}
                  <div className="max-h-36 overflow-y-auto space-y-0.5">
                    {tags
                      .filter((t) => !['issue', 'precedent', 'exhibit', 'contradiction', 'ruling'].includes(t.name.toLowerCase()))
                      .map((tag) => {
                        const checked = card.tags.some((t) => t.id === tag.id)
                        return (
                          <label
                            key={tag.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTag(card, tag)}
                            />
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: tagColor(tag) }}
                            />
                            <span className="truncate">{tag.name}</span>
                          </label>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Floating Stack Fan-Out Inspector */}
      {expandedStackCardId &&
        (() => {
          const stackIds = stackGroups.get(expandedStackCardId) ?? [expandedStackCardId]
          const stackCards = stackIds
            .map((id) => cards.find((c) => c.item.id === id))
            .filter(Boolean) as CanvasCard[]

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={() => setExpandedStackCardId(null)}
            >
              <div
                className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-indigo-500/50 bg-slate-900 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📚</span>
                    <h3 className="font-bold text-slate-100">Idea Stack ({stackCards.length} Cards)</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedStackCardId(null)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                  {stackCards.map((sc, idx) => (
                    <div
                      key={sc.key}
                      className="group relative flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-4 transition-all hover:border-indigo-500/40"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-indigo-400 font-semibold">#{idx + 1}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              sc.kind === 'excerpt' ? 'bg-amber-400/20 text-amber-300' : 'bg-cyan-400/20 text-cyan-300'
                            }`}
                          >
                            {sc.kind === 'excerpt' ? sc.title : 'Note'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {sc.kind === 'excerpt' && onNavigateToSource && (
                            <button
                              type="button"
                              onClick={() => {
                                const exc = excerpts.find((x) => x.id === sc.targetId)
                                if (exc) {
                                  onNavigateToSource(exc)
                                  setExpandedStackCardId(null)
                                }
                              }}
                              className="rounded bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
                            >
                              ↗ View in Doc
                            </button>
                          )}
                          {idx > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const headPos = positions[expandedStackCardId] ?? { x: 100, y: 100 }
                                const unstackedPos = { x: headPos.x + 300, y: headPos.y + idx * 40 }
                                setPositions((prev) => ({ ...prev, [sc.item.id]: unstackedPos }))
                                scheduleSave(sc.item.id, unstackedPos.x, unstackedPos.y)
                              }}
                              className="rounded bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white"
                              title="Pop this card out of the stack onto open canvas"
                            >
                              ⤢ Unstack
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">{sc.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
