import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

/**
 * Single axios client for the whole app. Every request automatically gets
 * the Sanctum bearer token and the active organization header
 * (X-Organization-Id) attached from the auth store - see
 * backend/app/Http/Middleware/ResolveOrganization.php for why that header
 * is required on every tenant-scoped endpoint.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: { Accept: 'application/json' },
})

api.interceptors.request.use((config) => {
  const { token, organizationId } = useAuthStore.getState()

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (organizationId) {
    config.headers['X-Organization-Id'] = organizationId
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
    }

    return Promise.reject(error)
  },
)

/** Shape of this API's standard error envelope (see docs/04 section 4.4). */
export interface ApiErrorBody {
  message: string
  errors?: Record<string, string[]>
  request_id?: string
}

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.errors) {
      const first = Object.values(body.errors)[0]?.[0]
      if (first) return first
    }
    if (body?.message) return body.message
  }
  return fallback
}
