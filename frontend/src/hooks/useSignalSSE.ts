import { useEffect, useState } from 'react'
import { getToken } from '@/lib/api'

export type SignalSSEStatus = 'connecting' | 'connected' | 'disconnected'

export interface LiveSignal {
  ticker: string
  signal_type: string
  score: number
  composite_score: number
  passed_gate: boolean
  detected_at: string
  detail: Record<string, unknown> | null
  source: string
}

/**
 * Connect to the backend signal SSE stream and invoke `onSignal` for each
 * new signal published by the market scanner. The browser EventSource API
 * handles reconnect automatically on error.
 */
export function useSignalSSE(onSignal: (signal: LiveSignal) => void) {
  const [status, setStatus] = useState<SignalSSEStatus>('disconnected')

  useEffect(() => {
    setStatus('connecting')
    const token = getToken()
    const url = token
      ? `/api/v1/events/signals?token=${encodeURIComponent(token)}`
      : '/api/v1/events/signals'

    const es = new EventSource(url)

    es.onopen = () => setStatus('connected')

    es.addEventListener('signal', (e: MessageEvent) => {
      try {
        const signal = JSON.parse(e.data as string) as LiveSignal
        onSignal(signal)
      } catch (err) {
        console.warn('[SignalSSE] Failed to parse signal event:', err)
      }
    })

    es.onerror = () => {
      setStatus('disconnected')
    }

    return () => {
      es.close()
      setStatus('disconnected')
    }
  }, [onSignal])

  return { status }
}
