import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api, isAbort } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { ApiFile, BinCode, RefineResult, Rules, Tile } from '../lib/types'

const CELL = 28
const MAX_DOM_CELLS = 2500
const BOXES: BinCode[] = ['WO', 'FC', 'DR', 'MA']
const BIN_CHAR: Record<BinCode, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' }
const BIN_CLASS: Record<string, string> = {
  W: 'bg-sky-900 text-sky-100',
  F: 'bg-emerald-900 text-emerald-100',
  D: 'bg-violet-900 text-violet-100',
  M: 'bg-amber-900 text-amber-100',
}

interface TileData {
  t: Tile
  trem: Uint8Array
  bins: string[]
}

interface CellInfo {
  v: string
  t: number
  b: string
}

interface Group {
  cells: { r: number; c: number }[]
  size: number
  bin: BinCode | null
}

function decode(t: Tile): TileData {
  const raw = atob(t.tremor)
  const trem = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) trem[i] = raw.charCodeAt(i)
  return { t, trem, bins: t.bins.split('') }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(id)
      resolve()
    })
  })
}

export default function RefinePage() {
  const { id } = useParams()
  const fileId = Number(id)
  const [sp, setSp] = useSearchParams()
  const { can } = useAuth()
  const canRefine = can('files:refine')

  const [file, setFile] = useState<ApiFile | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState({ r0: 0, r1: 0, c0: 0, c1: 0 })
  const [focus, setFocus] = useState({ r: 0, c: 0 })
  const [group, setGroup] = useState<Group | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const cache = useRef(new Map<string, TileData>())
  const inflight = useRef(new Map<string, { ac: AbortController; p: Promise<TileData | null> }>())
  const pinned = useRef(new Set<string>())
  const blockedUntil = useRef(0)
  const selToken = useRef(0)
  const busyRef = useRef(false)
  const intent = useRef<{ sig: string; key: string } | null>(null)
  const urlTimer = useRef<number | undefined>(undefined)

  /* ---------- carga del archivo ---------- */
  useEffect(() => {
    if (!Number.isInteger(fileId) || fileId < 1) {
      setLoadError('Archivo inválido.')
      return
    }
    const ac = new AbortController()
    ;(async () => {
      try {
        const [f, r] = await Promise.all([
          api<ApiFile>(`/files/${fileId}`, { signal: ac.signal }),
          api<Rules>(`/files/${fileId}/rules`, { signal: ac.signal }),
        ])
        setFile(f)
        setRules(r)
      } catch (e) {
        if (isAbort(e)) return
        setLoadError(e instanceof ApiError ? e.message : 'No se pudo cargar el archivo.')
      }
    })()
    const tiles = cache.current
    const flying = inflight.current
    return () => {
      ac.abort()
      flying.forEach((v) => v.ac.abort())
      flying.clear()
      tiles.clear()
    }
  }, [fileId])

  /* ---------- bloques ---------- */
  const fetchTile = useCallback(
    (tr: number, tc: number, force = false): Promise<TileData | null> => {
      const key = `${tr},${tc}`
      if (!force) {
        const hit = cache.current.get(key)
        if (hit) return Promise.resolve(hit)
        const fly = inflight.current.get(key)
        if (fly) return fly.p
      }
      const ac = new AbortController()
      const p = (async (): Promise<TileData | null> => {
        let attempt = 0
        for (;;) {
          const wait = blockedUntil.current - Date.now()
          if (wait > 0) await sleep(wait, ac.signal)
          try {
            const t = await api<Tile>(`/files/${fileId}/tiles/${tr}/${tc}`, { signal: ac.signal })
            const td = decode(t)
            cache.current.set(key, td)
            bump()
            return td
          } catch (e) {
            if (isAbort(e)) return null
            if (e instanceof ApiError && e.status === 429) {
              blockedUntil.current = Date.now() + (e.retryAfter ?? 1) * 1000
              continue
            }
            const transient = (e instanceof ApiError && e.status === 503) || e instanceof TypeError
            if (transient && attempt < 6) {
              const ra = e instanceof ApiError ? e.retryAfter : null
              await sleep(ra ? ra * 1000 : Math.min(500 * 2 ** attempt, 8000), ac.signal)
              attempt++
              continue
            }
            setMessage(e instanceof ApiError ? e.message : 'No se pudo cargar un bloque.')
            return null
          }
        }
      })().finally(() => {
        if (inflight.current.get(key)?.ac === ac) inflight.current.delete(key)
      })
      inflight.current.set(key, { ac, p })
      return p
    },
    [fileId],
  )

  const cellAt = useCallback(
    (r: number, c: number): CellInfo | null => {
      if (!file) return null
      const ts = file.tileSize
      const td = cache.current.get(`${Math.floor(r / ts)},${Math.floor(c / ts)}`)
      if (!td) return null
      const idx = (r - td.t.originRow) * td.t.cols + (c - td.t.originCol)
      return { v: td.t.values[idx] ?? '', t: td.trem[idx] ?? 0, b: td.bins[idx] ?? '.' }
    },
    [file],
  )

  /* ---------- ventana visible (virtualización) ---------- */
  const computeView = useCallback(() => {
    const el = scrollRef.current
    if (!el || !file) return
    const top = el.scrollTop
    const left = el.scrollLeft
    for (const o of [2, 0]) {
      const r0 = Math.max(0, Math.floor(top / CELL) - o)
      const r1 = Math.min(file.rows - 1, Math.ceil((top + el.clientHeight) / CELL) + o)
      const c0 = Math.max(0, Math.floor(left / CELL) - o)
      const c1 = Math.min(file.cols - 1, Math.ceil((left + el.clientWidth) / CELL) + o)
      let rr1 = r1
      while ((rr1 - r0 + 1) * (c1 - c0 + 1) > MAX_DOM_CELLS && rr1 > r0) rr1--
      if ((rr1 - r0 + 1) * (c1 - c0 + 1) <= MAX_DOM_CELLS) {
        setView((v) => (v.r0 === r0 && v.r1 === rr1 && v.c0 === c0 && v.c1 === c1 ? v : { r0, r1: rr1, c0, c1 }))
        return
      }
    }
  }, [file])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !file) return
    const r = Number(sp.get('r'))
    const c = Number(sp.get('c'))
    const row = Number.isInteger(r) ? Math.min(Math.max(r, 0), file.rows - 1) : 0
    const col = Number.isInteger(c) ? Math.min(Math.max(c, 0), file.cols - 1) : 0
    el.scrollTop = row * CELL
    el.scrollLeft = col * CELL
    setFocus({ r: row, c: col })
    computeView()
    window.addEventListener('resize', computeView)
    return () => window.removeEventListener('resize', computeView)
    // solo al cargar el archivo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id])

  useEffect(() => {
    if (!file) return
    const ts = file.tileSize
    const need = new Set<string>()
    for (let tr = Math.floor(view.r0 / ts); tr <= Math.floor(view.r1 / ts); tr++) {
      for (let tc = Math.floor(view.c0 / ts); tc <= Math.floor(view.c1 / ts); tc++) {
        need.add(`${tr},${tc}`)
        void fetchTile(tr, tc)
      }
    }
    inflight.current.forEach((v, key) => {
      if (!need.has(key) && !pinned.current.has(key)) {
        v.ac.abort()
        inflight.current.delete(key)
      }
    })
  }, [view, file, fetchTile])

  function onScroll() {
    computeView()
    window.clearTimeout(urlTimer.current)
    urlTimer.current = window.setTimeout(() => {
      const el = scrollRef.current
      if (!el) return
      const next = new URLSearchParams(sp)
      next.set('r', String(Math.floor(el.scrollTop / CELL)))
      next.set('c', String(Math.floor(el.scrollLeft / CELL)))
      setSp(next, { replace: true })
    }, 300)
  }

  /* ---------- selección de grupo ---------- */
  const selectGroup = useCallback(
    async (r: number, c: number) => {
      if (!file || !rules || !canRefine) return
      const first = cellAt(r, c)
      if (!first) return
      if (first.b !== '.' || first.t < rules.tremorThreshold) {
        setGroup(null)
        return
      }
      if (group?.cells.some((x) => x.r === r && x.c === c)) return
      const token = ++selToken.current
      setSelecting(true)
      setMessage(null)
      const ts = file.tileSize
      const dirs = rules.connectivity === 8
        ? [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
        : [[-1, 0], [0, -1], [0, 1], [1, 0]]
      const visited = new Set<number>([r * file.cols + c])
      const stack: [number, number][] = [[r, c]]
      const cells: { r: number; c: number }[] = []
      const mine: string[] = []
      let digits: number[] = []
      let tooBig = false
      try {
        while (stack.length) {
          const [cr, cc] = stack.pop() as [number, number]
          cells.push({ r: cr, c: cc })
          digits.push(Number(cellAt(cr, cc)?.v ?? 0))
          if (cells.length > rules.maxGroupSize) {
            tooBig = true
            break
          }
          for (const [dr, dc] of dirs) {
            const nr = cr + (dr as number)
            const nc = cc + (dc as number)
            if (nr < 0 || nc < 0 || nr >= file.rows || nc >= file.cols) continue
            const k = nr * file.cols + nc
            if (visited.has(k)) continue
            let cell = cellAt(nr, nc)
            if (!cell) {
              const key = `${Math.floor(nr / ts)},${Math.floor(nc / ts)}`
              pinned.current.add(key)
              mine.push(key)
              await fetchTile(Math.floor(nr / ts), Math.floor(nc / ts))
              if (token !== selToken.current) return
              cell = cellAt(nr, nc)
              if (!cell) throw new Error('No se pudo cargar un bloque vecino.')
            }
            if (cell.b === '.' && cell.t >= rules.tremorThreshold) {
              visited.add(k)
              stack.push([nr, nc])
            }
          }
        }
        if (token !== selToken.current) return
        const size = cells.length
        const noise = tooBig || size < rules.minGroupSize || size > rules.maxGroupSize
        let bin: BinCode | null = null
        if (!noise) {
          if (rules.binning.strategy === 'DIGIT_SUM_MOD') digits = [digits.reduce((a, b) => a + b, 0)]
          else digits = [Math.max(...digits)]
          bin = rules.binning.order[(digits[0] as number) % 4] ?? null
        }
        setGroup({ cells, size, bin })
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'No se pudo seleccionar el grupo.')
      } finally {
        mine.forEach((k) => pinned.current.delete(k))
        if (token === selToken.current) setSelecting(false)
      }
    },
    [file, rules, canRefine, cellAt, fetchTile, group],
  )

  /* ---------- refinar ---------- */
  async function refine(bin: BinCode) {
    if (!file || !group || group.bin === null || busyRef.current || !canRefine) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    const first = group.cells[0] as { r: number; c: number }
    const sig = `${file.id}:${bin}:${group.size}:${first.r},${first.c}`
    if (intent.current?.sig !== sig) intent.current = { sig, key: crypto.randomUUID() }
    const key = intent.current.key
    try {
      let res: RefineResult | null = null
      for (let attempt = 0; res === null; attempt++) {
        try {
          res = await api<RefineResult>(`/files/${file.id}/refinements`, {
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            body: { bin, cells: group.cells },
          })
        } catch (e) {
          const transient = e instanceof TypeError || (e instanceof ApiError && (e.status === 503 || e.status === 429))
          if (transient && attempt < 5) {
            const ra = e instanceof ApiError ? e.retryAfter : null
            await sleep(ra ? ra * 1000 : Math.min(500 * 2 ** attempt, 8000))
            continue
          }
          throw e
        }
      }
      const ts = file.tileSize
      for (const { r, c } of group.cells) {
        const td = cache.current.get(`${Math.floor(r / ts)},${Math.floor(c / ts)}`)
        if (td) td.bins[(r - td.t.originRow) * td.t.cols + (c - td.t.originCol)] = BIN_CHAR[bin]
      }
      setFile((f) => (f ? { ...f, ...res.file } : f))
      setGroup(null)
      intent.current = null
      bump()
    } catch (e) {
      intent.current = null
      if (e instanceof ApiError) {
        const reason = (e.details as { reason?: string } | null)?.reason
        if (e.code === 'WRONG_BIN') {
          setMessage('Caja incorrecta: se registró un error de refinamiento. Revisa la caja que corresponde.')
          void api<ApiFile>(`/files/${file.id}`).then(setFile).catch(() => undefined)
        } else if (e.status === 409) {
          setMessage(e.code === 'GROUP_CLAIMED' ? 'Otro refinador tiene este grupo.' : 'Alguna celda ya estaba refinada. Actualizando bloques…')
          const ts = file.tileSize
          const keys = new Set(group.cells.map(({ r, c }) => `${Math.floor(r / ts)},${Math.floor(c / ts)}`))
          keys.forEach((k) => {
            const [tr, tc] = k.split(',').map(Number)
            void fetchTile(tr as number, tc as number, true)
          })
          setGroup(null)
        } else setMessage(reason ? `${e.message} (${reason})` : e.message)
      } else setMessage('Error de red. Intenta de nuevo.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /* ---------- teclado ---------- */
  function ensureVisible(r: number, c: number) {
    const el = scrollRef.current
    if (!el) return
    const top = r * CELL
    const left = c * CELL
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + CELL > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL - el.clientHeight
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = left + CELL - el.clientWidth
  }

  function onKeyDown(ev: ReactKeyboardEvent) {
    if (!file) return
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? CELL * 10) / CELL) - 1)
    let { r, c } = focus
    switch (ev.key) {
      case 'ArrowUp': r--; break
      case 'ArrowDown': r++; break
      case 'ArrowLeft': c--; break
      case 'ArrowRight': c++; break
      case 'PageUp': r -= page; break
      case 'PageDown': r += page; break
      case 'Home': c = 0; break
      case 'End': c = file.cols - 1; break
      case 'Enter':
      case ' ':
        ev.preventDefault()
        if (!selecting && !busy) void selectGroup(focus.r, focus.c)
        return
      case 'Escape':
        setGroup(null)
        return
      case '1': case '2': case '3': case '4':
        if (group) void refine(BOXES[Number(ev.key) - 1] as BinCode)
        return
      default:
        return
    }
    ev.preventDefault()
    r = Math.min(Math.max(r, 0), file.rows - 1)
    c = Math.min(Math.max(c, 0), file.cols - 1)
    setFocus({ r, c })
    ensureVisible(r, c)
  }

  /* ---------- arrastre con Pointer Events ---------- */
  function onDragStart(ev: ReactPointerEvent<HTMLButtonElement>) {
    ev.currentTarget.setPointerCapture(ev.pointerId)
    setDrag({ x: ev.clientX, y: ev.clientY })
  }
  function onDragMove(ev: ReactPointerEvent<HTMLButtonElement>) {
    if (drag) setDrag({ x: ev.clientX, y: ev.clientY })
  }
  function onDragEnd(ev: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag) return
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-bin]')
    setDrag(null)
    const bin = target?.getAttribute('data-bin') as BinCode | null
    if (bin) void refine(bin)
  }

  /* ---------- render ---------- */
  if (loadError) {
    return (
      <p role="alert" className="p-6 text-red-400">
        {loadError} <Link className="underline" to="/files">Volver</Link>
      </p>
    )
  }
  if (!file || !rules) return <p role="status" className="p-6">Cargando archivo…</p>

  const selected = new Set(group?.cells.map((x) => x.r * file.cols + x.c))
  const rows: number[] = []
  for (let r = view.r0; r <= view.r1; r++) rows.push(r)
  const focusOutside = focus.r < view.r0 || focus.r > view.r1 || focus.c < view.c0 || focus.c > view.c1

  const renderCell = (r: number, c: number) => {
    const cell = cellAt(r, c)
    const k = r * file.cols + c
    const isFocus = focus.r === r && focus.c === c
    let cls = 'absolute grid place-items-center border border-slate-900 text-xs select-none '
    const style: React.CSSProperties & Record<string, string | number> = { left: c * CELL, width: CELL, height: CELL }
    if (!cell) cls += 'bg-slate-800/60'
    else if (cell.b !== '.') cls += BIN_CLASS[cell.b] ?? ''
    else if (cell.t >= rules.tremorThreshold) {
      cls += 'cell-scary cursor-pointer'
      style['--shake'] = `${(1.2 - (cell.t / 100) * 0.9).toFixed(2)}s`
    } else cls += 'bg-slate-900 text-slate-400'
    if (selected.has(k)) cls += ' ring-2 ring-cyan-300 z-10'
    if (isFocus) cls += ' outline outline-2 outline-yellow-300 z-20'
    return (
      <div
        key={c}
        id={`cell-${r}-${c}`}
        role="gridcell"
        aria-colindex={c + 1}
        aria-selected={selected.has(k)}
        className={cls}
        style={style}
        onClick={() => {
          setFocus({ r, c })
          if (!selecting && !busy) void selectGroup(r, c)
        }}
      >
        {cell?.v}
      </div>
    )
  }

  const cols: number[] = []
  for (let c = view.c0; c <= view.c1; c++) cols.push(c)
  const rowStyle = (r: number): React.CSSProperties => ({ position: 'absolute', top: r * CELL, left: 0, height: CELL, width: file.cols * CELL })

  return (
    <section className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <Link className="underline" to="/files">← Archivos</Link>
        <h1 className="text-xl font-bold">{file.name}</h1>
        <span className="text-sm text-slate-400">
          {file.rows}×{file.cols} · {file.refinedGroups}/{file.totalGroups} grupos · errores: {file.mistakes}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {BOXES.map((b, i) => (
          <button
            key={b}
            data-bin={b}
            disabled={!canRefine || !group || group.bin === null || busy}
            onClick={() => void refine(b)}
            className={`rounded border p-2 text-left disabled:opacity-60 ${drag ? 'border-cyan-400' : 'border-slate-700'}`}
            aria-label={`Caja ${b}, atajo ${i + 1}`}
          >
            <span className="font-semibold">{b}</span> <span className="text-xs text-slate-400">[{i + 1}]</span>
            <progress className="mt-1 w-full" max={1} value={file.progress[b]} aria-label={`Progreso ${b}`} />
          </button>
        ))}
      </div>

      <div className="mb-2 min-h-[3rem] text-sm" aria-live="polite">
        {selecting && <p>Calculando grupo…</p>}
        {group && (
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Grupo de <strong>{group.size}</strong> celdas ·{' '}
              {group.bin ? <>caja correcta: <strong>{group.bin}</strong></> : <strong className="text-amber-300">ruido (no se puede refinar)</strong>}
            </span>
            {group.bin && (
              <button
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                className="cursor-grab touch-none rounded bg-cyan-700 px-3 py-1"
                aria-label="Arrastra el grupo a una caja, o usa las teclas 1 a 4"
              >
                ⠿ Arrastrar a una caja
              </button>
            )}
            <button className="underline" onClick={() => setGroup(null)}>Cancelar</button>
          </div>
        )}
        {message && <p role="alert" className="text-amber-300">{message}</p>}
        {!canRefine && <p className="text-slate-400">Tu rol no puede refinar. Solo lectura.</p>}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="grid"
        aria-label={`Grilla de ${file.name}`}
        aria-rowcount={file.rows}
        aria-colcount={file.cols}
        aria-activedescendant={`cell-${focus.r}-${focus.c}`}
        className="relative h-[60vh] overflow-auto rounded border border-slate-700 focus:outline focus:outline-2 focus:outline-sky-400"
      >
        <div style={{ width: file.cols * CELL, height: file.rows * CELL, position: 'relative' }}>
          {rows.map((r) => (
            <div key={r} role="row" aria-rowindex={r + 1} style={rowStyle(r)}>
              {cols.map((c) => renderCell(r, c))}
            </div>
          ))}
          {focusOutside && (
            <div role="row" aria-rowindex={focus.r + 1} style={rowStyle(focus.r)}>
              {renderCell(focus.r, focus.c)}
            </div>
          )}
        </div>
      </div>

      {file.status === 'COMPLETE' && (
        <div role="dialog" aria-modal="true" aria-label="Archivo completado" className="fixed inset-0 z-50 grid place-items-center bg-black/70">
          <div className="rounded bg-slate-900 p-8 text-center">
            <h2 className="text-2xl font-bold">¡Archivo completado!</h2>
            <p className="mt-2 text-slate-300">Todos los grupos fueron refinados. Errores: {file.mistakes}.</p>
            <Link className="mt-4 inline-block rounded bg-sky-600 px-4 py-2" to="/files">Volver a los archivos</Link>
          </div>
        </div>
      )}
    </section>
  )
}
