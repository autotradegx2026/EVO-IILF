'use client'

import { cn, formatPrice } from '@/lib/utils'
import type { Signal } from '@/types/database'

interface RecentSignalsProps {
  signals: Signal[]
  loading: boolean
  error?: string | null
}

const STATE_BADGE: Record<string, string> = {
  LONG_READY:  'bg-green-400/20 text-green-400',
  SHORT_READY: 'bg-red-400/20 text-red-400',
  WAIT:        'bg-yellow-400/20 text-yellow-400',
  COOLDOWN:    'bg-gray-400/20 text-gray-400',
  REJECTED:    'bg-gray-600/20 text-gray-500',
}

export function RecentSignals({ signals, loading, error }: RecentSignalsProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent Signals</span>

      {error ? <p role="alert" className="text-sm text-amber-600">{error}</p> : loading ? (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : signals.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">No signals yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Time', 'Symbol', 'State', 'Entry', 'SL', 'TP', 'Score', 'Reserved for execution'].map(h => (
                  <th key={h} className="text-left text-xs text-muted-foreground font-medium pb-2 pr-4 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signals.map(sig => (
                <tr key={sig.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                    {new Date(sig.received_at).toLocaleTimeString()}
                  </td>
                  <td className="py-2 pr-4 font-semibold">{sig.symbol}</td>
                  <td className="py-2 pr-4">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded', STATE_BADGE[sig.state] ?? STATE_BADGE.REJECTED)}>
                      {sig.state.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{formatPrice(sig.entry_price)}</td>
                  <td className="py-2 pr-4 text-red-400">{formatPrice(sig.stop_loss)}</td>
                  <td className="py-2 pr-4 text-green-400">{formatPrice(sig.take_profit)}</td>
                  <td className="py-2 pr-4">{sig.confluence_score}/7</td>
                  <td className="py-2 pr-4">
                    {sig.is_executed
                      ? <span className="text-green-400 text-xs">Reserved</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
