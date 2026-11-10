import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded ${isActive ? 'bg-sky-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`

export function Layout() {
  const { me, can, logout } = useAuth()
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-2">
        <strong className="mr-4">Lumon MDR</strong>
        <nav aria-label="Principal" className="flex flex-wrap gap-1">
          {can('files:read') && (
            <NavLink to="/files" className={link}>
              Archivos
            </NavLink>
          )}
          <NavLink to="/estado" className={link}>
            Estado
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-slate-400">
            {me?.displayName} · {me?.team.code}
          </span>
          <button className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-800" onClick={() => void logout()}>
            Cerrar sesión
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
