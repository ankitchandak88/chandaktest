import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui'
import { apiErrorMessage } from '@/lib/api'
import { useCreateShare, useRevokeShare, useShares } from '@/lib/queries'

/** PROD-002: create/list/revoke read-only share links for a project. Scope
 * locked in (see ProjectShareController's docblock on the backend): the
 * shared view is a compiled notes+excerpts page, never the raw source PDF,
 * optional password, always a bounded expiry. */
export default function ShareManager({ projectId }: { projectId: string }) {
  const { data: shares } = useShares(projectId)
  const createShare = useCreateShare(projectId)
  const revokeShare = useRevokeShare(projectId)
  const [showForm, setShowForm] = useState(false)
  const [password, setPassword] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('7')
  const [error, setError] = useState<string | null>(null)
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)

    try {
      const share = await createShare.mutateAsync({
        password: password.trim() || undefined,
        expires_in_days: expiresInDays ? Number(expiresInDays) : undefined,
      })
      setJustCreatedUrl(`${window.location.origin}/share/${share.token}`)
      setPassword('')
      setShowForm(false)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the share link.'))
    }
  }

  const activeShares = (shares ?? []).filter((s) => !s.revoked_at && new Date(s.expires_at) > new Date())

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-300">Share links</h2>
        <button
          type="button"
          className="text-xs text-accent hover:underline"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : '+ New link'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-2 space-y-2 rounded-md border border-slate-700 p-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Optional password"
            className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 placeholder:text-slate-500"
          />
          <input
            type="number"
            min={1}
            max={90}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="Expires in days"
            className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 placeholder:text-slate-500"
          />
          <Button type="submit" className="w-full py-1 text-xs" disabled={createShare.isPending}>
            Create link
          </Button>
        </form>
      )}

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      {justCreatedUrl && (
        <p className="mb-2 break-all rounded-md bg-slate-800 p-2 text-xs text-accent">{justCreatedUrl}</p>
      )}

      {activeShares.length === 0 ? (
        <p className="text-xs text-slate-500">No active share links.</p>
      ) : (
        <ul className="space-y-1">
          {activeShares.map((share) => (
            <li
              key={share.id}
              className="flex items-center justify-between rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300"
            >
              <span>Expires {new Date(share.expires_at).toLocaleDateString()}</span>
              <button
                type="button"
                className="text-red-400 hover:underline"
                onClick={() => revokeShare.mutate(share.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
