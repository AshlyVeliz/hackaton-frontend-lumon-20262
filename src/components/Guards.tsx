import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import type { Permission } from '../lib/types'

export function Splash({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div role="status" className="min-h-screen grid place-items-center bg-slate-950 text-slate-300">
      {text}
    </div>
  )
}

export function RequireAuth() {
  const { status } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <Splash text="Verificando sesión…" />
  if (status === 'anon') {
    return <Navigate to="/login" replace state={{ from: `${loc.pathname}${loc.search}${loc.hash}` }} />
  }
  return <Outlet />
}

export function RequirePerm({ perm }: { perm: Permission }) {
  const { can } = useAuth()
  if (!can(perm)) return <NoPermission />
  return <Outlet />
}

export function NoPermission() {
  return (
    <section className="p-8 max-w-xl">
      <h1 className="text-2xl font-bold">Sin permiso</h1>
      <p className="mt-2 text-slate-300">Tu rol no tiene permiso para ver esta página.</p>
      <Link className="mt-4 inline-block underline" to="/files">
        Volver
      </Link>
    </section>
  )
}
