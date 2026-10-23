import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useCreateProject,
  useCurrentOrganization,
  useOrganizationMembers,
  useProjects,
  useUsage,
} from '@/lib/queries'
import { apiErrorMessage } from '@/lib/api'
import { Button, Card, EmptyState, FieldError, Input, Spinner } from '@/components/ui'
import ChambersManagerModal from '@/components/ChambersManagerModal'
import SubscriptionPlansModal from '@/components/SubscriptionPlansModal'

export default function DashboardPage() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useProjects()
  const { data: usage } = useUsage()
  const { data: orgData } = useCurrentOrganization()
  const { data: membersData } = useOrganizationMembers()
  const createProject = useCreateProject()

  const projects = data?.pages.flatMap((page) => page.data) ?? []
  const total = data?.pages[0]?.total

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showChambersModal, setShowChambersModal] = useState(false)
  const [showPlansModal, setShowPlansModal] = useState(false)

  const org = orgData?.data
  const members = membersData?.data ?? []
  const seats = membersData?.seats ?? { used: members.length, limit: 1 }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)

    try {
      await createProject.mutateAsync({ name, description: description.trim() || undefined })
      setName('')
      setDescription('')
      setShowForm(false)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the project.'))
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Chambers & Law Firm Header Bar */}
      <div className="mb-8 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/20 border border-blue-200/60 text-2xl shadow-xs">
            🏛️
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                {org?.name ?? 'Advocate Chambers'}
              </h1>
              <span className="rounded-full bg-blue-50 px-3 py-0.5 text-xs font-bold text-blue-700 border border-blue-200/60">
                {org?.subscription?.plan?.name ?? 'Solo Advocate (Starter)'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 font-medium">
              {seats.used} of {seats.limit} advocate seats used · {projects.length} active case matters ·{' '}
              {usage ? (usage.storage_bytes.used / 1048576).toFixed(1) : 0} MB cloud storage
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="secondary"
            onClick={() => setShowChambersModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold py-2"
            title="Manage advocate colleagues, partners, associates, and courtroom seats"
          >
            <span>👥</span>
            <span>Chambers Team ({members.length})</span>
          </Button>

          <button
            type="button"
            onClick={() => setShowPlansModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-800 transition-all hover:bg-amber-100/80 shadow-xs cursor-pointer"
            title="Upgrade to Chambers (10 Seats) or Law Firm Enterprise (25 Seats)"
          >
            <span>⭐</span>
            <span>Chambers Plans</span>
          </button>

          <Button
            variant="primary"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold py-2"
          >
            <span>➕</span>
            <span>New Case Matter</span>
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="mb-8 p-6 border-blue-200 bg-white shadow-md">
          <h2 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700 text-sm">
              ⚖️
            </span>
            <span>Register New Case Matter / Brief</span>
          </h2>
          <form onSubmit={handleCreate} className="space-y-3.5">
            <div>
              <Input
                placeholder="Case Title / Matter (e.g. Civil Appeal 412/2024: State of Maharashtra vs ...)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <Input
                placeholder="Brief Particulars / Court & Bench (e.g. High Court of Bombay, Bench 4 - Before Hon'ble Justice...)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <FieldError message={error ?? undefined} />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createProject.isPending}>
                {createProject.isPending ? 'Creating Matter…' : 'Open Case Workspace'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}

      {!isLoading && projects.length === 0 && (
        <EmptyState
          title="No case matters registered yet"
          description="Click 'New Case Matter' to upload petitions, pleadings, trial exhibits, and start courtroom analysis."
        />
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Link key={project.id} to={`/projects/${project.id}`} className="group">
            <Card className="h-full border border-slate-200/90 bg-white p-5 transition-all duration-200 hover:border-blue-500/50 hover:shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm group-hover:bg-blue-50 group-hover:text-blue-700 transition-colors">
                      📁
                    </span>
                    <h2 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2 text-sm leading-snug">
                      {project.name}
                    </h2>
                  </div>
                  <span className="shrink-0 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all text-xs font-bold">
                    ➔
                  </span>
                </div>
                {project.description && (
                  <p className="mt-2.5 line-clamp-2 text-xs text-slate-500 leading-relaxed font-normal">
                    {project.description}
                  </p>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] font-medium text-slate-500">
                <span className="flex items-center gap-1">
                  <span>📄</span> {project.documents_count ?? 0} Pleadings
                </span>
                <span className="flex items-center gap-1">
                  <span>📌</span> {project.excerpts_count ?? 0} Citations
                </span>
                <span className="flex items-center gap-1">
                  <span>📝</span> {project.notes_count ?? 0} Notes
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {hasNextPage && (
        <div className="mt-10 flex flex-col items-center gap-2">
          <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading more cases…' : 'Load more case matters'}
          </Button>
          {total !== undefined && (
            <p className="text-xs text-slate-500">
              Showing {projects.length} of {total} matters
            </p>
          )}
        </div>
      )}

      {/* Modals */}
      <ChambersManagerModal
        isOpen={showChambersModal}
        onClose={() => setShowChambersModal(false)}
        onOpenPlans={() => setShowPlansModal(true)}
      />

      <SubscriptionPlansModal
        isOpen={showPlansModal}
        onClose={() => setShowPlansModal(false)}
      />
    </div>
  )
}
