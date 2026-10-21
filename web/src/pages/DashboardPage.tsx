import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCreateProject, useProjects, useUsage } from '@/lib/queries'
import { apiErrorMessage } from '@/lib/api'
import { Button, Card, EmptyState, FieldError, Input, Spinner } from '@/components/ui'

export default function DashboardPage() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useProjects()
  const { data: usage } = useUsage()
  const createProject = useCreateProject()

  // BUG-006: flatten every loaded page into one list. Beyond the first 20
  // projects, more only appear after "Load more" - see hasNextPage below.
  const projects = data?.pages.flatMap((page) => page.data) ?? []
  const total = data?.pages[0]?.meta.total

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)

    try {
      await createProject.mutateAsync({ name })
      setName('')
      setShowForm(false)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the project.'))
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Projects</h1>
          {usage && (
            <p className="text-sm text-slate-400">
              {usage.projects.used} / {usage.projects.limit} projects on the{' '}
              <span className="font-medium capitalize text-slate-300">{usage.plan}</span> plan ·{' '}
              {(usage.storage_bytes.used / 1048576).toFixed(1)} MB used
            </p>
          )}
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>New project</Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <form onSubmit={handleCreate} className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                placeholder="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
              <FieldError message={error ?? undefined} />
            </div>
            <Button type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}

      {!isLoading && projects.length === 0 && (
        <EmptyState
          title="No projects yet"
          description="Create a project, then upload a PDF to start reading and annotating."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Link key={project.id} to={`/projects/${project.id}`}>
            <Card className="h-full transition-colors hover:border-accent/50">
              <h2 className="font-medium text-slate-100">{project.name}</h2>
              {project.description && (
                <p className="mt-1 line-clamp-2 text-sm text-slate-400">{project.description}</p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                {project.documents_count ?? 0} documents · {project.excerpts_count ?? 0} excerpts ·{' '}
                {project.notes_count ?? 0} notes
              </p>
            </Card>
          </Link>
        ))}
      </div>

      {hasNextPage && (
        <div className="mt-6 flex flex-col items-center gap-1">
          <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
          {total !== undefined && (
            <p className="text-xs text-slate-500">
              Showing {projects.length} of {total}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
