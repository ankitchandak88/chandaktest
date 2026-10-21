import { type FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, apiErrorMessage } from '@/lib/api'
import { Card, Spinner } from '@/components/ui'

interface SharedContent {
  project_name: string
  excerpts: { id: string; page_number: number; text: string }[]
  notes: { id: string; title: string | null; content: string | null }[]
}

/** Public, unauthenticated view for a project share link (PROD-002) - no
 * ProtectedRoute, no auth store reads. Mirrors ProjectShareController's
 * two-step flow: check whether a password is needed, then fetch the
 * compiled (notes+excerpts only, never the source PDF) content. */
export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [requiresPassword, setRequiresPassword] = useState(false)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [password, setPassword] = useState('')
  const [content, setContent] = useState<SharedContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api
      .get(`/shares/${token}`)
      .then(({ data }) => {
        setProjectName(data.data.project_name)
        setRequiresPassword(data.data.requires_password)
        if (!data.data.requires_password) {
          return api.post(`/shares/${token}/content`).then(({ data }) => setContent(data.data))
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoadingMeta(false))
  }, [token])

  async function handleUnlock(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const { data } = await api.post(`/shares/${token}/content`, { password })
      setContent(data.data)
    } catch (err) {
      setError(apiErrorMessage(err, 'Incorrect password.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingMeta) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Spinner />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <Card className="max-w-sm text-center">
          <h1 className="mb-2 text-lg font-semibold text-slate-100">Link not available</h1>
          <p className="text-sm text-slate-400">
            This share link has expired, been revoked, or never existed.
          </p>
        </Card>
      </div>
    )
  }

  if (requiresPassword && !content) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-1 text-lg font-semibold text-slate-100">{projectName}</h1>
          <p className="mb-4 text-sm text-slate-400">This shared workspace is password-protected.</p>
          <form onSubmit={handleUnlock} className="space-y-3">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-cyan-300 disabled:opacity-50"
            >
              {submitting ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold text-slate-100">{content?.project_name}</h1>
        <p className="mb-6 text-sm text-slate-500">
          Shared read-only view · {content?.excerpts.length ?? 0} excerpts · {content?.notes.length ?? 0} notes
        </p>

        {content?.notes.length ? (
          <section className="mb-8">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">Notes</h2>
            <div className="space-y-2">
              {content.notes.map((note) => (
                <Card key={note.id}>
                  {note.title && <p className="mb-1 font-medium text-slate-100">{note.title}</p>}
                  <p className="whitespace-pre-wrap text-sm text-slate-300">{note.content}</p>
                </Card>
              ))}
            </div>
          </section>
        ) : null}

        {content?.excerpts.length ? (
          <section>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">Excerpts</h2>
            <div className="space-y-2">
              {content.excerpts.map((excerpt) => (
                <Card key={excerpt.id}>
                  <p className="mb-1 text-xs text-slate-500">Page {excerpt.page_number}</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-300">{excerpt.text}</p>
                </Card>
              ))}
            </div>
          </section>
        ) : null}

        {!content?.notes.length && !content?.excerpts.length && (
          <p className="text-sm text-slate-500">This project has no notes or excerpts yet.</p>
        )}
      </div>
    </div>
  )
}
