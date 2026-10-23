import { useState, useEffect, type FormEvent } from 'react'
import type { Document, Excerpt } from '@/types/api'
import { Button } from '@/components/ui'

export interface ChronologyEvent {
  id: string
  date: string
  event: string
  pageNumber: number
  documentId?: string
  documentName?: string
  excerptText?: string
  tag?: string
}

interface CaseChronologyModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  documents?: Document[]
  excerpts?: Excerpt[]
  onNavigateToPage?: (docId: string | undefined, pageNumber: number) => void
}

export default function CaseChronologyModal({
  isOpen,
  onClose,
  projectId,
  documents = [],
  excerpts = [],
  onNavigateToPage,
}: CaseChronologyModalProps) {
  const [events, setEvents] = useState<ChronologyEvent[]>([])
  const [newDate, setNewDate] = useState('')
  const [newEvent, setNewEvent] = useState('')
  const [newPage, setNewPage] = useState<number>(1)
  const [newDocId, setNewDocId] = useState<string>(documents[0]?.id ?? '')
  const [newTag, setNewTag] = useState<string>('exhibit')
  const [copySuccess, setCopySuccess] = useState(false)

  const storageKey = `chandaktext:chronology:${projectId}`

  // Load saved chronology events from localStorage & merge with excerpt dates
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      const parsed: ChronologyEvent[] = saved ? JSON.parse(saved) : []

      // Also auto-extract from excerpts tagged with Date or having date-like content
      const excerptEvents: ChronologyEvent[] = []
      for (const exc of excerpts) {
        const dateTag = exc.tags?.find((t) => t.name.toLowerCase().startsWith('date:') || t.name.toLowerCase().includes('date') || t.name.toLowerCase().includes('chronology'))
        if (dateTag) {
          const dateStr = dateTag.name.replace(/^(date:|chronology:?)\s*/i, '').trim() || exc.created_at.slice(0, 10)
          const doc = documents.find((d) => d.id === exc.document_id)
          excerptEvents.push({
            id: `exc-${exc.id}`,
            date: dateStr,
            event: exc.text.length > 90 ? exc.text.slice(0, 90) + '…' : exc.text,
            pageNumber: exc.page_number,
            documentId: exc.document_id,
            documentName: doc?.original_filename,
            excerptText: exc.text,
            tag: exc.tags?.find((t) => ['issue', 'precedent', 'exhibit', 'contradiction'].includes(t.name.toLowerCase()))?.name || 'exhibit',
          })
        }
      }

      // Merge avoiding duplicates
      const merged = [...parsed]
      for (const ee of excerptEvents) {
        if (!merged.some((m) => m.id === ee.id || (m.pageNumber === ee.pageNumber && m.date === ee.date))) {
          merged.push(ee)
        }
      }

      // Sort chronologically
      merged.sort((a, b) => a.date.localeCompare(b.date))
      setEvents(merged)
    } catch {
      // Fallback
    }
  }, [projectId, storageKey, excerpts, documents])

  if (!isOpen) return null

  function saveEvents(updated: ChronologyEvent[]) {
    updated.sort((a, b) => a.date.localeCompare(b.date))
    setEvents(updated)
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated.filter((e) => !e.id.startsWith('exc-'))))
    } catch {}
  }

  function handleAddEvent(e: FormEvent) {
    e.preventDefault()
    if (!newDate.trim() || !newEvent.trim()) return

    const doc = documents.find((d) => d.id === newDocId)
    const newEntry: ChronologyEvent = {
      id: `manual-${Date.now()}`,
      date: newDate.trim(),
      event: newEvent.trim(),
      pageNumber: Number(newPage) || 1,
      documentId: newDocId || undefined,
      documentName: doc?.original_filename,
      tag: newTag,
    }

    saveEvents([...events, newEntry])
    setNewDate('')
    setNewEvent('')
  }

  function handleDeleteEvent(id: string) {
    saveEvents(events.filter((e) => e.id !== id))
  }

  function copyCourtSynopsis() {
    let text = 'SYNOPSIS & LIST OF DATES AND EVENTS\n'
    text += '========================================================================================================================\n'
    text += 'DATE              PARTICULARS OF EVENTS                                                PAGE NO. / ANNEXURE\n'
    text += '========================================================================================================================\n'

    for (const ev of events) {
      const dateCol = ev.date.padEnd(16)
      const evCol = ev.event.padEnd(65).slice(0, 65)
      const pageCol = `Page ${ev.pageNumber}${ev.documentName ? ` (${ev.documentName})` : ''}`
      text += `${dateCol}  ${evCol}  ${pageCol}\n`
    }
    text += '========================================================================================================================\n'

    navigator.clipboard.writeText(text)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📅</span>
            <div>
              <h2 className="text-lg font-black text-slate-100">
                List of Dates & Case Chronology
              </h2>
              <p className="text-xs text-slate-400">
                Indian Court Synopsis Timeline: chronological sequence connecting dates, facts & document pages
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyCourtSynopsis}
              className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/30"
              title="Copy formatted List of Dates table ready for High Court / Supreme Court filing"
            >
              <span>{copySuccess ? '✓ Copied Table!' : '📋 Copy Court Synopsis'}</span>
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Add Date Form */}
          <form
            onSubmit={handleAddEvent}
            className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 shadow-sm"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
              <span>➕</span>
              <span>Add Chronological Event / Date to Synopsis</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Date (DD/MM/YYYY or Year) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 12/04/2018"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Pleadings / Document
                </label>
                <select
                  value={newDocId}
                  onChange={(e) => setNewDocId(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none truncate"
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.original_filename}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Page No.
                </label>
                <input
                  type="number"
                  min={1}
                  value={newPage}
                  onChange={(e) => setNewPage(parseInt(e.target.value) || 1)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Legal Category
                </label>
                <select
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="exhibit">🔍 Court Exhibit / Document</option>
                  <option value="issue">⚖️ Legal Issue / Cause of Action</option>
                  <option value="contradiction">⚠️ Contradiction / Discrepancy</option>
                  <option value="precedent">📜 Precedent / Judgment</option>
                </select>
              </div>
              <div className="sm:col-span-10">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Particulars of Event / Synopsis Description *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Agreement of Sale executed between Petitioner and Respondent No. 1 acknowledging receipt of consideration."
                  value={newEvent}
                  onChange={(e) => setNewEvent(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" className="w-full text-xs py-1.5 font-bold">
                  Add Event
                </Button>
              </div>
            </div>
          </form>

          {/* Chronological Timeline */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <span>📜</span>
                <span>Case Chronology Timeline ({events.length} Events)</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                Click any page to jump instantly in the PDF reader
              </span>
            </div>

            {events.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 rounded-xl border border-slate-800 bg-slate-950/40">
                No chronological events recorded yet. Add an event above or tag any document excerpt with `Date: DD/MM/YYYY`.
              </div>
            ) : (
              <div className="relative border-l-2 border-cyan-500/40 ml-4 pl-6 space-y-4">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    className="relative group rounded-xl border border-slate-800 bg-slate-950/90 p-4 transition-all hover:border-cyan-500/50 hover:shadow-lg"
                  >
                    {/* Timeline Node Dot */}
                    <div className="absolute -left-[31px] top-4.5 h-3.5 w-3.5 rounded-full border-2 border-slate-950 bg-cyan-400 shadow" />

                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-cyan-500/20 px-2.5 py-0.5 text-xs font-black text-cyan-300 border border-cyan-500/30">
                          {ev.date}
                        </span>
                        {ev.tag === 'issue' && (
                          <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/30">
                            ⚖️ ISSUE
                          </span>
                        )}
                        {ev.tag === 'exhibit' && (
                          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                            🔍 EXHIBIT
                          </span>
                        )}
                        {ev.tag === 'contradiction' && (
                          <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300 border border-rose-500/30">
                            ⚠️ CONTRADICTION
                          </span>
                        )}
                        {ev.tag === 'precedent' && (
                          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-blue-300 border border-blue-500/30">
                            📜 PRECEDENT
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onNavigateToPage?.(ev.documentId, ev.pageNumber)
                            onClose()
                          }}
                          className="flex items-center gap-1 rounded bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-300 border border-amber-500/30 transition-colors hover:bg-amber-500/30"
                          title="Jump directly to this page in the Court Document"
                        >
                          <span>📄 Page {ev.pageNumber}</span>
                          {ev.documentName && (
                            <span className="max-w-[120px] truncate text-[10px] opacity-80">
                              ({ev.documentName})
                            </span>
                          )}
                          <span>➔</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="text-slate-500 hover:text-red-400 p-1 text-xs"
                          title="Delete event"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <p className="mt-2 text-xs font-medium text-slate-100 leading-relaxed">
                      {ev.event}
                    </p>

                    {ev.excerptText && (
                      <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 p-2 text-[11px] text-slate-400 italic">
                        "{ev.excerptText}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-6 py-3">
          <p className="text-[11px] text-slate-500">
            Chronology can be exported as standard Indian High Court / Supreme Court Synopsis text.
          </p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
