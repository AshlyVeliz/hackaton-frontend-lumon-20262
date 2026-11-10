import type { TokenPair } from './types'

const BASE = import.meta.env.VITE_API_BASE_URL
export const BUILD: string = __BUILD_SHA__

const RT_KEY = 'lumon.refresh'

export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  retryAfter: number | null
  constructor(status: number, code: string, message: string, details: unknown, retryAfter: number | null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

interface RawOptions {
  method?: string
  body?: unknown
  token?: string | null
  signal?: AbortSignal
  headers?: Record<string, string>
}

export async function rawFetch<T>(path: string, opts: RawOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Lumon-Build': BUILD,
    ...opts.headers,
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string; details?: unknown }
    const ra = res.headers.get('Retry-After')
    throw new ApiError(
      res.status,
      e.error ?? 'HTTP_ERROR',
      e.message ?? `Error ${res.status}`,
      e.details ?? null,
      ra ? Number(ra) : null,
    )
  }
  return data as T
}

/* ---------- Sesión ---------- */

let accessToken: string | null = null

export type SessionEndReason = 'logout' | 'revoked' | 'expired'
type Listener = (reason: SessionEndReason) => void
const listeners = new Set<Listener>()
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-auth') : null

export function onSessionEnd(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function clearLocal(reason: SessionEndReason) {
  accessToken = null
  try {
    localStorage.removeItem(RT_KEY)
  } catch {
    /* ignorar */
  }
  listeners.forEach((l) => l(reason))
}

function endSession(reason: SessionEndReason) {
  clearLocal(reason)
  channel?.postMessage({ type: 'end', reason })
}

if (channel) {
  channel.onmessage = (ev: MessageEvent<{ type: string; reason: SessionEndReason }>) => {
    if (ev.data?.type === 'end') clearLocal(ev.data.reason)
  }
}
window.addEventListener('storage', (ev) => {
  if (ev.key === RT_KEY && ev.newValue === null && accessToken) clearLocal('logout')
})

export function hasStoredSession(): boolean {
  try {
    return !!localStorage.getItem(RT_KEY)
  } catch {
    return false
  }
}

export function setTokens(pair: TokenPair) {
  accessToken = pair.accessToken
  try {
    localStorage.setItem(RT_KEY, pair.refreshToken)
  } catch {
    /* ignorar */
  }
}

let inflight: Promise<string> | null = null

export function refreshTokens(): Promise<string> {
  if (!inflight) {
    inflight = doRefresh().finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function doRefresh(): Promise<string> {
  const run = async (): Promise<string> => {
    const rt = localStorage.getItem(RT_KEY)
    if (!rt) throw new ApiError(401, 'NO_SESSION', 'No hay sesión.', null, null)
    try {
      const pair = await rawFetch<TokenPair>('/auth/refresh', { method: 'POST', body: { refreshToken: rt } })
      setTokens(pair)
      return pair.accessToken
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        endSession(e.code === 'REFRESH_REUSED' || e.code === 'SESSION_REVOKED' ? 'revoked' : 'expired')
      }
      throw e
    }
  }
  if (navigator.locks) return navigator.locks.request('lumon-refresh', run)
  return run()
}

export async function login(email: string, password: string): Promise<void> {
  const pair = await rawFetch<TokenPair>('/auth/login', { method: 'POST', body: { email, password } })
  setTokens(pair)
}

export async function registerTeam(teamName: string, email: string, password: string): Promise<void> {
  const pair = await rawFetch<TokenPair>('/auth/register', { method: 'POST', body: { teamName, email, password } })
  setTokens(pair)
}

export async function logout(): Promise<void> {
  let rt: string | null = null
  try {
    rt = localStorage.getItem(RT_KEY)
  } catch {
    /* ignorar */
  }
  try {
    if (rt) await rawFetch('/auth/logout', { method: 'POST', body: { refreshToken: rt } })
  } catch {
    /* el cierre local siempre se hace */
  }
  endSession('logout')
}

interface ReqOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

export async function api<T>(path: string, opts: ReqOptions = {}): Promise<T> {
  if (!accessToken) await refreshTokens()
  const used = accessToken
  try {
    return await rawFetch<T>(path, { ...opts, token: used })
  } catch (e) {
    if (e instanceof ApiError && e.code === 'TOKEN_EXPIRED') {
      // Si otra request ya rotó el token, solo se reintenta con el nuevo.
      const fresh = accessToken && accessToken !== used ? accessToken : await refreshTokens()
      return rawFetch<T>(path, { ...opts, token: fresh })
    }
    throw e
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}
