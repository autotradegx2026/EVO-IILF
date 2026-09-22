'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CLIENT_DEFAULTS, configFromSettings, configToSettings, StrategyConfigSchema, validateStrategy, type StrategyConfig } from '@/lib/strategy/config'
import { generatePine } from '@/lib/strategy/pine'
import type { StrategySnapshot } from '@/lib/strategy/engine'

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
type EntryPayload = { symbol?: string; action?: string; price?: number; sl?: number; tp?: number; confluence?: number; timestamp?: string; factors?: Record<string, boolean> }
type Delivery = { id: string; payload: EntryPayload & { kind?: string; entry?: EntryPayload | null; bar?: { symbol?: string; close_time?: string } }; status: string; result: { reason?: string; error?: string; status?: string } | null; received_at: string; paper: boolean }
const entryPayload = (delivery: Delivery): EntryPayload | null => delivery.payload.kind === 'BAR' ? delivery.payload.entry ?? null : delivery.payload
type Scan = { symbol: string; snapshot: StrategySnapshot | null; error: string | null }
const fieldClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const numericFields: { key: keyof StrategyConfig; label: string; min: number; max: number; step?: number }[] = [
  { key: 'trendEmaLength', label: 'Trend EMA', min: 5, max: 500 }, { key: 'fastEmaLength', label: 'Fast EMA', min: 3, max: 200 },
  { key: 'htfEmaLength', label: 'HTF EMA', min: 20, max: 1000 }, { key: 'adxLength', label: 'ADX length', min: 2, max: 50 },
  { key: 'adxThreshold', label: 'ADX threshold', min: 10, max: 60 }, { key: 'atrLength', label: 'ATR length', min: 2, max: 50 },
  { key: 'deltaLength', label: 'Delta EMA length', min: 1, max: 50 }, { key: 'swingLookback', label: 'Swing lookback', min: 2, max: 100 },
  { key: 'volumeMultiplier', label: 'Volume multiplier', min: 0.5, max: 5, step: 0.1 }, { key: 'atrMultiplier', label: 'ATR stop buffer', min: 0.5, max: 5, step: 0.1 },
  { key: 'minConfluenceScore', label: 'Minimum score / 7', min: 1, max: 7 }, { key: 'rrRatio', label: 'Reward / risk', min: 0.5, max: 10, step: 0.1 },
  { key: 'riskPct', label: 'Risk per trade (%)', min: 0.1, max: 10, step: 0.1 }, { key: 'cooldownBars', label: 'Cooldown bars', min: 0, max: 100 },
]

export default function ScreenerPage() {
  const [config, setConfig] = useState<StrategyConfig>(CLIENT_DEFAULTS)
  const [symbols, setSymbols] = useState('')
  const [timeframe, setTimeframe] = useState('15m')
  const [mode, setMode] = useState<'signals' | 'paper'>('signals')
  const [lastScan, setLastScan] = useState<string | null>(null), [scanError, setScanError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!DEMO), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null), [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [monitorError, setMonitorError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [deliveries, setDeliveries] = useState<Delivery[]>([]), [scans, setScans] = useState<Scan[]>([])
  const [token, setToken] = useState(''), [tokenExists, setTokenExists] = useState(false), [url, setUrl] = useState('')
  const watchlist = Array.from(new Set(symbols.toUpperCase().split(/[\s,]+/).filter(Boolean)))

  useEffect(() => {
    if (DEMO) return
    const controller = new AbortController()
    fetch('/api/settings', { signal: controller.signal, cache: 'no-store' }).then(async r => {
      const json = await r.json()
      if (!r.ok) throw new Error(json.error ?? 'Settings unavailable')
      setConfig(configFromSettings(json.data)); setSymbols((json.data.screener_symbols ?? []).join(', '))
      setTimeframe(json.data.screener_timeframe ?? '15m'); setMode(json.data.signal_delivery_mode ?? 'signals')
      setLastScan(json.data.paper_last_scan_at ?? null); setScanError(json.data.paper_scan_error ?? null)
      setTokenExists(!!json.data.delivery_token_hash)
      setUrl(`${window.location.origin}/api/webhook/tradingview?uid=${json.data.user_id}`)
      setSavedAt(json.data.updated_at ?? null)
      setLoading(false)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (DEMO || loading) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const r = await fetch('/api/screener', { signal: controller.signal, cache: 'no-store' }), json = await r.json()
        if (!r.ok) throw new Error('Signal inbox unavailable. Apply the strategy migration and retry.')
        setDeliveries(json.data)
        const settingsResponse = await fetch('/api/settings', { signal: controller.signal, cache: 'no-store' })
        if (!settingsResponse.ok) throw new Error('Saved scan status unavailable')
        if (settingsResponse.ok) {
          const settings = await settingsResponse.json()
          setCheckedAt(new Date().toISOString()); setMonitorError('')
          setLastScan(settings.data.paper_last_scan_at ?? null); setScanError(settings.data.paper_scan_error ?? null)
        }
      } catch (e) { if (!controller.signal.aborted) setMonitorError(e instanceof Error ? e.message : 'Signal refresh failed') }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(refresh, 15000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [loading])

  function change<K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) { setConfig(c => ({ ...c, [key]: value })); setDirty(true); setScans([]) }
  function checkedConfig() {
    const parsed = StrategyConfigSchema.parse(config), problem = validateStrategy(parsed)
    if (problem) throw new Error(problem)
    return parsed
  }
  async function save() {
    setError(''); setMessage(''); setBusy(true)
    try {
      const parsed = checkedConfig()
      if (watchlist.length > 50 || watchlist.some(s => !/^[A-Z0-9_&.:-]{2,50}$/.test(s))) throw new Error('Enter up to 50 exchange-prefixed symbols, separated by commas.')
      if (!DEMO) {
        const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...configToSettings(parsed), screener_symbols: watchlist, screener_timeframe: timeframe, signal_delivery_mode: mode }) })
        const json = await r.json(); if (!r.ok) throw new Error(json.error ?? 'Save failed')
        setSavedAt(json.data.updated_at ?? null)
      }
      setDirty(false); setMessage(DEMO ? 'Demo configuration kept for this page session.' : 'Strategy saved. Re-export and recreate TradingView alerts when settings change.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid configuration') }
    finally { setBusy(false) }
  }
  function download(kind: 'strategy' | 'indicator') {
    setError('')
    try {
      const content = generatePine(checkedConfig(), kind)
      const objectUrl = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
      const a = document.createElement('a'); a.href = objectUrl; a.download = `autotradex-${kind}.pine`; a.click()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      setMessage('Pine file exported from the visible parameters. No token is included in the file.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed') }
  }
  async function createToken() {
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/strategy/token', { method: 'POST' }), json = await r.json()
      if (!r.ok) throw new Error(json.error ?? 'Token creation failed')
      setToken(json.data.token); setTokenExists(true)
      setMessage('Token shown once. Set it in your private TradingView script inputs and recreate the alert. Older tokens are invalid.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Token creation failed') }
    finally { setBusy(false) }
  }
  async function scan() {
    setBusy(true); setError(''); setScans([])
    try {
      const r = await fetch('/api/screener', { method: 'POST' }), json = await r.json()
      if (!r.ok) throw new Error(json.error ?? 'Scan failed')
      setScans(json.data); setMessage(json.message)
    } catch (e) { setError(e instanceof Error ? e.message : 'Scan failed') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="rounded-xl border border-border p-6"><p>{error || 'Loading saved strategy…'}</p>{error && <button className="mt-2 underline" onClick={() => window.location.reload()}>Retry loading strategy</button>}</div>
  return <div className="mx-auto flex max-w-6xl flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-blue-500">AutotradeX PRO · v1.0</p><h1 className="mt-1 text-2xl font-bold">Strategy & Screener</h1><p className="mt-2 text-sm text-muted-foreground">Configure the client strategy, export Pine, and follow signals across your watchlist.</p></div>
      <button disabled={busy || loading} onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? 'Working…' : 'Save strategy'}{dirty ? ' *' : ''}</button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm">{message}</p>}
    <p className="text-xs text-muted-foreground">{dirty ? 'Unsaved form changes' : 'Saved strategy loaded'} · Last saved: {savedAt ? new Date(savedAt).toLocaleString() : 'Not recorded'}. Form changes apply after saving.</p>
    <p className="text-xs text-muted-foreground">Inbox and scan status last checked: {checkedAt ? new Date(checkedAt).toLocaleString() : 'Not loaded'}. Monitoring refreshes every 15 seconds.</p>
    {monitorError && <p role="alert" className="text-sm text-amber-600">{monitorError}. Previously loaded monitoring data may be stale.</p>}
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Client strategy parameters</h2><button disabled={loading || busy} className="text-sm text-blue-500" onClick={() => { setConfig(CLIENT_DEFAULTS); setDirty(true); setScans([]) }}>Load client defaults</button></div>
      <p className="mb-5 mt-2 text-sm text-muted-foreground">Seven factors. ADX and ATR volatility are entry gates. Disabled factors add no points. Changes also update Strategy Settings when saved.</p>
      <fieldset disabled={loading || busy} className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {numericFields.map(f => <label key={f.key} className="text-xs text-muted-foreground">{f.label}<input aria-label={f.label} className={`${fieldClass} mt-1 text-foreground`} type="number" min={f.min} max={f.max} step={f.step ?? 1} value={Number(config[f.key])} onChange={e => change(f.key, e.target.valueAsNumber)} /></label>)}
        <label className="text-xs text-muted-foreground">HTF timeframe<select className={`${fieldClass} mt-1`} value={config.htfTimeframe} onChange={e => change('htfTimeframe', e.target.value as StrategyConfig['htfTimeframe'])}>{['1H', '2H', '4H', '1D', '1W'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="text-xs text-muted-foreground">Session timezone<select className={`${fieldClass} mt-1`} value={config.sessionTimezone} onChange={e => change('sessionTimezone', e.target.value as StrategyConfig['sessionTimezone'])}>{['Asia/Kolkata', 'Etc/UTC', 'America/New_York', 'Europe/London'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="text-xs text-muted-foreground">Session start<input className={`${fieldClass} mt-1`} type="time" value={config.sessionStart} onChange={e => change('sessionStart', e.target.value)} /></label>
        <label className="text-xs text-muted-foreground">Session end<input className={`${fieldClass} mt-1`} type="time" value={config.sessionEnd} onChange={e => change('sessionEnd', e.target.value)} /></label>
      </fieldset>
      <div className="mt-5 flex flex-wrap gap-6">{(['vwapEnabled', 'deltaEnabled', 'fvgEnabled', 'obEnabled'] as const).map((key, i) => <label className="flex items-center gap-2 text-sm" key={key}><input type="checkbox" disabled={loading || busy} checked={config[key]} onChange={e => change(key, e.target.checked)} />{['VWAP', 'Delta proxy', 'FVG', 'Order block'][i]}</label>)}</div>
    </section>
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">Watchlist & delivery</h2>
      <label className="mt-4 block text-sm">Execution symbols<textarea aria-label="Watchlist symbols" disabled={loading || busy} className={`${fieldClass} mt-2 min-h-20 font-mono`} placeholder="NSE:RELIANCE-EQ, OANDA:EURUSD, BINANCE:BTCUSDT" value={symbols} onChange={e => { setSymbols(e.target.value); setDirty(true); setScans([]) }} /></label>
      <p className="mt-2 text-xs text-muted-foreground">Match the Pine execution-symbol override exactly. Paper simulation supports NSE/BSE cash symbols ending in -EQ, six-letter OANDA forex pairs such as OANDA:EURUSD, and Binance USDT pairs. Quantities are simulated quote-priced units, not MT5 lots. Real MT5 execution still requires its terminal bridge.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm">Chart / scan timeframe<select disabled={loading || busy} className={`${fieldClass} mt-1`} value={timeframe} onChange={e => { setTimeframe(e.target.value); setDirty(true); setScans([]) }}>{['1m', '5m', '15m', '1h'].map(tf => <option key={tf}>{tf}</option>)}</select></label>
        <label className="text-sm">Incoming alert action<select disabled={loading || busy} className={`${fieldClass} mt-1`} value={mode} onChange={e => { setMode(e.target.value as 'signals' | 'paper'); setDirty(true) }}><option value="signals">Broker signals (manual or automatic execution)</option><option value="paper">Paper signals (requires Paper Trading to be ON)</option></select></label>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">Saving this page does not start trading. Use <Link href="/backtest" className="underline">Paper Trading</Link> for simulated Start/Stop controls and its own Binance watchlist. Use the <Link href="/" className="underline">Live Dashboard</Link> to start or stop broker trading.</p>
    </section>
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">Install on TradingView</h2>
      <ol className="my-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground"><li>Save your settings, then download a Pine strategy for Strategy Tester or the indicator for Pine Screener.</li><li>Paste it into TradingView’s Pine Editor, save, compile, and add it to a chart. Select your configured timeframe and adjust quantity step for the instrument.</li><li>For Pine Screener, favorite the indicator and filter its Signal column for 1 (long) or -1 (short). A screener scan itself does not create webhook alerts.</li><li>For delivery, create a private token below, enter it in the chart script inputs, and create an alert using alert() function calls only. Set the webhook URL below and keep “Send candles for automatic paper exits” enabled. One BAR message arrives at each confirmed candle close, with any new entry nested inside it. Recreate alerts after changing inputs.</li></ol>
      <div className="flex flex-wrap gap-3"><button disabled={loading} onClick={() => download('strategy')} className="rounded-md border border-border px-3 py-2 text-sm">Download Pine strategy</button><button disabled={loading} onClick={() => download('indicator')} className="rounded-md border border-border px-3 py-2 text-sm">Download screener indicator</button><a href="https://www.tradingview.com/pine-screener/" target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-2 text-sm">Open TradingView Pine Screener ↗</a></div>
      <div className="mt-5 grid gap-3"><label className="text-xs text-muted-foreground">TradingView webhook URL<input readOnly className={`${fieldClass} mt-1 font-mono`} value={DEMO ? 'Available after signing in outside demo mode' : url} /></label><div><button disabled={DEMO || loading || busy || dirty} onClick={createToken} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">{tokenExists ? 'Rotate delivery token' : 'Create delivery token'}</button><p className="mt-1 text-xs text-muted-foreground">Rotation invalidates the previous token. Keep this token private; it can submit signals for this account’s allowlisted symbols.</p></div>{token && <label className="text-xs">New token (shown once)<input readOnly type="password" aria-label="New delivery token" className={`${fieldClass} mt-1 font-mono`} value={token} /><button className="mt-2 text-sm underline" onClick={async () => { try { await navigator.clipboard.writeText(token); setMessage('Delivery token copied.') } catch { setError('Copy failed. Select the token field and copy manually.') } }}>Copy token</button></label>}</div>
      <p className="mt-4 text-xs text-muted-foreground">Keep candle alerts active for existing paper positions even after changing the watchlist, delivery mode, or kill switch. Those changes stop new entries; existing positions still need candles for exits. Recreate those alerts if you rotate the token.</p>
      <p className="mt-4 text-xs text-muted-foreground">The delivery worker must be scheduled by the deployment operator. QUEUED means received, not executed. Pine compilation and broker acceptance still require testing in their platforms.</p>
    </section>
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="font-semibold">Watchlist signals</h2><p className="mt-1 text-xs text-muted-foreground">Latest received alert per symbol. Alerts older than five minutes are historical.</p></div><button disabled={DEMO || loading || busy || dirty} onClick={scan} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Analyze Binance spot candles</button></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-border bg-muted/30 text-xs text-muted-foreground"><tr>{['Symbol', 'Last setup', 'Score', 'Entry / SL / TP', 'Delivery', 'Signal time'].map(x => <th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody>{watchlist.map(symbol => {
        const delivery = deliveries.find(d => entryPayload(d)?.symbol === symbol && ['LONG', 'SHORT'].includes(entryPayload(d)?.action ?? '')), p = delivery ? entryPayload(delivery) : null
        const stale = !!p?.timestamp && Date.now() - Date.parse(p.timestamp) > 300000
        return <tr className="border-b border-border" key={symbol}><td className="px-4 py-4 font-mono">{symbol}</td><td className="px-4 py-4">{p?.action ?? 'No alert received'}{stale ? ' (historical)' : ''}</td><td className="px-4 py-4">{p?.confluence != null ? `${p.confluence}/7` : '—'}</td><td className="px-4 py-4 font-mono text-xs">{p ? `${p.price ?? '—'} / ${p.sl ?? '—'} / ${p.tp ?? '—'}` : '—'}</td><td className="px-4 py-4 text-xs">{delivery ? delivery.result?.reason ?? delivery.result?.error ?? delivery.result?.status ?? delivery.status : 'Waiting for TradingView'}</td><td className="whitespace-nowrap px-4 py-4 text-xs">{p?.timestamp ? new Date(p.timestamp).toLocaleString() : '—'}</td></tr>
      })}</tbody></table></div>{!watchlist.length && <p className="p-8 text-center text-sm text-muted-foreground">Add symbols to start your watchlist.</p>}
      {scans.length > 0 && <div className="space-y-3 border-t border-border p-5"><h3 className="text-sm font-semibold">Binance closed-candle analysis</h3>{scans.map(s => <div key={s.symbol} className="rounded-lg bg-muted/30 p-3 text-sm"><strong>{s.symbol}</strong> — {s.error ?? (s.snapshot?.qualified ? `${s.snapshot.direction} setup` : s.snapshot?.reasons.join(', '))}{s.snapshot && <p className="mt-1 text-xs text-muted-foreground">Long {s.snapshot.longScore}/7 · Short {s.snapshot.shortScore}/7 · ADX {s.snapshot.adx?.toFixed(2) ?? 'unavailable'} · {new Date(s.snapshot.time).toLocaleString()}</p>}</div>)}</div>}
    </section>
  </div>
}
