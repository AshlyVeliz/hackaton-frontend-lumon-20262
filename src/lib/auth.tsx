import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, hasStoredSession, login as apiLogin, logout as apiLogout, onSessionEnd, refreshTokens, registerTeam } from './api'
import type { Me, Permission } from './types'

type Status = 'loading' | 'authed' | 'anon'

interface AuthValue {
  status: Status
  me: Me | null
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  register: (teamName: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  reloadMe: () => Promise<void>
  can: (p: Permission) => boolean
  clearNotice: () => void
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(hasStoredSession() ? 'loading' : 'anon')
  const [me, setMe] = useState<Me | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reloadMe = useCallback(async () => {
    const m = await api<Me>('/auth/me')
    setMe(m)
    setStatus('authed')
  }, [])

  useEffect(() => {
    if (status !== 'loading') return
    let cancelled = false
    ;(async () => {
      try {
        await refreshTokens()
        const m = await api<Me>('/auth/me')
        if (!cancelled) {
          setMe(m)
          setStatus('authed')
        }
      } catch {
        if (!cancelled) setStatus('anon')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () =>
      onSessionEnd((reason) => {
        setMe(null)
        setStatus('anon')
        if (reason === 'revoked') setNotice('Tu sesión fue revocada por seguridad. Inicia sesión de nuevo.')
        else if (reason === 'expired') setNotice('Tu sesión venció. Inicia sesión de nuevo.')
        else setNotice(null)
      }),
    [],
  )

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      notice,
      login: async (email, password) => {
        await apiLogin(email, password)
        setNotice(null)
        await reloadMe()
      },
      register: async (teamName, email, password) => {
        await registerTeam(teamName, email, password)
        setNotice(null)
        await reloadMe()
      },
      logout: apiLogout,
      reloadMe,
      can: (p) => !!me?.permissions.includes(p),
      clearNotice: () => setNotice(null),
    }),
    [status, me, notice, reloadMe],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fuera de AuthProvider')
  return v
}
