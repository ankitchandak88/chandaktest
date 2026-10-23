import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui'

export default function AppShell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, organizations, organizationId, setOrganization, logout } = useAuthStore()

  function handleLogout() {
    // Air-tight multi-tenant purge: clear query cache and local vault storage
    queryClient.clear()
    try {
      const toRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (k.startsWith('chandaktext:vault:') || k.startsWith('chandaktext:recent:'))) {
          toRemove.push(k)
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k))
    } catch {
      // Ignore in restricted environments
    }
    logout()
    navigate('/login')
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'AD'

  return (
    <div className="flex min-h-full flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/95 px-6 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] backdrop-blur-md">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm font-bold text-base transition-transform group-hover:scale-105">
            ⚖️
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-slate-900 tracking-tight text-base">ChandakText</span>
              <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200/60 uppercase tracking-wider">
                Advocate Suite
              </span>
            </div>
            <span className="text-[10px] font-medium text-slate-500 tracking-wide">Litigation Brief & Canvas</span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          {organizations.length > 1 && (
            <select
              value={organizationId ?? ''}
              onChange={(e) => setOrganization(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs focus:border-blue-600 focus:outline-none"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  🏛️ {org.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-1 text-xs">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white text-[11px] font-bold">
              {initials}
            </span>
            <span className="font-semibold text-slate-800">{user?.name}</span>
          </div>

          <Button
            variant="ghost"
            onClick={handleLogout}
            className="text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg"
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1 bg-slate-50">
        <Outlet />
      </main>
    </div>
  )
}
