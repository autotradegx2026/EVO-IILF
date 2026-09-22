'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Position } from '@/types/database'

export function usePositions(userId: string | undefined) {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch('/api/positions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Positions unavailable')
      setPositions(json.data ?? [])
      setError(json.warnings?.join('; ') || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Positions unavailable')
    } finally { setLoading(false) }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const uid = userId
    refetch()

    // Poll every 5 seconds for live P&L
    const interval = setInterval(refetch, 5000)

    // Also subscribe to realtime for open/close events
    const supabase = createClient()
    const channel = supabase
      .channel('positions-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'positions', filter: `user_id=eq.${uid}` },
        () => refetch()
      )
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [userId, refetch])

  return { positions, loading, refetch, error }
}
