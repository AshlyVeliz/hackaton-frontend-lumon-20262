import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { rawFetch } from '../lib/api'

export function HealthGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const timer = useRef<number | undefined>(undefined)

  const check = useCallback(async (n: number) => {
    try {
      await rawFetch('/meta/health')
      setOk(true)
    } catch {
      const wait = Math.min(1000 * 2 ** n, 15000)
      timer.current = window.setTimeout(() => {
        setAttempt(n + 1)
        void check(n + 1)
      }, wait)
    }
  }, [])

  useEffect(() => {
    void check(0)
    return () => window.clearTimeout(timer.current)
  }, [check])

  if (ok) return <>{children}</>
  return (
    <main className="min-h-screen grid place-items-center bg-slate-950 text-slate-200">
      <div className="text-center" role="status" aria-live="polite">
        <h1 className="text-2xl font-semibold">Conectando con Lumon…</h1>
        <p className="mt-2 text-slate-400">Intento {attempt + 1}. Reintentando automáticamente.</p>
        <button
          className="mt-4 rounded bg-sky-600 px-4 py-2 text-white"
          onClick={() => {
            window.clearTimeout(timer.current)
            void check(0)
          }}
        >
          Reintentar ahora
        </button>
      </div>
    </main>
  )
}
