import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface PriceOutcome {
  currentPrice: number | null
  priceAtDecision: number | null
  changePct: number | null
  loading: boolean
}

/**
 * Fetches the latest price for a ticker from the backend signals/price endpoint.
 * Returns the price change % since the decision was made.
 */
export function usePriceChange(ticker: string, decidedAt: string): PriceOutcome {
  const [state, setState] = useState<PriceOutcome>({
    currentPrice: null,
    priceAtDecision: null,
    changePct: null,
    loading: true,
  })

  useEffect(() => {
    if (!ticker) return
    let cancelled = false

    async function fetch() {
      try {
        const res = await apiFetch(`/api/v1/signals/${encodeURIComponent(ticker)}?limit=50`)
        if (!res.ok || cancelled) return

        const signals = await res.json() as Array<{ detected_at: string; detail: Record<string, unknown> | null }>
        if (cancelled) return

        // Find price data nearest to decidedAt from signal details
        const decisionTime = new Date(decidedAt).getTime()
        let closestPrice: number | null = null
        let closestDiff = Infinity
        let latestPrice: number | null = null
        let latestTime = 0

        for (const sig of signals) {
          const detail = sig.detail
          if (!detail) continue
          const close = detail['close'] as number | undefined
          if (close == null) continue

          const sigTime = new Date(sig.detected_at).getTime()
          const diff = Math.abs(sigTime - decisionTime)
          if (diff < closestDiff) {
            closestDiff = diff
            closestPrice = close
          }
          if (sigTime > latestTime) {
            latestTime = sigTime
            latestPrice = close
          }
        }

        if (!cancelled) {
          const changePct =
            closestPrice != null && latestPrice != null && closestPrice > 0
              ? ((latestPrice - closestPrice) / closestPrice) * 100
              : null
          setState({ currentPrice: latestPrice, priceAtDecision: closestPrice, changePct, loading: false })
        }
      } catch {
        if (!cancelled) setState(prev => ({ ...prev, loading: false }))
      }
    }

    void fetch()
    return () => { cancelled = true }
  }, [ticker, decidedAt])

  return state
}
