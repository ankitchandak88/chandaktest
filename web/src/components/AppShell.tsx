import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui'

/**
 * Top-level shell: a slim header with workspace switcher + sign out, and
 * the current route rendered below. Project workspace pages (which need
 * the full viewport for the PDF + canvas split view) render their own
 * full-height layout inside <Outlet /> rather than fighting this shell's
 * padding.
 */
export default function AppShell() {
  const navigate = useNavigate()
  const { user, organizations, organizationId, setOrganization, logout } = useAuthStore()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <Link to="/" className="font-semibold text-slate-100">
          ChandakText
        </Link>

        <div className="flex items-center gap-3">
          {organizations.length > 1 && (
            <select
              value={organizationId ?? ''}
              onChange={(e) => setOrganization(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <span className="text-sm text-slate-400">{user?.name}</span>
          <Button variant="ghost" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
