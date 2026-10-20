import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, apiErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { Button, Card, FieldError, Input, Label } from '@/components/ui'

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const { data } = await api.post('/auth/login', { email, password })
      const { token, user } = data.data

      // /me returns the user's memberships+organizations; fetch it right
      // after login so we have an organization to select for subsequent
      // tenant-scoped requests.
      const me = await api.get('/me', { headers: { Authorization: `Bearer ${token}` } })
      const organizations = (me.data.data.memberships ?? []).map((m: { organization: { id: string; name: string; slug: string }; role: string }) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      }))

      login(token, user, organizations)
      navigate('/')
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not log in. Check your email and password.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-100">Log in</h1>
        <p className="mb-6 text-sm text-slate-400">Welcome back to ChandakText.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <FieldError message={error ?? undefined} />

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Don't have an account?{' '}
          <Link to="/register" className="text-accent hover:underline">
            Register
          </Link>
        </p>
      </Card>
    </div>
  )
}
