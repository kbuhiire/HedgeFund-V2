import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── WatchlistPanel ───────────────────────────────────────────────────────────

export function WatchlistPanel() {
  const [tickers, setTickers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState('')
  const [scanning, setScanning] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/v1/watchlist')
      if (res.ok) {
        const data = await res.json() as { tickers: string[] }
        setTickers(data.tickers)
      }
    } catch {
      toast.error('Failed to load watchlist')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function add() {
    const ticker = input.trim().toUpperCase()
    if (!ticker) return
    try {
      const res = await apiFetch(`/api/v1/watchlist/${ticker}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json() as { tickers: string[]; added: boolean; message: string }
        setTickers(data.tickers)
        setInput('')
        if (data.added) toast.success(`Added ${ticker} to watchlist`)
        else toast(`${ticker} already in watchlist`)
        inputRef.current?.focus()
      }
    } catch {
      toast.error('Failed to add ticker')
    }
  }

  async function remove(ticker: string) {
    try {
      const res = await apiFetch(`/api/v1/watchlist/${ticker}`, { method: 'DELETE' })
      if (res.ok) {
        const data = await res.json() as { tickers: string[] }
        setTickers(data.tickers)
        toast(`Removed ${ticker}`)
      }
    } catch {
      toast.error('Failed to remove ticker')
    }
  }

  async function scanNow(ticker: string) {
    setScanning(ticker)
    try {
      const res = await apiFetch(`/api/v1/pipeline/scan/${ticker}`, { method: 'POST' })
      if (res.ok) {
        toast.success(`Scanning ${ticker}…`, {
          description: 'Results will appear in the signal feed in ~15s',
          duration: 6000,
        })
      } else {
        toast.error(`Failed to scan ${ticker}`)
      }
    } catch {
      toast.error(`Scan failed for ${ticker}`)
    } finally {
      setTimeout(() => setScanning(null), 3000)
    }
  }

  const filtered = input.trim()
    ? tickers.filter(t => t.includes(input.trim().toUpperCase()))
    : tickers

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Watchlist
          </h2>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-600">{tickers.length} tickers</span>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              title="Refresh watchlist"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Add ticker input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') void add() }}
              placeholder="AAPL, NVDA…"
              maxLength={10}
              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 pl-7 pr-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={!input.trim()}
            className="flex items-center gap-1 rounded-md bg-zinc-700 px-3 py-1.5 font-mono text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-40 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </div>

      {/* Ticker list */}
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-3">
          {loading && tickers.length === 0 && (
            <div className="flex h-24 items-center justify-center">
              <p className="text-xs text-zinc-600">Loading watchlist…</p>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex h-24 items-center justify-center">
              <p className="text-xs text-zinc-600">
                {input ? 'No tickers match' : 'Watchlist is empty'}
              </p>
            </div>
          )}
          {filtered.map(ticker => (
            <div
              key={ticker}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 hover:border-zinc-700 transition-colors group"
            >
              <span className="flex-1 font-mono text-sm font-bold text-zinc-100">{ticker}</span>

              {/* Scan now button */}
              <button
                type="button"
                onClick={() => void scanNow(ticker)}
                disabled={scanning === ticker}
                title="Run on-demand scan for this ticker"
                className={cn(
                  'rounded px-2 py-1 font-mono text-[10px] transition-colors',
                  scanning === ticker
                    ? 'text-zinc-600 cursor-not-allowed'
                    : 'text-zinc-500 hover:bg-zinc-800 hover:text-emerald-400 opacity-0 group-hover:opacity-100'
                )}
              >
                {scanning === ticker ? '…' : 'SCAN'}
              </button>

              {/* Remove button */}
              <button
                type="button"
                onClick={() => void remove(ticker)}
                title={`Remove ${ticker} from watchlist`}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
