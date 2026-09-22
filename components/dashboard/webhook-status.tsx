'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDistanceToNow } from 'date-fns'

export function WebhookStatus({ userId }: { userId: string | undefined }) {
  const [lastPing, setLastPing] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    let cancelled = false, pending = false
    setLoading(true)
    setLastPing(null)
    setUnavailable(false)

    async function fetchLastLog() {
      if (pending) return
      pending = true
      try {
        const { data, error } = await supabase.from('webhook_logs').select('received_at')
          .eq('user_id', userId!).order('received_at', { ascending: false }).limit(1).maybeSingle()
        if (cancelled) return
        if (error) { setUnavailable(true); return }
        setLastPing(data ? new Date(data.received_at) : null)
        setUnavailable(false)
      } catch {
        if (!cancelled) setUnavailable(true)
      } finally {
        pending = false
        if (!cancelled) setLoading(false)
      }
    }
    void fetchLastLog()
    const channel = supabase.channel(`webhook_logs_changes_${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'webhook_logs', filter: `user_id=eq.${userId}` }, () => { void fetchLastLog() })
      .subscribe()
    // Polling also keeps delivery age current if realtime is disconnected.
    const timer = setInterval(() => { void fetchLastLog() }, 30000)
    return () => { cancelled = true; clearInterval(timer); void supabase.removeChannel(channel) }
  }, [userId])

  if (!userId || unavailable) return <span className="text-xs text-muted-foreground">Webhook delivery history unavailable</span>
  if (loading) return <span className="text-xs text-muted-foreground">Checking webhook deliveries…</span>
  if (!lastPing || !Number.isFinite(lastPing.getTime())) {
    return <span className="text-xs text-muted-foreground" title="No webhook delivery has been logged for this account. This does not indicate whether automatic paper scanning is enabled.">No webhook deliveries recorded</span>
  }
  return <span className="text-xs text-muted-foreground" title={`Last webhook delivery: ${lastPing.toLocaleString()}. Receipt does not confirm a qualified signal or a trade.`}>
    Last webhook delivery {formatDistanceToNow(lastPing)} ago
  </span>
}
