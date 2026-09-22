'use client'

import { cn } from '@/lib/utils'
import type { Signal } from '@/types/database'

interface SignalHeroProps {
  signal: Signal | null
  loading: boolean
  error?: string | null
}

const STATE_CONFIG = {
  LONG_READY:  { label: 'LONG READY',  color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200',  dot: 'bg-green-600' },
  SHORT_READY: { label: 'SHORT READY', color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    dot: 'bg-red-600' },
  WAIT:        { label: 'WAIT',         color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  COOLDOWN:    { label: 'COOLDOWN',     color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', dot: 'bg-slate-500' },
  REJECTED:    { label: 'REJECTED',     color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', dot: 'bg-slate-500' },
} as const

export function SignalHero({ signal, loading, error }: SignalHeroProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 flex items-center justify-center min-h-[140px]">
        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (error) return <p role="alert" className="rounded-xl border border-border bg-card p-5 text-sm text-amber-600">{error}</p>

  if (!signal) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center min-h-[140px] gap-2">
        <span className="text-2xl font-bold text-muted-foreground">WAITING FOR SIGNAL</span>
        <span className="text-sm text-muted-foreground">No unexecuted signal is recorded for this account.</span>
      </div>
    )
  }

  const cfg = STATE_CONFIG[signal.state] ?? STATE_CONFIG.WAIT

  return (
    <div className={cn('rounded-xl border p-8 flex flex-col gap-4 min-h-[140px]', cfg.bg, cfg.border)}>
      <div className="flex items-center gap-3">
        <span className={cn('w-3 h-3 rounded-full animate-pulse', cfg.dot)} />
        <span className={cn('text-3xl font-black tracking-widest', cfg.color)}>Last signal: {cfg.label}</span>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <Stat label="Symbol" value={signal.symbol} />
        <Stat label="Timeframe" value={signal.timeframe ?? '—'} />
        <Stat label="Confluence" value={`${signal.confluence_score}/7`} />
        <Stat label="R:R" value={signal.rr_ratio ? `${signal.rr_ratio}:1` : '—'} />
        <Stat label="Received" value={new Date(signal.received_at).toLocaleTimeString()} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}
