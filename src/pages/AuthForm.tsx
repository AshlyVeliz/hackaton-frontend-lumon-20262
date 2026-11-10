import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Splash } from '../components/Guards'

interface Props {
  mode: 'login' | 'register'
}

function fieldErrors(e: ApiError): Record<string, string> {
  const d = e.details as { fields?: Record<string, string> } | null
  return d?.fields ?? {}
}

export default function AuthForm({ mode }: Props) {
  const { status, login, register, notice } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from ?? '/files'
  const [teamName, setTeamName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  if (status === 'loading') return <Splash text="Verificando sesión…" />
  if (status === 'authed') return <Navigate to={from} replace />

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setFields({})
    try {
      if (mode === 'login') await login(email, password)
      else await register(teamName, email, password)
      nav(from, { replace: true })
    } catch (e) {
      if (e instanceof ApiError) {
        const f = fieldErrors(e)
        setFields(f)
        if (Object.keys(f).length === 0) setError(e.message)
      } else {
        setError('No se pudo conectar con el servidor.')
      }
    } finally {
      setBusy(false)
    }
  }

  const input = 'mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2'
  return (
    <main className="min-h-screen grid place-items-center bg-slate-950 px-4 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
        <h1 className="text-2xl font-bold">{mode === 'login' ? 'Entrar al piso' : 'Registrar cuadrilla'}</h1>
        {notice && (
          <p role="status" className="rounded bg-amber-900/60 p-3 text-amber-100">
            {notice}
          </p>
        )}
        {mode === 'register' && (
          <div>
            <label htmlFor="teamName">Nombre de la cuadrilla</label>
            <input id="teamName" className={input} value={teamName} onChange={(e) => setTeamName(e.target.value)} aria-invalid={!!fields.teamName} aria-describedby="teamName-err" />
            <p id="teamName-err" className="text-sm text-red-400">
              {fields.teamName}
            </p>
          </div>
        )}
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" className={input} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fields.email} aria-describedby="email-err" />
          <p id="email-err" className="text-sm text-red-400">
            {fields.email}
          </p>
        </div>
        <div>
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={input} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fields.password} aria-describedby="password-err" />
          <p id="password-err" className="text-sm text-red-400">
            {fields.password}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        <button disabled={busy} className="w-full rounded bg-sky-600 py-2 font-semibold text-white disabled:opacity-60">
          {busy ? 'Enviando…' : mode === 'login' ? 'Entrar' : 'Registrar'}
        </button>
        <p className="text-sm text-slate-400">
          {mode === 'login' ? (
            <Link className="underline" to="/register" state={{ from }}>
              Registrar una cuadrilla
            </Link>
          ) : (
            <Link className="underline" to="/login" state={{ from }}>
              Ya tengo cuenta
            </Link>
          )}
        </p>
      </form>
    </main>
  )
}
