'use client'

import { useState, useEffect } from 'react'
import { cn, formatPrice } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { signalFresh } from '@/lib/strategy/signal-state'
import type { Signal } from '@/types/database'

interface TradeDetailsProps {
  signal: Signal | null
  onExecute: (signalId: string) => Promise<void>
  executing: boolean
}

export function TradeDetails({ signal, onExecute, executing }: TradeDetailsProps) {
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => { setConfirmed(false) }, [signal?.id])
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return ()=>clearInterval(timer)},[])
  const fresh=!!signal && signalFresh(String(signal.raw_payload?.timestamp ?? signal.received_at),now)
  const canExecute = fresh && signal && (signal.state === 'LONG_READY' || signal.state === 'SHORT_READY') && !signal.is_executed

  if (!signal) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-center min-h-[160px]">
        <span className="text-muted-foreground text-sm">No signal to display</span>
      </div>
    )
  }

  async function handleExecute() {
    if (!signal || !confirmed) return
    await onExecute(signal.id)
    setConfirmed(false)
  }

  const rrRatio = signal.rr_ratio
    ? signal.rr_ratio
    : signal.entry_price && signal.stop_loss && signal.take_profit
      ? Math.abs(signal.take_profit - signal.entry_price) / Math.abs(signal.entry_price - signal.stop_loss)
      : null

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-5">
      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{signal.direction} · {signal.symbol} · {signal.timeframe}</span>

      <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
        <PriceCard label="Entry" value={formatPrice(signal.entry_price)} color="text-foreground" />
        <PriceCard label="Stop Loss" value={formatPrice(signal.stop_loss)} color="text-red-600" />
        <PriceCard label="Take Profit" value={formatPrice(signal.take_profit)} color="text-green-600" />
        <PriceCard label="R:R Ratio" value={rrRatio ? `${rrRatio.toFixed(2)}:1` : '—'} color="text-primary" />
      </div>

      {signal.quantity && (
        <div className="text-sm text-muted-foreground">
          Suggested qty: <span className="font-semibold text-foreground">{signal.quantity}</span>
        </div>
      )}

      {!fresh && !signal.is_executed && <p className="text-sm text-amber-600">This recorded signal has expired. Waiting for a new qualified closed-candle signal.</p>}
      {!!signal.raw_payload?._execution_environment && <p className="text-xs text-muted-foreground">Signal environment: {String(signal.raw_payload._execution_environment).toUpperCase()}</p>}
      {canExecute && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="rounded border-border"
            />
            I confirm this trade and accept the risk
          </label>
          <Button
            onClick={handleExecute}
            disabled={!confirmed || executing}
            className={cn(
              'w-full font-bold tracking-wide text-base h-12',
              signal.state === 'LONG_READY'
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            )}
          >
            {executing ? 'Executing…' : `EXECUTE ${signal.state === 'LONG_READY' ? 'LONG' : 'SHORT'} TRADE`}
          </Button>
        </div>
      )}

      {!!signal.raw_payload?._dispatch_status && <p className="rounded-xl border border-border p-3 text-xs text-muted-foreground">Last bot check: {String(signal.raw_payload._dispatch_status)}{signal.raw_payload._dispatch_reason ? ` · ${String(signal.raw_payload._dispatch_reason)}` : ''}{signal.raw_payload._dispatch_checked_at ? ` · ${new Date(String(signal.raw_payload._dispatch_checked_at)).toLocaleString()}` : ''}</p>}
      {signal.is_executed && (
        <div className="text-sm text-center text-muted-foreground bg-muted/30 rounded-lg py-2">
          Signal reserved for execution. Check Broker Orders for actual fills.
        </div>
      )}
    </div>
  )
}

function PriceCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn('text-lg font-bold', color)}>{value}</span>
    </div>
  )
}
