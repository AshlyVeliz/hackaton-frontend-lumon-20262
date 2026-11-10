import { useCallback, useEffect, useState } from 'react'
import { ApiError, BUILD, api, rawFetch } from '../lib/api'
import type { Check } from '../lib/types'

interface Integrations {
  deploy: { origin: string | null; verifiedAt: string | null; lastBuildSeen: string | null }
  storage: { provider: string | null; verifiedAt: string | null; checks: Check[] }
  clearance: { granted: boolean; grantedAt: string | null }
}

interface CheckResult {
  granted: boolean
  checks: Check[]
}

export default function Estado() {
  const [health, setHealth] = useState<'ok' | 'down' | 'checking'>('checking')
  const [integ, setInteg] = useState<Integrations | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      await rawFetch('/meta/health')
      setHealth('ok')
    } catch {
      setHealth('down')
    }
    try {
      setInteg(await api<Integrations>('/integrations/status'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo leer el estado.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function runCheck() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api<CheckResult>('/clearance/check', { method: 'POST' }))
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : 'Error de red.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Estado</h1>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
        <dt className="text-slate-400">Build desplegado</dt>
        <dd className="font-mono">{BUILD}</dd>
        <dt className="text-slate-400">API</dt>
        <dd>{health === 'ok' ? 'Responde' : health === 'down' ? 'No responde' : 'Comprobando…'}</dd>
        <dt className="text-slate-400">Dominio</dt>
        <dd>{integ?.deploy.verifiedAt ? `Verificado (${integ.deploy.origin})` : 'Sin verificar'}</dd>
        <dt className="text-slate-400">Storage</dt>
        <dd>{integ?.storage.verifiedAt ? `Verificado (${integ.storage.provider})` : 'Sin verificar'}</dd>
        <dt className="text-slate-400">Piso de Pruebas</dt>
        <dd>{integ?.clearance.granted ? 'Abierto' : 'Cerrado'}</dd>
      </dl>
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      <button disabled={busy} onClick={() => void runCheck()} className="rounded bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
        {busy ? 'Revisando…' : 'Abrir el Piso de Pruebas'}
      </button>
      {result && (
        <ul className="space-y-1" aria-label="Resultado de la revisión">
          {result.checks.map((c) => (
            <li key={c.name} className={c.passed ? 'text-emerald-400' : 'text-red-400'}>
              {c.passed ? '✔' : '✘'} {c.name}: {c.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
