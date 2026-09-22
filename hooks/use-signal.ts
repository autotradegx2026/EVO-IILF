'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { canonicalSymbol } from '@/lib/strategy/signal-state'
import type { Signal } from '@/types/database'

function useSignalRows(userId: string | undefined, limit: number, current: boolean, symbol?: string) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  useEffect(() => {
    if (!userId) return
    const uid = userId, supabase = createClient()
    let cancelled = false, pending = false
    setLoading(true); setSignals([]); setError(null); setCheckedAt(null)
    async function refresh() {
      if (pending) return
      pending = true
      try {
        let query = supabase.from('signals').select('*').eq('user_id', uid)
        if (symbol) query = query.eq('symbol', canonicalSymbol(symbol))
        if (current) query = query.in('state', ['LONG_READY', 'SHORT_READY', 'WAIT', 'COOLDOWN'])
        const result = await query.order('received_at', { ascending: false }).limit(limit)
        if (result.error) throw new Error('Signal records could not be refreshed')
        if (!cancelled) { setSignals(result.data ?? []); setCheckedAt(new Date().toISOString()); setError(null) }
      } catch {
        if (!cancelled) { setError('Signal records unavailable. Retrying automatically.'); setSignals([]) }
      } finally { pending = false; if (!cancelled) setLoading(false) }
    }
    void refresh()
    const poll = setInterval(() => { void refresh() }, 10000)
    const channel = supabase.channel(`signals-${current ? 'current' : 'recent'}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signals', filter: `user_id=eq.${uid}` }, () => { void refresh() }).subscribe()
    return () => { cancelled = true; clearInterval(poll); void supabase.removeChannel(channel) }
  }, [userId, limit, current, symbol])
  return { signals, loading, error, checkedAt }
}

export function useCurrentSignal(userId: string | undefined, symbol?: string) {
  const { signals, ...state } = useSignalRows(userId, 1, true, symbol)
  return { signal: signals[0] ?? null, ...state }
}

export function useRecentSignals(userId: string | undefined, limit = 10) {
  return useSignalRows(userId, limit, false)
}
