import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedSignal {
  ticker: string
  signal_type: string
  score: number
  composite_score: number
  passed_gate: boolean
  detected_at: string
  detail: Record<string, unknown> | null
  source: string
}

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  volume_spike: 'Vol Spike',
  price_breakout: 'Breakout',
  sector_momentum: 'Momentum',
  insider_cluster: 'Insider',
  news_catalyst: 'News',
}

const SIGNAL_COLORS: Record<string, string> = {
  volume_spike: 'text-orange-400 border-orange-800 bg-orange-950/30',
  price_breakout: 'text-emerald-400 border-emerald-800 bg-emerald-950/30',
  sector_momentum: 'text-sky-400 border-sky-800 bg-sky-950/30',
  insider_cluster: 'text-violet-400 border-violet-800 bg-violet-950/30',
  news_catalyst: 'text-yellow-400 border-yellow-800 bg-yellow-950/30',
}

type FilterType = 'all' | 'passed' | 'failed'
type SortKey = 'detected_at' | 'composite_score' | 'score'

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ value, colorClass }: { value: number; colorClass?: string }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn('h-full rounded-full', colorClass ?? 'bg-zinc-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-zinc-500">{pct.toFixed(0)}%</span>
    </div>
  )
}

// ─── Signal row ───────────────────────────────────────────────────────────────

function SignalRow({ signal }: { signal: DetectedSignal }) {
  const [expanded, setExpanded] = useState(false)
  const typeColor = SIGNAL_COLORS[signal.signal_type] ?? 'text-zinc-400 border-zinc-700 bg-zinc-900'
  const label = SIGNAL_TYPE_LABELS[signal.signal_type] ?? signal.signal_type

  const detail = signal.detail
  const detailKeys = detail ? Object.keys(detail).filter(k => k !== 'ticker') : []

  return (
    <div
      className={cn(
        'rounded-lg border bg-zinc-900 transition-colors',
        signal.passed_gate ? 'border-zinc-700' : 'border-zinc-800 opacity-60'
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-800/40 transition-colors rounded-lg"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Ticker */}
        <span className="w-14 shrink-0 font-mono text-sm font-bold text-zinc-100">{signal.ticker}</span>

        {/* Signal type badge */}
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]', typeColor)}>
          {label}
        </span>

        {/* Gate indicator */}
        <span className={cn('shrink-0', signal.passed_gate ? 'text-emerald-500' : 'text-zinc-600')}>
          {signal.passed_gate ? <TrendingUp className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </span>

        {/* Composite score bar */}
        <div className="flex-1 min-w-0">
          <ScoreBar
            value={signal.composite_score}
            colorClass={signal.passed_gate ? 'bg-emerald-500' : 'bg-zinc-600'}
          />
        </div>

        {/* Individual score */}
        <span className="shrink-0 font-mono text-xs text-zinc-500">
          {(signal.score * 100).toFixed(0)}
        </span>

        {/* Time */}
        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
          {new Date(signal.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </button>

      {/* Expanded detail panel */}
      {expanded && detail && detailKeys.length > 0 && (
        <div className="border-t border-zinc-800 px-3 py-2.5">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-zinc-600">Detector detail</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {detailKeys.map(k => (
              <div key={k} className="flex justify-between gap-2">
                <span className="font-mono text-[10px] text-zinc-500">{k.replace(/_/g, ' ')}</span>
                <span className="font-mono text-[10px] text-zinc-300 truncate">
                  {typeof detail[k] === 'number'
                    ? (detail[k] as number).toFixed(3)
                    : String(detail[k])}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Signal Explorer ──────────────────────────────────────────────────────────

export function SignalExplorer() {
  const [signals, setSignals] = useState<DetectedSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')
  const [sortKey, setSortKey] = useState<SortKey>('detected_at')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/v1/signals?limit=200')
      if (res.ok) {
        const data = await res.json() as DetectedSignal[]
        setSignals(data)
      }
    } catch {
      // silently handle offline
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = signals
    .filter(s => {
      if (filter === 'passed') return s.passed_gate
      if (filter === 'failed') return !s.passed_gate
      return true
    })
    .filter(s => typeFilter === 'all' || s.signal_type === typeFilter)
    .sort((a, b) => {
      if (sortKey === 'detected_at') return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
      if (sortKey === 'composite_score') return b.composite_score - a.composite_score
      return b.score - a.score
    })

  const passCount = signals.filter(s => s.passed_gate).length
  const signalTypes = Array.from(new Set(signals.map(s => s.signal_type)))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Signal Explorer
          </h2>
          <div className="flex items-center gap-2">
            <Badge className="border-transparent bg-zinc-800 font-mono text-xs text-zinc-300">
              {passCount}/{signals.length} passed gate
            </Badge>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              title="Refresh signals"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap gap-2">
          {/* Gate filter */}
          <div className="flex rounded-md border border-zinc-800 overflow-hidden">
            {(['all', 'passed', 'failed'] as FilterType[]).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'px-2 py-1 font-mono text-[10px] uppercase transition-colors',
                  filter === f ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="flex rounded-md border border-zinc-800 overflow-hidden">
            {([['detected_at', 'Latest'], ['composite_score', 'Score'], ['score', 'Detector']] as [SortKey, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortKey(k)}
                className={cn(
                  'px-2 py-1 font-mono text-[10px] transition-colors',
                  sortKey === k ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Type filter */}
          {signalTypes.length > 0 && (
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-400 focus:outline-none"
            >
              <option value="all">All types</option>
              {signalTypes.map(t => (
                <option key={t} value={t}>{SIGNAL_TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Signal list */}
      <ScrollArea className="flex-1">
        <div className="space-y-1.5 p-3">
          {loading && signals.length === 0 && (
            <div className="flex h-32 items-center justify-center">
              <p className="text-xs text-zinc-600">Loading signals…</p>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex h-32 flex-col items-center justify-center gap-1">
              <TrendingDown className="h-6 w-6 text-zinc-700" />
              <p className="text-xs text-zinc-600">No signals match the current filter</p>
            </div>
          )}
          {filtered.map((s, i) => (
            <SignalRow key={`${s.ticker}-${s.signal_type}-${s.detected_at}-${i}`} signal={s} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
