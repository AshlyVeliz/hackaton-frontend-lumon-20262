import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, api, isAbort } from '../lib/api'
import type { FilePage } from '../lib/types'

const SIZES = [10, 25, 50]
const SORTS = ['updatedAt,desc', 'progress,desc', 'name,asc']
const STATUSES = ['', 'ACTIVE', 'COMPLETE']

function pick<T extends string>(v: string | null, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def
}

export default function Files() {
  const [sp, setSp] = useSearchParams()
  const pageRaw = Number(sp.get('page'))
  const page = Number.isInteger(pageRaw) && pageRaw >= 0 ? pageRaw : 0
  const sizeRaw = Number(sp.get('size'))
  const size = SIZES.includes(sizeRaw) ? sizeRaw : 10
  const status = pick(sp.get('status'), STATUSES, '')
  const sort = pick(sp.get('sort'), SORTS, 'updatedAt,desc')
  const q = (sp.get('q') ?? '').slice(0, 60)

  const [search, setSearch] = useState(q)
  const [data, setData] = useState<FilePage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    setSp(next)
  }

  useEffect(() => setSearch(q), [q])

  useEffect(() => {
    if (search === q) return
    const t = window.setTimeout(() => update({ q: search, page: null }), 400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    const id = ++reqId.current
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), size: String(size), sort })
    if (status) params.set('status', status)
    if (q) params.set('q', q)
    api<FilePage>(`/files?${params}`, { signal: ac.signal })
      .then((d) => {
        if (id === reqId.current) setData(d)
      })
      .catch((e: unknown) => {
        if (isAbort(e) || id !== reqId.current) return
        setError(e instanceof ApiError ? e.message : 'No se pudo cargar la lista.')
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false)
      })
    return () => ac.abort()
  }, [page, size, status, sort, q])

  const sel = 'rounded border border-slate-600 bg-slate-900 px-2 py-1'
  return (
    <section className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">Archivos de datos</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          Buscar
          <input className={sel} value={search} maxLength={60} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="flex flex-col text-sm">
          Estado
          <select className={sel} value={status} onChange={(e) => update({ status: e.target.value, page: null })}>
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="COMPLETE">Completos</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Orden
          <select className={sel} value={sort} onChange={(e) => update({ sort: e.target.value, page: null })}>
            <option value="updatedAt,desc">Más recientes</option>
            <option value="progress,desc">Mayor progreso</option>
            <option value="name,asc">Nombre</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Por página
          <select className={sel} value={size} onChange={(e) => update({ size: e.target.value, page: null })}>
            {SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      <div aria-busy={loading} className={loading ? 'opacity-60' : ''}>
        {data && data.content.length === 0 && <p className="text-slate-400">No hay archivos con esos filtros.</p>}
        <ul className="space-y-2">
          {data?.content.map((f) => (
            <li key={f.id} className="flex items-center gap-4 rounded border border-slate-800 p-3">
              <div className="flex-1">
                <Link className="font-semibold text-sky-400 underline" to={`/files/${f.id}/refine`}>
                  {f.name}
                </Link>
                <p className="text-sm text-slate-400">
                  {f.rows}×{f.cols} · {f.refinedGroups}/{f.totalGroups} grupos · {f.status === 'COMPLETE' ? 'Completo' : 'Activo'}
                </p>
              </div>
              <progress className="w-40" max={1} value={f.progress.overall} aria-label={`Progreso de ${f.name}`} />
              <span className="w-12 text-right text-sm">{Math.round(f.progress.overall * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
      {data && (
        <nav aria-label="Paginación" className="flex items-center gap-3">
          <button className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40" disabled={page <= 0} onClick={() => update({ page: String(page - 1) })}>
            Anterior
          </button>
          <span>
            Página {data.page + 1} de {Math.max(1, data.totalPages)}
          </span>
          <button className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40" disabled={page + 1 >= data.totalPages} onClick={() => update({ page: String(page + 1) })}>
            Siguiente
          </button>
        </nav>
      )}
    </section>
  )
}
