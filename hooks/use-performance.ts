'use client'
import { useEffect, useState } from 'react'
import type { PerformanceMetrics, MonthlyPerformance } from '@/types/trading'

export function usePerformance(userId: string | undefined) {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)
  const [monthly, setMonthly] = useState<MonthlyPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!userId) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    async function load() {
      try {
        const responses = await Promise.all([
          fetch('/api/performance?period=all', { signal: controller.signal }),
          fetch('/api/performance/monthly?period=all', { signal: controller.signal }),
        ])
        if (responses.some(r => !r.ok)) throw new Error('Performance unavailable')
        const [performance, months] = await Promise.all(responses.map(r => r.json()))
        if (!controller.signal.aborted) { setMetrics(performance.data); setMonthly(months.data); setError(null) }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Performance unavailable') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    load()
    return () => controller.abort()
  }, [userId])
  return { metrics, monthly, loading, error }
}
