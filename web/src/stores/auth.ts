import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: number
  name: string
  email: string
  email_verified_at: string | null
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  role: 'owner' | 'member'
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  organizations: OrganizationSummary[]
  organizationId: string | null
  login: (token: string, user: AuthUser, organizations: OrganizationSummary[]) => void
  setOrganization: (organizationId: string) => void
  logout: () => void
}

/**
 * Persisted to localStorage so a page refresh doesn't log the user out.
 * The token is a Sanctum personal access token (see docs/PROGRESS.md -
 * this app is pure bearer-token API auth, no cookies/sessions at all).
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      organizations: [],
      organizationId: null,
      login: (token, user, organizations) =>
        set({
          token,
          user,
          organizations,
          organizationId: organizations[0]?.id ?? null,
        }),
      setOrganization: (organizationId) => set({ organizationId }),
      logout: () => set({ token: null, user: null, organizations: [], organizationId: null }),
    }),
    { name: 'chandaktext-auth' },
  ),
)
