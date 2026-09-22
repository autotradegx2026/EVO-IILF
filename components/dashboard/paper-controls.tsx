'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PaperConfiguration } from '@/lib/paper/status'

export function PaperControls({ configuration, loading, refresh }: { configuration: PaperConfiguration | null; loading: boolean; refresh: () => Promise<void> }) {
  const [source, setSource] = useState('binance'), [symbols, setSymbols] = useState(''), [timeframe, setTimeframe] = useState('15m')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const dirty = useRef(false), initialized = useRef(false), mutation = useRef(false)
  const enabled = !!configuration?.paper_trading_enabled
  useEffect(() => {
    if (!configuration || (dirty.current && initialized.current)) return
    initialized.current = true
    setSource(configuration.paper_auto_scan ? 'binance' : configuration.signal_delivery_mode === 'paper' ? 'tradingview' : 'binance')
    setSymbols((configuration.paper_symbols ?? []).join(', '))
    setTimeframe(configuration.paper_timeframe ?? '15m')
  }, [configuration])
  async function change(enabled: boolean) {
    if (mutation.current) return
    mutation.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const watchlist = symbols.split(/[\s,]+/).filter(Boolean).map(s => s.toUpperCase())
      const response = await fetch('/api/paper/automation', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(enabled ? {enabled,source,symbols:source === 'binance' ? watchlist : [],timeframe} : {enabled}) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'Paper control could not be saved')
      dirty.current = false; setMessage(json.message)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Paper control unavailable') }
    finally { setBusy(false); mutation.current = false }
  }
  const field = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm'
  return <Card aria-label="Paper trading controls">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="text-lg">Paper trading</CardTitle><span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${enabled ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>{loading ? 'Loading…' : !configuration ? 'Status unavailable' : enabled ? 'ON · simulated entries enabled' : 'OFF · simulated entries stopped'}</span></div>
      <CardDescription>Uses actual market candles with simulated fills and capital. The server checks the market every minute, even when the browser is closed. New entries are allowed only during your saved session.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <fieldset disabled={busy || loading || !configuration || enabled} className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">Paper market source<select className={field} value={source} onChange={e => { dirty.current=true; setSource(e.target.value) }}><option value="binance">Binance market scanner · no broker key needed</option><option value="tradingview">TradingView candle alerts</option></select></label>
        {source === 'binance' && <><label className="text-sm">Paper candle timeframe<select className={field} value={timeframe} onChange={e => {dirty.current=true;setTimeframe(e.target.value)}}>{['1m','5m','15m','1h'].map(tf=><option key={tf}>{tf}</option>)}</select></label><label className="text-sm md:col-span-2">Paper watchlist<input className={field} value={symbols} placeholder="BINANCE:BTCUSDT, BINANCE:ETHUSDT" onChange={e=>{dirty.current=true;setSymbols(e.target.value)}} /><span className="mt-1 block text-xs text-muted-foreground">Enter one to five Binance USDT pairs. This watchlist is separate from broker trading.</span></label></>}
      </fieldset>
      {source === 'tradingview' && <p className="text-sm text-muted-foreground">Uses the TradingView paper delivery mode, token and watchlist saved in <Link href="/screener" className="underline">Strategy & Screener</Link>. Keep candle alerts running for position exits.</p>}
      {configuration && <p className="text-sm text-muted-foreground">Session {configuration.session_start.slice(0,5)}–{configuration.session_end.slice(0,5)} ({configuration.session_timezone ?? 'Asia/Kolkata'}). Strategy parameters and risk limits are shared with your saved strategy. <Link className="underline" href="/screener">Edit strategy and session</Link>.</p>}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={busy || loading || !configuration || enabled || configuration.kill_switch_active} onClick={()=>void change(true)}><Play />{busy ? 'Saving…' : 'Start paper trading'}</Button>
        <Button variant="destructive" size="lg" disabled={busy || (!!configuration && !enabled)} onClick={()=>void change(false)}><Square />Stop paper trading</Button>
      </div>
      {configuration?.kill_switch_active && <p className="text-sm text-amber-600">The global entry pause is active. <Link href="/risk" className="underline">Review Risk controls</Link> before starting.</p>}
      <p className="text-xs text-muted-foreground">Stop blocks new entries. Existing paper positions continue automatic stop-loss, target and session-exit checks. Starting only opens trades when the strategy qualifies a setup.</p>
      <p className="text-xs text-muted-foreground">Last started: {configuration?.paper_started_at ? new Date(configuration.paper_started_at).toLocaleString() : 'Not recorded'} · Last stopped: {configuration?.paper_stopped_at ? new Date(configuration.paper_stopped_at).toLocaleString() : 'Not recorded'}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm text-primary">{message}</p>}
    </CardContent>
  </Card>
}
