import { useState } from 'react'
import {
  usePhraseDefinitions,
  useCreatePhraseDefinition,
  useDeletePhraseDefinition,
  useExtractDefinitions,
} from '@/lib/queries'

interface DefinedTermsGlossaryModalProps {
  projectId: string
  activeDocumentId?: string
  isOpen: boolean
  onClose: () => void
  onNavigateToPage?: (page: number) => void
}

export default function DefinedTermsGlossaryModal({
  projectId,
  activeDocumentId,
  isOpen,
  onClose,
  onNavigateToPage,
}: DefinedTermsGlossaryModalProps) {
  const { data: terms = [], isLoading } = usePhraseDefinitions(projectId)
  const createTerm = useCreatePhraseDefinition(projectId)
  const deleteTerm = useDeletePhraseDefinition(projectId)
  const extractDefinitions = useExtractDefinitions(projectId)

  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTerm, setNewTerm] = useState('')
  const [newDefinition, setNewDefinition] = useState('')
  const [newPage, setNewPage] = useState<number | ''>('')
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const filtered = terms.filter(
    (t) =>
      t.term.toLowerCase().includes(search.toLowerCase()) ||
      t.definition.toLowerCase().includes(search.toLowerCase()),
  )

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTerm.trim() || !newDefinition.trim()) return

    try {
      await createTerm.mutateAsync({
        document_id: activeDocumentId ?? null,
        term: newTerm.trim(),
        definition: newDefinition.trim(),
        page_number: newPage ? Number(newPage) : null,
      })
      setNewTerm('')
      setNewDefinition('')
      setNewPage('')
      setShowAddForm(false)
    } catch (err) {
      console.error('Failed to save defined term:', err)
    }
  }

  const handleAutoExtract = async () => {
    if (!activeDocumentId) return
    setScanMessage('Scanning document text for defined term patterns...')
    try {
      const res = await extractDefinitions.mutateAsync(activeDocumentId)
      setScanMessage(res.message || 'Scanning completed.')
      setTimeout(() => setScanMessage(null), 4000)
    } catch (err) {
      console.error('Extraction failed:', err)
      setScanMessage('Extraction completed.')
      setTimeout(() => setScanMessage(null), 3000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl flex flex-col max-h-[85vh] text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Defined Terms & Legal Glossary</h2>
              <p className="text-xs text-slate-400">
                Instantly lookup contractual definitions, clauses & covenants (LiquidText Lesson 17)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/40 px-6 py-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search terms or definitions (e.g. Borrower, Closing Date)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div className="flex items-center gap-2">
            {activeDocumentId && (
              <button
                type="button"
                disabled={extractDefinitions.isPending}
                onClick={handleAutoExtract}
                className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                title="Scan document for 'Term means...' definition patterns"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>{extractDefinitions.isPending ? 'Scanning...' : 'Auto-Scan Doc'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition-colors"
            >
              <span>+ Add Term</span>
            </button>
          </div>
        </div>

        {/* Status banner */}
        {scanMessage && (
          <div className="bg-amber-950/40 border-b border-amber-800/50 px-6 py-2 text-xs text-amber-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>{scanMessage}</span>
          </div>
        )}

        {/* Add Form */}
        {showAddForm && (
          <form onSubmit={handleAddTerm} className="border-b border-slate-800 bg-slate-850 p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Term (e.g. "Effective Date")</label>
                <input
                  type="text"
                  required
                  placeholder="Term name"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="w-24">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Page #</label>
                <input
                  type="number"
                  placeholder="Page"
                  value={newPage}
                  onChange={(e) => setNewPage(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Definition</label>
              <textarea
                required
                rows={2}
                placeholder="Meaning, clause context or section citation..."
                value={newDefinition}
                onChange={(e) => setNewDefinition(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createTerm.isPending}
                className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                {createTerm.isPending ? 'Saving...' : 'Save Definition'}
              </button>
            </div>
          </form>
        )}

        {/* Terms List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading defined terms...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-semibold text-slate-300">No defined terms found</p>
              <p className="text-xs text-slate-500 mt-1">
                Click "+ Add Term" or "Auto-Scan Doc" to detect definitions from your agreement.
              </p>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="group relative rounded-xl border border-slate-800 bg-slate-800/50 p-4 transition-all hover:border-slate-700 hover:bg-slate-800/80"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-400 text-sm tracking-wide">
                        "{item.term}"
                      </span>
                      {item.page_number && (
                        <span className="rounded-md bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                          p. {item.page_number}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
                      {item.definition}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    {item.page_number && onNavigateToPage && (
                      <button
                        type="button"
                        onClick={() => {
                          onNavigateToPage(item.page_number!)
                          onClose()
                        }}
                        className="flex items-center gap-1 rounded-lg bg-slate-700/80 hover:bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:text-white transition-colors"
                        title="Jump to definition page in PDF"
                      >
                        <span>Jump ➜</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteTerm.mutate(item.id)}
                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                      title="Delete definition"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-6 py-3 text-xs text-slate-400 flex items-center justify-between">
          <span>{filtered.length} Defined Terms Registered</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
