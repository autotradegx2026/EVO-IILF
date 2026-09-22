'use client'

import { cn, formatPrice, formatCurrency } from '@/lib/utils'
import type { Position } from '@/types/database'

interface ActivePositionsProps {
  positions: Position[]
  loading: boolean
  error?: string | null
}

export function ActivePositions({ positions, loading, error }: ActivePositionsProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Active Positions</span>
        <span className="text-xs text-muted-foreground">{loading ? 'Loading…' : error && !positions.length ? 'Unavailable' : `${positions.length} open`}</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : positions.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">{error ? 'Positions unavailable until refresh succeeds.' : 'No open positions'}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {positions.map(pos => {
            const pnlPositive = (pos.unrealized_pnl ?? 0) >= 0
            return (
              <div key={pos.id} className="rounded-lg border border-border bg-muted/20 p-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded',
                    pos.direction === 'LONG' ? 'bg-green-400/20 text-green-400' : 'bg-red-400/20 text-red-400'
                  )}>
                    {pos.direction}
                  </span>
                  <div>
                    <div className="font-semibold text-sm">{pos.symbol}</div>
                    <div className="text-xs text-muted-foreground">Qty: {pos.quantity} · Entry: {formatPrice(pos.entry_price)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('font-bold text-sm', pnlPositive ? 'text-green-400' : 'text-red-400')}>
                    {pos.unrealized_pnl == null ? 'PnL unavailable' : `${pnlPositive ? '+' : ''}${formatCurrency(pos.unrealized_pnl)}`}
                  </div>
                  {pos.current_price != null && (
                    <div className="text-xs text-muted-foreground">Last price: {formatPrice(pos.current_price)}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground">Updated {pos.last_updated ? new Date(pos.last_updated).toLocaleString() : 'Not recorded'}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
