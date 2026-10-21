import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui'
import { useUpdateDocumentCitation } from '@/lib/queries'
import type { CitationMetadata, Document } from '@/types/api'

/** PROD-004: lets a user attach bibliographic metadata to a document and
 * get back ready-to-use APA/MLA strings (formatted server-side, see
 * App\Services\CitationFormatter, so there's one source of truth shared
 * with export/mobile rather than duplicating formatting logic here). */
export default function CitationEditor({ projectId, document }: { projectId: string; document: Document }) {
  const updateCitation = useUpdateDocumentCitation(projectId)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<CitationMetadata>(document.citation_metadata ?? {})
  const [copied, setCopied] = useState<'apa' | 'mla' | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const citation = Object.fromEntries(
      Object.entries(form).filter(([, v]) => (v ?? '').toString().trim() !== ''),
    )
    await updateCitation.mutateAsync({
      documentId: document.id,
      citation: Object.keys(citation).length > 0 ? citation : null,
    })
    setEditing(false)
  }

  function copy(style: 'apa' | 'mla', text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(style)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  if (!editing && !document.citation_apa) {
    return (
      <button
        type="button"
        className="mt-1 text-xs text-accent hover:underline"
        onClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
      >
        + Add citation
      </button>
    )
  }

  if (!editing) {
    return (
      <div className="mt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
        {document.citation_apa && (
          <p className="flex items-start gap-1 text-[11px] text-slate-400">
            <span className="shrink-0 font-medium text-slate-500">APA:</span>
            <span className="flex-1">{document.citation_apa}</span>
            <button
              type="button"
              className="shrink-0 text-accent hover:underline"
              onClick={() => copy('apa', document.citation_apa!)}
            >
              {copied === 'apa' ? 'Copied' : 'Copy'}
            </button>
          </p>
        )}
        {document.citation_mla && (
          <p className="flex items-start gap-1 text-[11px] text-slate-400">
            <span className="shrink-0 font-medium text-slate-500">MLA:</span>
            <span className="flex-1">{document.citation_mla}</span>
            <button
              type="button"
              className="shrink-0 text-accent hover:underline"
              onClick={() => copy('mla', document.citation_mla!)}
            >
              {copied === 'mla' ? 'Copied' : 'Copy'}
            </button>
          </p>
        )}
        <button type="button" className="text-[11px] text-slate-500 hover:underline" onClick={() => setEditing(true)}>
          Edit citation
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
      className="mt-1 space-y-1 rounded-md border border-slate-700 bg-slate-950 p-2"
    >
      {(['title', 'author', 'year', 'publisher', 'url'] as const).map((field) => (
        <input
          key={field}
          value={form[field] ?? ''}
          onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
          placeholder={field === 'title' ? 'Title (required to generate a citation)' : field}
          className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 placeholder:text-slate-500"
        />
      ))}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1 py-1 text-xs" disabled={updateCitation.isPending}>
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="flex-1 py-1 text-xs"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
