import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui'
import { apiErrorMessage } from '@/lib/api'
import { useChatWithDocument, useSummarizeDocument } from '@/lib/queries'
import type { Document } from '@/types/api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Phase 6: summarize + chat, backed by whatever AiProvider the admin has
 * configured (AI_PROVIDER env - see backend/app/Providers/AiServiceProvider.php).
 * The default 'fake' driver returns clearly-labeled canned text, so this UI
 * works out of the box without a real API key, same as the rest of the app. */
export default function AiDocumentPanel({ projectId, document }: { projectId: string; document: Document }) {
  const summarize = useSummarizeDocument(projectId)
  const chat = useChatWithDocument()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')

  async function handleSummarize(force: boolean) {
    setError(null)
    try {
      await summarize.mutateAsync({ documentId: document.id, force })
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not generate a summary.'))
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const message = draft.trim()
    if (!message) return

    setError(null)
    setDraft('')
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: message }]
    setMessages(nextMessages)

    try {
      const reply = await chat.mutateAsync({ documentId: document.id, message, history: messages })
      setMessages([...nextMessages, { role: 'assistant', content: reply }])
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not get a reply.'))
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition-colors cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <span>✨</span>
        <span>Ask AI</span>
      </button>
    )
  }

  return (
    <div className="mt-1 space-y-2 rounded-md border border-slate-700 bg-slate-950 p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">AI assistant</span>
        <button type="button" className="text-[11px] text-slate-500 hover:underline" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div>
        {document.ai_summary ? (
          <p className="whitespace-pre-wrap text-[11px] text-slate-300">{document.ai_summary}</p>
        ) : (
          <p className="text-[11px] text-slate-500">No summary yet.</p>
        )}
        <button
          type="button"
          className="mt-1 text-[11px] text-accent hover:underline disabled:opacity-50"
          disabled={summarize.isPending}
          onClick={() => handleSummarize(!!document.ai_summary)}
        >
          {summarize.isPending ? 'Summarizing…' : document.ai_summary ? 'Re-summarize' : 'Summarize'}
        </button>
      </div>

      <div className="max-h-40 space-y-1 overflow-y-auto border-t border-slate-800 pt-2">
        {messages.map((m, i) => (
          <p key={i} className={`text-[11px] ${m.role === 'user' ? 'text-slate-200' : 'text-cyan-300'}`}>
            <span className="font-medium">{m.role === 'user' ? 'You: ' : 'AI: '}</span>
            {m.content}
          </p>
        ))}
        {chat.isPending && <p className="text-[11px] text-slate-500">Thinking…</p>}
      </div>

      <form onSubmit={handleSend} className="flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about this document…"
          className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 placeholder:text-slate-500"
        />
        <Button type="submit" className="py-1 text-xs" disabled={chat.isPending}>
          Send
        </Button>
      </form>
    </div>
  )
}
