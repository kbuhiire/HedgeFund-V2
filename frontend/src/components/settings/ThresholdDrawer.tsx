import { useCallback, useEffect, useState } from 'react'
import { Settings, Save, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Thresholds {
  signal_quality_gate: number
  agent_variance_threshold: number
  asymmetric_min_buy_count: number
  asymmetric_min_avg_confidence: number
  invest_min_conviction: number
  monitor_min_conviction: number
  opportunity_dedup_ttl_seconds: number
  llm_daily_limit_usd: number
}

// ─── Slider field ─────────────────────────────────────────────────────────────

interface SliderFieldProps {
  label: string
  description: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

function SliderField({ label, description, value, min, max, step, format, onChange }: SliderFieldProps) {
  const display = format ? format(value) : String(value)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="font-mono text-xs text-zinc-300">{label}</label>
        <span className="font-mono text-sm font-bold text-zinc-100">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-emerald-500"
      />
      <p className="text-[10px] text-zinc-600">{description}</p>
    </div>
  )
}

// ─── ThresholdDrawer ──────────────────────────────────────────────────────────

interface ThresholdDrawerProps {
  open: boolean
  onClose: () => void
}

export function ThresholdDrawer({ open, onClose }: ThresholdDrawerProps) {
  const [thresholds, setThresholds] = useState<Thresholds | null>(null)
  const [dirty, setDirty] = useState<Partial<Thresholds>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/v1/config/thresholds')
      if (res.ok) {
        const data = await res.json() as { thresholds: Thresholds }
        setThresholds(data.thresholds)
        setDirty({})
      }
    } catch {
      toast.error('Failed to load thresholds')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) void load() }, [open, load])

  function patch<K extends keyof Thresholds>(key: K, value: Thresholds[K]) {
    setThresholds(prev => prev ? { ...prev, [key]: value } : null)
    setDirty(prev => ({ ...prev, [key]: value }))
  }

  async function save() {
    if (!Object.keys(dirty).length) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/config/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dirty),
      })
      if (res.ok) {
        const data = await res.json() as { thresholds: Thresholds; updated: string[] }
        setThresholds(data.thresholds)
        setDirty({})
        toast.success(`Saved ${data.updated.length} threshold${data.updated.length !== 1 ? 's' : ''}`)
      } else {
        toast.error('Failed to save thresholds')
      }
    } catch {
      toast.error('Network error saving thresholds')
    } finally {
      setSaving(false)
    }
  }

  const t = thresholds

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-zinc-500" />
              <SheetTitle className="font-mono text-sm font-semibold text-zinc-200">
                CIO Thresholds
              </SheetTitle>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void load()}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 transition-colors"
                title="Reload from server"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p className="text-[11px] text-zinc-500">
            Changes take effect on the next scan cycle — no restart needed.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading && !t && (
            <div className="flex h-40 items-center justify-center">
              <p className="text-xs text-zinc-600">Loading…</p>
            </div>
          )}

          {t && (
            <>
              {/* Signal Quality */}
              <section className="space-y-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Signal Quality Gate</p>
                <SliderField
                  label="Quality gate threshold"
                  description="Minimum composite score [0–1] for a signal to enter the analysis queue."
                  value={t.signal_quality_gate}
                  min={0.1} max={0.9} step={0.05}
                  format={v => v.toFixed(2)}
                  onChange={v => patch('signal_quality_gate', v)}
                />
              </section>

              <Separator />

              {/* Variance */}
              <section className="space-y-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Agent Variance</p>
                <SliderField
                  label="Variance threshold"
                  description="Inter-agent confidence std-dev above this value downgrades INVEST → MONITOR."
                  value={t.agent_variance_threshold}
                  min={2} max={30} step={1}
                  onChange={v => patch('agent_variance_threshold', v)}
                />
              </section>

              <Separator />

              {/* Asymmetric flag */}
              <section className="space-y-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Asymmetric Opportunity Flag</p>
                <SliderField
                  label="Min BUY votes"
                  description="Minimum number of persona agents that must vote BUY to flag as asymmetric."
                  value={t.asymmetric_min_buy_count}
                  min={1} max={5} step={1}
                  onChange={v => patch('asymmetric_min_buy_count', v)}
                />
                <SliderField
                  label="Min avg BUY confidence"
                  description="Minimum average confidence (%) across BUY votes for asymmetric flag."
                  value={t.asymmetric_min_avg_confidence}
                  min={40} max={95} step={5}
                  format={v => `${v}%`}
                  onChange={v => patch('asymmetric_min_avg_confidence', v)}
                />
              </section>

              <Separator />

              {/* CIO verdict thresholds */}
              <section className="space-y-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">CIO Verdict Rules</p>
                <SliderField
                  label="INVEST min conviction"
                  description="Conviction score at or above which BUY consensus becomes INVEST."
                  value={t.invest_min_conviction}
                  min={20} max={80} step={5}
                  onChange={v => patch('invest_min_conviction', v)}
                />
                <SliderField
                  label="MONITOR min conviction (neutral)"
                  description="Minimum conviction for MONITOR when consensus is not BUY."
                  value={t.monitor_min_conviction}
                  min={20} max={80} step={5}
                  onChange={v => patch('monitor_min_conviction', v)}
                />
              </section>

              <Separator />

              {/* Operational */}
              <section className="space-y-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Operational</p>
                <SliderField
                  label="Dedup TTL (seconds)"
                  description="How long a ticker is blocked from re-entering the analysis queue after being processed."
                  value={t.opportunity_dedup_ttl_seconds}
                  min={300} max={86400} step={300}
                  format={v => {
                    const h = Math.floor(v / 3600)
                    const m = Math.floor((v % 3600) / 60)
                    return h > 0 ? `${h}h ${m}m` : `${m}m`
                  }}
                  onChange={v => patch('opportunity_dedup_ttl_seconds', v)}
                />
                <SliderField
                  label="Daily LLM spend limit (USD)"
                  description="Maximum USD spend on OpenAI calls per UTC calendar day."
                  value={t.llm_daily_limit_usd}
                  min={1} max={50} step={1}
                  format={v => `$${v}`}
                  onChange={v => patch('llm_daily_limit_usd', v)}
                />
              </section>
            </>
          )}
        </div>

        {/* Save bar */}
        {Object.keys(dirty).length > 0 && (
          <div className="shrink-0 border-t border-zinc-800 px-6 py-4">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 font-mono text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : `Save ${Object.keys(dirty).length} change${Object.keys(dirty).length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
