import { useCallback, useEffect, useRef, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, SlidersHorizontal, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSignalSSE, type SignalSSEStatus } from '@/hooks/useSignalSSE'

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

// ─── SSE status dot ───────────────────────────────────────────────────────────

const SSE_STATUS: Record<SignalSSEStatus, { dot: string; label: string }> = {
  connected:    { dot: 'bg-emerald-500 animate-pulse', label: 'LIVE' },
  connecting:   { dot: 'bg-yellow-500 animate-pulse',  label: 'CONNECTING' },
  disconnected: { dot: 'bg-zinc-600',                   label: 'OFFLINE' },
}

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

function SignalRow({ signal, isNew }: { signal: DetectedSignal; isNew?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const typeColor = SIGNAL_COLORS[signal.signal_type] ?? 'text-zinc-400 border-zinc-700 bg-zinc-900'
  const label = SIGNAL_TYPE_LABELS[signal.signal_type] ?? signal.signal_type

  const detail = signal.detail
  const detailKeys = detail ? Object.keys(detail).filter(k => k !== 'ticker') : []

  return (
    <div
      className={cn(
        'rounded-lg border bg-zinc-900 transition-all duration-500',
        signal.passed_gate ? 'border-zinc-700' : 'border-zinc-800 opacity-60',
        isNew && 'border-emerald-700 bg-emerald-950/20 animate-[fadeIn_0.5s_ease-out]',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-800/40 transition-colors rounded-lg"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="w-14 shrink-0 font-mono text-sm font-bold text-zinc-100">{signal.ticker}</span>
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]', typeColor)}>
          {label}
        </span>
        <span className={cn('shrink-0', signal.passed_gate ? 'text-emerald-500' : 'text-zinc-600')}>
          {signal.passed_gate ? <TrendingUp className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </span>
        <div className="flex-1 min-w-0">
          <ScoreBar
            value={signal.composite_score}
            colorClass={signal.passed_gate ? 'bg-emerald-500' : 'bg-zinc-600'}
          />
        </div>
        <span className="shrink-0 font-mono text-xs text-zinc-500">
          {(signal.score * 100).toFixed(0)}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
          {new Date(signal.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </button>

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

// ─── Threshold Simulator ──────────────────────────────────────────────────────

function ThresholdSimulator({ signals }: { signals: DetectedSignal[] }) {
  const [open, setOpen] = useState(false)
  const [localThreshold, setLocalThreshold] = useState(0.35)
  const [currentThreshold, setCurrentThreshold] = useState(0.35)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/v1/config/thresholds')
      .then(r => r.ok ? r.json() : null)
      .then((d: { thresholds: { signal_quality_gate: number } } | null) => {
        if (d) {
          setCurrentThreshold(d.thresholds.signal_quality_gate)
          setLocalThreshold(d.thresholds.signal_quality_gate)
        }
      })
      .catch(() => {})
  }, [])

  const uniqueTickers = Array.from(new Set(signals.map(s => s.ticker)))
  const wouldPass = uniqueTickers.filter(ticker => {
    const tickerSignals = signals.filter(s => s.ticker === ticker)
    const maxComposite = Math.max(...tickerSignals.map(s => s.composite_score))
    return maxComposite >= localThreshold
  }).length
  const wouldFail = uniqueTickers.length - wouldPass

  async function applyThreshold() {
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/config/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal_quality_gate: localThreshold }),
      })
      if (res.ok) {
        setCurrentThreshold(localThreshold)
        toast.success(`Quality gate set to ${(localThreshold * 100).toFixed(0)}%`)
      } else {
        toast.error('Failed to update threshold')
      }
    } catch {
      toast.error('Request failed')
    } finally {
      setSaving(false)
    }
  }

  const isDirty = Math.abs(localThreshold - currentThreshold) > 0.001

  return (
    <div className="border border-zinc-800 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-3 w-3 text-zinc-500" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Threshold Simulator</span>
        </div>
        <span className="font-mono text-[10px] text-zinc-600">
          current: <span className="text-zinc-400">{(currentThreshold * 100).toFixed(0)}%</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-3 py-3 space-y-3">
          {/* Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="font-mono text-[10px] text-zinc-500">Quality Gate</span>
              <span className={cn('font-mono text-[10px]', isDirty ? 'text-yellow-400' : 'text-zinc-400')}>
                {(localThreshold * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={localThreshold}
              onChange={e => setLocalThreshold(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 h-1"
            />
            <div className="flex justify-between font-mono text-[9px] text-zinc-700">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Preview counts */}
          {signals.length > 0 && (
            <div className="flex gap-3">
              <div className="flex-1 rounded border border-emerald-900 bg-emerald-950/20 px-2 py-1.5 text-center">
                <p className="font-mono text-base font-bold text-emerald-400">{wouldPass}</p>
                <p className="font-mono text-[9px] text-emerald-700">tickers pass</p>
              </div>
              <div className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-center">
                <p className="font-mono text-base font-bold text-zinc-500">{wouldFail}</p>
                <p className="font-mono text-[9px] text-zinc-700">tickers fail</p>
              </div>
            </div>
          )}

          {/* Apply button */}
          <button
            type="button"
            onClick={() => void applyThreshold()}
            disabled={!isDirty || saving}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-zinc-700 py-1.5 font-mono text-[10px] text-zinc-400 hover:border-emerald-700 hover:text-emerald-400 disabled:opacity-40 transition-colors"
          >
            <Check className="h-3 w-3" />
            {saving ? 'Applying…' : isDirty ? 'Apply to next scan' : 'No change'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Signal Explorer ──────────────────────────────────────────────────────────

export function SignalExplorer() {
  const [signals, setSignals] = useState<DetectedSignal[]>([])
  const [newSignalKeys, setNewSignalKeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')
  const [sortKey, setSortKey] = useState<SortKey>('detected_at')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const newKeyTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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

  const handleNewSignal = useCallback((signal: DetectedSignal) => {
    const key = `${signal.ticker}-${signal.signal_type}-${signal.detected_at}`
    setSignals(prev => {
      const exists = prev.some(
        s => s.ticker === signal.ticker && s.signal_type === signal.signal_type && s.detected_at === signal.detected_at
      )
      return exists ? prev : [signal, ...prev]
    })
    setNewSignalKeys(prev => new Set(prev).add(key))
    const timer = newKeyTimers.current.get(key)
    if (timer) clearTimeout(timer)
    newKeyTimers.current.set(key, setTimeout(() => {
      setNewSignalKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, 3000))
  }, [])

  const { status: sseStatus } = useSignalSSE(handleNewSignal)

  // Clean up highlight timers on unmount
  useEffect(() => {
    const timers = newKeyTimers.current
    return () => { timers.forEach(clearTimeout) }
  }, [])

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
  const { dot, label } = SSE_STATUS[sseStatus]

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
            {/* Live SSE indicator */}
            <div className="flex items-center gap-1.5" title={`Signal stream: ${label}`}>
              <span className={cn('h-2 w-2 rounded-full', dot)} />
              <span className="font-mono text-[10px] text-zinc-600">{label}</span>
            </div>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap gap-2">
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

          <div className="flex rounded-md border border-zinc-800 overflow-hidden">
            {([['detected_at', 'Latest'], ['composite_score', 'Score'], ['score', 'Detector']] as [SortKey, string][]).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortKey(k)}
                className={cn(
                  'px-2 py-1 font-mono text-[10px] transition-colors',
                  sortKey === k ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'
                )}
              >
                {lbl}
              </button>
            ))}
          </div>

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

        {/* Threshold Simulator */}
        <ThresholdSimulator signals={signals} />
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
          {filtered.map((s, i) => {
            const key = `${s.ticker}-${s.signal_type}-${s.detected_at}-${i}`
            const signalKey = `${s.ticker}-${s.signal_type}-${s.detected_at}`
            return (
              <SignalRow
                key={key}
                signal={s}
                isNew={newSignalKeys.has(signalKey)}
              />
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
