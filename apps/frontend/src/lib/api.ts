const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

function token(): string | null {
  return localStorage.getItem('libras-ar-token')
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const t = token()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string; detail?: string }).error ?? (body as { detail?: string }).detail ?? res.statusText)
  }

  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
}

export interface ApiGesture {
  id: string
  name: string
  samples: number[][]
  temporal_features?: number[]   // vetor 252-dim pré-computado pelo backend
  sample_count: number
  created_at: string
  updated_at?: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface AdminStats {
  total_users: number
  total_gestures: number
  total_samples: number
}

export interface InviteToken {
  token: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by_name: string | null
  used_by_email: string | null
}

export interface AnalyticsData {
  user_stats: Array<{
    id: string
    name: string
    email: string
    created_at: string
    is_student: boolean
    has_disability: boolean
    gesture_count: number
    total_samples: number
  }>
  top_gestures: Array<{
    name: string
    contributor_count: number
    total_samples: number
    avg_samples_per_user: number
  }>
  timeline: Array<{
    week: string
    active_users: number
    gestures_added: number
    samples_added: number
  }>
  all_gestures: Array<{
    id: string
    name: string
    sample_count: number
    created_at: string
    updated_at: string
    user_name: string
    user_email: string
  }>
}

// ── API ───────────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    register: (email: string, password: string, name?: string) =>
      req<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),

    registerInvite: (
      token: string,
      data: {
        email: string; password: string; name?: string
        is_student: boolean; has_disability: boolean
        sexo: string; faixa_etaria: string; nivel_surdez: string; sabe_libras: string
      }
    ) =>
      req<AuthResponse>('/api/auth/register-invite', {
        method: 'POST',
        body: JSON.stringify({ token, ...data }),
      }),

    login: (email: string, password: string) =>
      req<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    me: () => req<User>('/api/auth/me'),

    validateInvite: (token: string) =>
      req<{ valid: boolean }>(`/api/auth/validate-invite/${token}`),

    validateReset: (token: string) =>
      req<{ valid: boolean; user_name: string; user_email: string }>(`/api/auth/validate-reset/${token}`),

    resetPassword: (token: string, new_password: string) =>
      req<AuthResponse>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, new_password }),
      }),
  },

  gestures: {
    list: () => req<ApiGesture[]>('/api/gestures'),

    upsert: (g: { id: string; name: string; samples: number[][] }) =>
      req<ApiGesture>('/api/gestures', {
        method: 'POST',
        body: JSON.stringify(g),
      }),

    delete: (id: string) =>
      req<{ ok: boolean }>(`/api/gestures/${id}`, { method: 'DELETE' }),

    listByUser: (userId: string) =>
      req<ApiGesture[]>(`/api/gestures/user/${userId}`),

    collectiveDataset: () =>
      req<Array<{ name: string; samples: number[][]; temporal_vectors?: number[][] }>>('/api/gestures/dataset'),
  },

  admin: {
    getUsers: () =>
      req<{ total: number; users: Array<{ id: string; email: string; name: string; role: string; is_student: boolean; has_disability: boolean; sexo: string | null; faixa_etaria: string | null; nivel_surdez: string | null; sabe_libras: string | null; created_at: string }> }>(
        '/api/admin/users'
      ),

    getStats: () => req<AdminStats>('/api/admin/stats'),

    getAnalytics: () => req<AnalyticsData>('/api/admin/analytics'),

    updateUserRole: (userId: string, role: 'user' | 'admin') =>
      req<{ message: string }>(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),

    deleteUser: (userId: string) =>
      req<{ message: string }>(`/api/admin/users/${userId}`, { method: 'DELETE' }),

    createInvite: () =>
      req<{ token: string; expires_at: string }>('/api/admin/invites', { method: 'POST' }),

    listInvites: () => req<InviteToken[]>('/api/admin/invites'),

    revokeInvite: (token: string) =>
      req<{ ok: boolean }>(`/api/admin/invites/${token}`, { method: 'DELETE' }),

    createResetLink: (userId: string) =>
      req<{ token: string; expires_at: string; user_name: string; user_email: string }>(
        `/api/admin/users/${userId}/reset-link`,
        { method: 'POST' }
      ),

    exportRawDataset: () => req<unknown[]>('/api/admin/export/raw'),

    resetDatabase: (scope: 'gestures' | 'all') =>
      req<{ ok: boolean; scope: string; gestures_deleted: number; users_deleted: number }>(
        '/api/admin/reset',
        { method: 'POST', body: JSON.stringify({ scope, confirm: 'ZERAR' }) }
      ),
  },
}
