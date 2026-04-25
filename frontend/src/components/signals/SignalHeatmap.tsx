import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
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
}

const SIGNAL_TYPES = [
  'volume_spike',
  'price_breakout',
  'insider_cluster',
  'news_catalyst',
  'sector_momentum',
] as const

const TYPE_ABBREV: Record<string, string> = {
  volume_spike: 'VOL',
  price_breakout: 'BRK',
  insider_cluster: 'INS',
  news_catalyst: 'NEWS',
  sector_momentum: 'MOM',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreToColor(score: number | undefined, passed: boolean | undefined): string {
  if (score === undefined) return 'bg-zinc-900 text-zinc-700'
  const pct = Math.min(1, Math.max(0, score))
  if (!passed) {
    if (pct >= 0.7) return 'bg-zinc-700/60 text-zinc-400'
    if (pct >= 0.4) return 'bg-zinc-800/60 text-zinc-500'
    return 'bg-zinc-900 text-zinc-700'
  }
  if (pct >= 0.85) return 'bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-600/50'
  if (pct >= 0.65) return 'bg-emerald-700/20 text-emerald-400'
  if (pct >= 0.45) return 'bg-emerald-900/30 text-emerald-600'
  return 'bg-zinc-800/60 text-zinc-500'
}

// ─── Signal Heatmap ───────────────────────────────────────────────────────────

export function SignalHeatmap() {
  const [signals, setSignals] = useState<DetectedSignal[]>([])
  const [tickers, setTickers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sigRes, watchRes] = await Promise.all([
        apiFetch('/api/v1/signals?limit=500'),
        apiFetch('/api/v1/watchlist'),
      ])
      if (sigRes.ok) {
        const data = await sigRes.json() as DetectedSignal[]
        setSignals(data)
      }
      if (watchRes.ok) {
        const data = await watchRes.json() as { tickers: string[] }
        setTickers(data.tickers)
      }
    } catch {
      // silently handle offline
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Build a lookup: ticker → signal_type → { score, passed_gate, detected_at }
  type CellData = { score: number; passed_gate: boolean; detected_at: string }
  const grid = new Map<string, Map<string, CellData>>()

  for (const s of signals) {
    if (!grid.has(s.ticker)) grid.set(s.ticker, new Map())
    const existing = grid.get(s.ticker)!.get(s.signal_type)
    // keep the most recent signal for each ticker × type combination
    if (!existing || new Date(s.detected_at) > new Date(existing.detected_at)) {
      grid.get(s.ticker)!.set(s.signal_type, {
        score: s.score,
        passed_gate: s.passed_gate,
        detected_at: s.detected_at,
      })
    }
  }

  // Use watchlist order; fall back to tickers seen in signals
  const signalTickers = Array.from(new Set(signals.map(s => s.ticker)))
  const rows = tickers.length > 0 ? tickers : signalTickers

  // Compute composite pass status per ticker (any signal that passed gate)
  const tickerPassed = (ticker: string) =>
    signals.some(s => s.ticker === ticker && s.passed_gate)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Signal Heatmap
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          title="Refresh heatmap"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-3">
        {loading && rows.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-xs text-zinc-600">Loading heatmap…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-xs text-zinc-600">No signal data yet</p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {/* Ticker column header */}
                <th className="pb-2 pr-2 text-left font-mono text-[9px] uppercase tracking-widest text-zinc-600 w-16">
                  Ticker
                </th>
                {SIGNAL_TYPES.map(type => (
                  <th
                    key={type}
                    className="pb-2 px-1 font-mono text-[9px] uppercase tracking-widest text-zinc-600 text-center"
                    title={type.replace(/_/g, ' ')}
                  >
                    {TYPE_ABBREV[type]}
                  </th>
                ))}
                {/* Gate column */}
                <th className="pb-2 pl-2 font-mono text-[9px] uppercase tracking-widest text-zinc-600 text-center">
                  Gate
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(ticker => {
                const tickerRow = grid.get(ticker)
                const passed = tickerPassed(ticker)
                return (
                  <tr key={ticker} className="group">
                    <td className="py-0.5 pr-2">
                      <span className={cn(
                        'font-mono text-[11px] font-semibold',
                        passed ? 'text-zinc-200' : 'text-zinc-500'
                      )}>
                        {ticker}
                      </span>
                    </td>
                    {SIGNAL_TYPES.map(type => {
                      const cell = tickerRow?.get(type)
                      const colorClass = scoreToColor(cell?.score, cell?.passed_gate)
                      return (
                        <td key={type} className="py-0.5 px-1">
                          <div
                            className={cn(
                              'h-6 w-full rounded flex items-center justify-center font-mono text-[9px] transition-colors',
                              colorClass
                            )}
                            title={cell ? `${type.replace(/_/g, ' ')}: ${(cell.score * 100).toFixed(0)}%` : undefined}
                          >
                            {cell ? `${(cell.score * 100).toFixed(0)}` : '·'}
                          </div>
                        </td>
                      )
                    })}
                    {/* Gate cell */}
                    <td className="py-0.5 pl-2 text-center">
                      <span className={cn(
                        'font-mono text-[10px]',
                        passed ? 'text-emerald-500' : 'text-zinc-700'
                      )}>
                        {passed ? '●' : '○'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Legend */}
        {rows.length > 0 && (
          <div className="mt-4 flex items-center gap-3 border-t border-zinc-800 pt-3">
            <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-700">Legend</span>
            {[
              { cls: 'bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-600/50', label: 'High (≥85%)' },
              { cls: 'bg-emerald-700/20 text-emerald-400', label: 'Med (65%)' },
              { cls: 'bg-zinc-800/60 text-zinc-500', label: 'Low (45%)' },
              { cls: 'bg-zinc-900 text-zinc-700', label: 'None' },
            ].map(({ cls, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={cn('h-3.5 w-5 rounded font-mono text-[8px] flex items-center justify-center', cls)}>
                  {label.startsWith('None') ? '·' : '▪'}
                </div>
                <span className="font-mono text-[9px] text-zinc-700">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
