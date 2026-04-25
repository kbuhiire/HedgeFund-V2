import { useCallback, useEffect, useRef, useState } from 'react'
import { Settings, Play, Zap, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { PipelineGraph } from '@/components/graph/PipelineGraph'
import { OpportunityFeed } from '@/components/feed/OpportunityFeed'
import { OutputDashboard } from '@/components/output/OutputDashboard'
import { SignalExplorer } from '@/components/signals/SignalExplorer'
import { SignalHeatmap } from '@/components/signals/SignalHeatmap'
import { WatchlistPanel } from '@/components/watchlist/WatchlistPanel'
import { ThresholdDrawer } from '@/components/settings/ThresholdDrawer'
import { useSSEStore, type SSEStatus } from '@/hooks/usePipelineSSE'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── SSE status dot ──────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<SSEStatus, { dot: string; text: string; label: string }> = {
  connected:    { dot: 'bg-emerald-500 animate-pulse', text: 'text-emerald-500', label: 'LIVE' },
  connecting:   { dot: 'bg-yellow-500 animate-pulse',  text: 'text-yellow-500',  label: 'CONNECTING' },
  disconnected: { dot: 'bg-zinc-600',                  text: 'text-zinc-600',     label: 'OFFLINE' },
}

// ─── Pipeline status types ────────────────────────────────────────────────────

interface PipelineStatus {
  last_scan_at: string | null
  last_pass_rate: number | null
  tickers_scanned: number | null
  queue_depth: number
}

interface SpendData {
  current_spend_usd: number
  daily_limit_usd: number
  utilisation_pct: number
}

// ─── Ticker search bar ────────────────────────────────────────────────────────

function TickerSearchBar() {
  const [value, setValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function scan() {
    const ticker = value.trim().toUpperCase()
    if (!ticker) return
    setScanning(true)
    try {
      const res = await apiFetch(`/api/v1/pipeline/scan/${ticker}`, { method: 'POST' })
      if (res.ok) {
        toast.success(`Scanning ${ticker}…`, {
          description: 'Results arrive in the signal feed in ~15 seconds',
          duration: 8000,
        })
        setValue('')
      } else {
        toast.error(`Could not scan ${ticker}`)
      }
    } catch {
      toast.error('Scan request failed')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-zinc-600" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value.toUpperCase())}
        onKeyDown={e => { if (e.key === 'Enter') void scan() }}
        placeholder="SCAN TICKER…"
        maxLength={10}
        className="h-7 w-32 rounded-md border border-zinc-700 bg-zinc-900 pl-7 pr-7 font-mono text-[11px] text-zinc-300 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:w-40 transition-all"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          className="absolute right-2 text-zinc-600 hover:text-zinc-400"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {scanning && (
        <span className="ml-2 font-mono text-[10px] text-yellow-500 animate-pulse">scanning…</span>
      )}
    </div>
  )
}

// ─── Pipeline stats bar ───────────────────────────────────────────────────────

function PipelineStats() {
  const [status, setStatus] = useState<PipelineStatus | null>(null)
  const [spend, setSpend] = useState<SpendData | null>(null)
  const [running, setRunning] = useState(false)
  const [demoing, setDemoing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [sRes, spRes] = await Promise.all([
        apiFetch('/api/v1/pipeline/status'),
        apiFetch('/api/v1/pipeline/spend'),
      ])
      if (sRes.ok) setStatus(await sRes.json() as PipelineStatus)
      if (spRes.ok) setSpend(await spRes.json() as SpendData)
    } catch {
      // silently ignore — backend may be offline
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(id)
  }, [refresh])

  async function runPipeline() {
    setRunning(true)
    try {
      const res = await apiFetch('/api/v1/pipeline/run', { method: 'POST' })
      if (res.ok) {
        toast.success('Pipeline triggered', { description: 'Ingest + scan running…', duration: 5000 })
        setTimeout(() => void refresh(), 20_000)
      } else {
        toast.error('Failed to trigger pipeline')
      }
    } catch {
      toast.error('Pipeline request failed')
    } finally {
      setRunning(false)
    }
  }

  async function runDemo() {
    setDemoing(true)
    try {
      const res = await apiFetch('/api/v1/demo/run', { method: 'POST' })
      if (res.ok) {
        const data = await res.json() as { opportunities_analysed: number }
        toast.success(`Demo run complete — ${data.opportunities_analysed} opportunities analysed`)
      } else {
        toast.error('Demo run failed')
      }
    } catch {
      toast.error('Demo request failed')
    } finally {
      setDemoing(false)
    }
  }

  const lastScan = status?.last_scan_at
    ? new Date(status.last_scan_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  const spendPct = spend?.utilisation_pct ?? 0
  const spendColor = spendPct > 80 ? 'text-red-400' : spendPct > 50 ? 'text-yellow-400' : 'text-zinc-500'

  return (
    <div className="flex items-center gap-3">
      {/* Stats pills */}
      {status && (
        <div className="hidden items-center gap-3 font-mono text-[10px] md:flex">
          {lastScan && (
            <span className="text-zinc-600">SCAN <span className="text-zinc-400">{lastScan}</span></span>
          )}
          {status.last_pass_rate != null && (
            <span className="text-zinc-600">PASS <span className="text-zinc-400">{(status.last_pass_rate * 100).toFixed(0)}%</span></span>
          )}
          {status.queue_depth > 0 && (
            <span className="text-yellow-600">QUEUE <span className="text-yellow-400">{status.queue_depth}</span></span>
          )}
        </div>
      )}

      {/* LLM spend */}
      {spend && (
        <span className={cn('hidden font-mono text-[10px] md:block', spendColor)}>
          ${spend.current_spend_usd.toFixed(2)}/${spend.daily_limit_usd.toFixed(0)}
        </span>
      )}

      {/* Demo button */}
      <button
        type="button"
        onClick={() => void runDemo()}
        disabled={demoing}
        title="Run demo pipeline with synthetic data"
        className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50 transition-colors"
      >
        <Zap className="h-3 w-3" />
        {demoing ? 'DEMO…' : 'DEMO'}
      </button>

      {/* Run pipeline button */}
      <button
        type="button"
        onClick={() => void runPipeline()}
        disabled={running}
        title="Trigger full ingest + scan"
        className="flex items-center gap-1 rounded-md bg-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
      >
        <Play className="h-3 w-3" />
        {running ? 'RUNNING…' : 'RUN'}
      </button>
    </div>
  )
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type MiddleTab = 'feed' | 'signals'
type RightTab = 'opportunities' | 'watchlist' | 'heatmap'

// ─── DashboardLayout ─────────────────────────────────────────────────────────

export function DashboardLayout() {
  const sseStatus = useSSEStore((s) => s.status)
  const { dot, text, label } = STATUS_DISPLAY[sseStatus]

  const [middleTab, setMiddleTab] = useState<MiddleTab>('feed')
  const [rightTab, setRightTab] = useState<RightTab>('opportunities')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div style={{ height: '100dvh', display: 'grid', gridTemplateRows: 'auto 1fr', gridTemplateColumns: '1fr' }}>
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-2">
        {/* Left: brand */}
        <span className="shrink-0 font-mono text-xs font-semibold tracking-widest text-zinc-400">
          HEDGEFUND V2
        </span>

        {/* Center: ticker search */}
        <TickerSearchBar />

        {/* Right: pipeline controls + SSE status + settings */}
        <div className="flex items-center gap-3">
          <PipelineStats />

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="CIO Threshold Settings"
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            <span className={`font-mono text-[10px] ${text}`}>{label}</span>
          </div>
        </div>
      </header>

      {/* ── Three-panel grid ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px 380px',
          overflow: 'hidden',
          height: '100%',
        }}
      >
        {/* Left: Pipeline Graph */}
        <div className="relative border-r border-zinc-800" style={{ width: '100%', height: '100%' }}>
          <PipelineGraph />
        </div>

        {/* Middle: Feed / Signal Explorer tabs */}
        <div className="flex flex-col overflow-hidden border-r border-zinc-800">
          {/* Tab bar */}
          <div className="flex shrink-0 border-b border-zinc-800">
            {(['feed', 'signals'] as MiddleTab[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setMiddleTab(tab)}
                className={cn(
                  'flex-1 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors',
                  middleTab === tab
                    ? 'border-b-2 border-zinc-400 text-zinc-200'
                    : 'text-zinc-600 hover:text-zinc-400'
                )}
              >
                {tab === 'feed' ? 'Live Feed' : 'Signals'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {middleTab === 'feed' ? <OpportunityFeed /> : <SignalExplorer />}
          </div>
        </div>

        {/* Right: Opportunities / Watchlist tabs */}
        <div className="flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex shrink-0 border-b border-zinc-800">
            {(['opportunities', 'watchlist', 'heatmap'] as RightTab[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                className={cn(
                  'flex-1 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors',
                  rightTab === tab
                    ? 'border-b-2 border-zinc-400 text-zinc-200'
                    : 'text-zinc-600 hover:text-zinc-400'
                )}
              >
                {tab === 'opportunities' ? 'Opps' : tab === 'watchlist' ? 'Watchlist' : 'Heatmap'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {rightTab === 'opportunities' && <OutputDashboard />}
            {rightTab === 'watchlist' && <WatchlistPanel />}
            {rightTab === 'heatmap' && <SignalHeatmap />}
          </div>
        </div>
      </div>

      {/* Settings drawer */}
      <ThresholdDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
