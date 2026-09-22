'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { PaperAnalysisHistory } from '@/components/dashboard/paper-analysis-history'
import type { PaperTrade, PaperObservation } from '@/types/database'
import Link from 'next/link'
import { useActiveChart } from '@/hooks/use-active-chart'
import { ChartSelector } from '@/components/dashboard/chart-selector'
import { PaperControls } from '@/components/dashboard/paper-controls'
import { WebhookStatus } from '@/components/dashboard/webhook-status'
import { LocalBacktester } from '@/components/dashboard/local-backtester'
import { StrategyChart } from '@/components/dashboard/strategy-chart'
import { createClient } from '@/lib/supabase/client'
import { paperAutomationStatus, type PaperConfiguration, type PaperWorkerHealth } from '@/lib/paper/status'

const PNL_COLOR = (pnl: number) =>
  pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-muted-foreground'

function fmt(iso: string | null) {
  if (!iso) return 'Not recorded'
  if (!Number.isFinite(Date.parse(iso))) return 'Time unavailable'
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export default function BacktestPage() {
  const { activeChart, setActiveChart, isLoaded } = useActiveChart('paper')
  const [userId, setUserId]         = useState<string | undefined>()
  const [trades, setTrades]         = useState<PaperTrade[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [success, setSuccess]       = useState<string | null>(null)
  const [closeModal, setCloseModal] = useState<{ id: string; symbol: string } | null>(null)
  const [closePrice, setClosePrice] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [automation, setAutomation] = useState<PaperWorkerHealth | null>(null)
  const [configuration, setConfiguration] = useState<PaperConfiguration | null>(null)
  const [analysisHistory,setAnalysisHistory]=useState<PaperObservation[]|null>(null),[analysisHistoryCount,setAnalysisHistoryCount]=useState<number|null>(null)
  const [observations, setObservations] = useState<PaperObservation[] | null>(null)
  const [now, setNow] = useState(Date.now())
  const refreshPending = useRef(false), refreshRevision = useRef(0)
  const currencies = useMemo(() => Array.from(new Set([...trades.map(t => t.currency), ...(configuration?.paper_auto_scan ? configuration.paper_symbols ?? [] : configuration?.screener_symbols ?? []).flatMap(s => s.startsWith('BINANCE:') && s.endsWith('USDT') ? ['USDT'] : /^(NSE|BSE):/.test(s) ? ['INR'] : /^OANDA:[A-Z]{6}$/.test(s) ? [s.slice(-3)] : [])])).sort(), [trades, configuration])
  useEffect(() => {
    if (currencies.length && !currencies.includes(currency)) setCurrency(currencies.includes('INR') ? 'INR' : currencies[0])
  }, [currencies, currency])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUserId(data.session.user.id)
        loadTrades()
      }
    })

    const channel = supabase.channel('paper-trades-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'paper_trades' },
        (payload) => {
          loadTrades() // Reload trades when a change happens
        }
      )
      .subscribe()

    const timer = setInterval(() => { setNow(Date.now()); void loadTrades() }, 15000)
    return () => {
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [])

  async function loadTrades(force = false) {
    if (refreshPending.current && !force) return
    const revision = ++refreshRevision.current
    refreshPending.current = true
    try {
      const res = await fetch('/api/paper?limit=100', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Paper trades unavailable')
      if (!Array.isArray(json.data)) throw new Error('Paper response incomplete')
      if (revision !== refreshRevision.current) return
      setTrades(json.data ?? [])
      setTotalCount(json.count ?? null)
      setRefreshedAt(json.asOf ?? null)
      setAutomation(json.automation ?? null)
      setConfiguration(json.configuration ?? null)
      setObservations(json.observations ?? null)
      setAnalysisHistory(json.analysisHistory??null);setAnalysisHistoryCount(json.analysisHistoryCount??null)
      setError(null)
    } catch {
      if (revision !== refreshRevision.current) return
      setError('Failed to refresh paper trades and automation status')
      setAutomation(null)
      setConfiguration(null)
      setObservations(null)
      setAnalysisHistory(null)
      setAnalysisHistoryCount(null)
    } finally {
      if (revision === refreshRevision.current) { refreshPending.current = false; setLoading(false) }
    }
  }

  async function handleClose() {
    if (!closeModal) return
    const price = parseFloat(closePrice)
    if (!Number.isFinite(price) || price <= 0) { setError('Valid close price required'); return }

    try {
      const res = await fetch(`/api/paper/${closeModal.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ close_price: price, close_reason: 'MANUAL' }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message ?? 'Close failed'); return }
      setSuccess(json.message)
      setCloseModal(null)
      setClosePrice('')
      await loadTrades()
    } catch {
      setError('Network error')
    }
  }

  // Each currency remains separate; this is only the loaded historical sample.
  const visibleTrades = useMemo(() => trades.filter(t => t.currency === currency), [trades, currency])
  const closed = useMemo(() => visibleTrades.filter(t => t.status === 'CLOSED'), [visibleTrades])
  const open = useMemo(() => visibleTrades.filter(t => t.status === 'OPEN'), [visibleTrades])
  const wins   = closed.filter(t => t.pnl > 0)
  const losses = closed.filter(t => t.pnl < 0)
  const netPnL = closed.reduce((s, t) => s + t.pnl, 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const winRate  = closed.length > 0 ? (wins.length / closed.length) * 100 : 0
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const plannedRatios = closed.flatMap(t => t.rr_ratio == null ? [] : [t.rr_ratio])
  const averageRR = plannedRatios.length ? plannedRatios.reduce((sum, rr) => sum + rr, 0) / plannedRatios.length : null
  const heartbeatTime = automation?.last_finished_at ?? automation?.last_started_at
  const heartbeatStale = !heartbeatTime || !Number.isFinite(Date.parse(heartbeatTime)) || now - Date.parse(heartbeatTime) > 180000 || Date.parse(heartbeatTime) - now > 5000
  const workerHealthy = !heartbeatStale && automation?.status !== 'FAILED'
  const paperStatus = paperAutomationStatus(configuration, automation, now)
  const stat = (value: string | number) => loading ? 'Loading…' : error ? 'Unavailable' : value
  const money = (value: number) => `${currency} ${value >= 0 ? '+' : ''}${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Automated Paper Trading</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Simulated entries, automatic bracket exits, and a paper trade history. No real broker orders are placed.
          </p>
        </div>
        {isLoaded && (
          <div className="shrink-0 flex items-center gap-3">
            <ChartSelector activeChart={activeChart} setActiveChart={setActiveChart} />
          </div>
        )}
      </div>

      <PaperControls configuration={configuration} loading={loading} refresh={() => loadTrades(true)} />

      <section aria-label="Paper automation status" className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Background paper activity</h2>
          <span role="status" className={`rounded px-2 py-1 text-xs ${paperStatus.healthy ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}>
            {loading ? 'Loading automation status…' : paperStatus.label}
          </span>
        </div>
        {!loading && <p className="mt-2 text-sm">{paperStatus.detail}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Worker: {loading ? 'Checking…' : workerHealthy ? 'Heartbeat recent' : 'Unavailable, stale or failed'} · Worker run started: {fmt(automation?.last_started_at ?? null)} · Worker run finished: {fmt(automation?.last_finished_at ?? null)} · Last result: {automation?.status ?? 'Not recorded'} · Last account scan check: {fmt(configuration?.paper_last_scan_at ?? null)}</p>
        {configuration?.paper_trading_enabled && !configuration.paper_auto_scan && <div className="mt-3 border-t border-border pt-3">
          <WebhookStatus userId={userId} />
          <p className="mt-1 text-xs text-muted-foreground">Webhook delivery history is separate from the paper scanner and worker status.</p>
        </div>}
      </section>

      <section aria-label="Paper market checks" className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Latest paper market checks</h2>
        <p className="mt-1 text-sm text-muted-foreground">Actual closed candles evaluated by the Binance paper worker. A market check is not a trade. Results remain dated when trading is stopped.</p>
        {observations === null ? <p className="mt-4 text-sm text-muted-foreground">{loading ? 'Loading market checks…' : 'Market checks unavailable. Refresh to retry.'}</p> : !observations.length ? <p className="mt-4 text-sm text-muted-foreground">No market checks recorded yet. Start the Binance paper scanner to receive results.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground">{['Symbol / timeframe','Candle close / price','Score','Result / reason','Checked at'].map(t=><th key={t} className="px-3 py-2 font-medium">{t}</th>)}</tr></thead><tbody>{observations.map(o=><tr key={`${o.symbol}:${o.timeframe}`} className="border-b border-border/50"><td className="whitespace-nowrap px-3 py-3">{o.symbol} · {o.timeframe}</td><td className="whitespace-nowrap px-3 py-3">{fmt(o.bar_close)}<div className="mt-1 font-mono">{o.price == null ? 'No quote' : `${o.price.toLocaleString(undefined,{maximumFractionDigits:8})} USDT`}</div></td><td className="px-3 py-3">{o.score == null ? '—' : `${o.score}/7`}{o.analysis && <details className="mt-2 min-w-32"><summary className="cursor-pointer">Why this score?</summary><p className="mt-2">{o.analysis.direction??'Neutral'} · requires {o.analysis.minimumScore}/7</p>{Object.entries(o.analysis.factors).map(([key,passed])=><p key={key}>{key.toUpperCase()}: {passed?'Passed':'Not met'}</p>)}<p>ADX {o.analysis.adx?.toFixed(2)??'Unavailable'} · ATR {o.analysis.atr?.toFixed(2)??'Unavailable'}</p></details>}</td><td className="min-w-48 px-3 py-3"><strong>{o.status}</strong><p className="mt-1 text-muted-foreground">{o.reasons.join(' · ')}</p></td><td className="whitespace-nowrap px-3 py-3">{fmt(o.checked_at)}</td></tr>)}</tbody></table></div>}
      </section>

      <PaperAnalysisHistory rows={analysisHistory} count={analysisHistoryCount} />
      <section className="rounded-xl border border-border bg-card px-5 py-4">
        <h2 className="text-sm font-semibold">Saved strategy and risk limits</h2>
        {configuration ? <><p className="mt-2 text-sm">Planned reward/risk {configuration.rr_ratio}:1 · Risk per entry {configuration.risk_percent}% · Minimum score {configuration.min_confluence_score}/7 · Daily trade limit {configuration.max_trades_per_day} · Daily loss limit {configuration.max_daily_loss_pct}%</p><p className="mt-2 text-xs text-muted-foreground">Strategy configuration changed {fmt(configuration.execution_config_updated_at ?? null)}. These are configured entry limits; measured results appear in the cards below and Analytics.</p></> : <p className="mt-2 text-sm text-muted-foreground">{loading ? 'Loading saved settings…' : 'Saved settings unavailable.'}</p>}
      </section>

      {/* Error / success */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-400/30 bg-green-400/10 px-4 py-2 text-sm text-green-400">
          {success}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{loading ? 'Loading paper records…' : error ? 'Refresh failed. Previously loaded records may be stale.' : `${visibleTrades.length} ${currency} trades in ${trades.length} loaded records${totalCount === null ? '' : ` of ${totalCount} total`}. ${visibleTrades.filter(t => t.source === 'manual').length} manual simulations in this currency. ${totalCount === null ? 'Total history count unavailable.' : totalCount > trades.length ? 'Only the latest 100 records are shown; Analytics includes the full history.' : 'All currently saved records are loaded.'}`} · Data checked: {fmt(refreshedAt)}</p>
        <label className="flex items-center gap-2 text-sm">Paper currency<select aria-label="Paper currency" className="rounded-md border border-border bg-background px-3 py-2" value={currency} onChange={e => setCurrency(e.target.value)}>{(currencies.length ? currencies : ['INR']).map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Paper Trades', value: visibleTrades.length, sub: `${open.length} open` },
          { label: 'Win Rate',     value: closed.length ? `${winRate.toFixed(1)}%` : 'No data yet', sub: `${wins.length}W / ${losses.length}L`, color: closed.length > 0 && winRate > 50 ? 'text-green-400' : '' },
          { label: 'Profit Factor', value: !closed.length ? 'No data yet' : profitFactor === Infinity ? 'No losses' : grossLoss === 0 ? 'No gains or losses' : profitFactor.toFixed(2), sub: closed.length > 0 ? 'closed trades' : '—', color: profitFactor >= 1.5 ? 'text-green-400' : '' },
          { label: 'Realized paper PnL', value: closed.length ? money(netPnL) : 'No data yet', sub: 'loaded closed trades', color: PNL_COLOR(netPnL) },
          { label: 'Average planned R/R', value: averageRR == null ? 'No data yet' : `${averageRR.toFixed(2)}:1`, sub: 'loaded closed trades' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground mb-1">{s.label}</div>
            <div className={`text-xl font-bold ${s.color ?? ''}`}>{stat(s.value)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{loading || error ? 'Awaiting current records' : s.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold">Paper Trade Logs</h2>
        <p className="text-sm text-muted-foreground">Saved paper simulations from your account. These records do not represent real-money broker orders.</p>
      </div>

      {/* Trades table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="text-muted-foreground text-sm">Loading…</div>
        </div>
      ) : visibleTrades.length === 0 ? (
        <div className="flex items-center justify-center h-32 rounded-xl border border-dashed border-border">
          <div className="px-4 text-center text-sm text-muted-foreground">{error ? 'Paper records are unavailable until the request succeeds.' : <>No paper trades in this currency. {configuration?.paper_trading_enabled ? configuration.paper_auto_scan ? 'Paper trading is on. See market checks above for qualification results.' : 'Paper trading is on. Waiting for qualifying TradingView alerts.' : 'Use Start paper trading above to begin evaluating market candles.'}</>}</div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Symbol</th>
                  <th className="px-4 py-3 text-left font-medium">Dir</th>
                  <th className="px-4 py-3 text-right font-medium">Entry</th>
                  <th className="px-4 py-3 text-right font-medium">SL</th>
                  <th className="px-4 py-3 text-right font-medium">TP</th>
                  <th className="px-4 py-3 text-right font-medium">Close</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">PnL</th>
                  <th className="px-4 py-3 text-right font-medium">PnL%</th>
                  <th className="px-4 py-3 text-center font-medium">Score</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Opened</th>
                  <th className="px-4 py-3 text-left font-medium">Monitoring</th>
                  <th className="px-4 py-3 text-center font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrades.map(t => (
                  <tr key={t.id} className="border-b border-border/50 hover:bg-accent/20">
                    <td className="px-4 py-3 font-medium">{t.symbol}<span className="mt-1 block text-[10px] text-muted-foreground">{t.source === 'manual' ? 'Manual simulation' : `${t.source} simulation`} · {t.timeframe}</span></td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${t.direction === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {t.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{t.entry_price.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-red-400">{t.stop_loss.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-green-400">{t.take_profit.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {t.close_price ? t.close_price.toLocaleString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">{t.quantity}</td>
                    <td className={`px-4 py-3 text-right font-semibold text-xs ${PNL_COLOR(t.status === 'OPEN' ? t.unrealized_pnl : t.pnl)}`}>
                      {money(t.status === 'OPEN' ? t.unrealized_pnl : t.pnl)}{t.status === 'OPEN' && <span className="block text-[10px] text-muted-foreground">unrealized</span>}
                    </td>
                    <td className={`px-4 py-3 text-right text-xs ${PNL_COLOR(t.pnl_percent)}`}>
                      {t.status === 'OPEN' ? '—' : `${t.pnl_percent >= 0 ? '+' : ''}${t.pnl_percent.toFixed(2)}%`}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.confluence_score ?? '—'}/7</span>
                    </td>
                    <td className="px-4 py-3">
                      {t.status === 'OPEN' ? (
                        <span className="rounded border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">OPEN</span>
                      ) : (
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${t.pnl >= 0 ? 'border-green-500/30 bg-green-500/20 text-green-400' : 'border-red-500/30 bg-red-500/20 text-red-400'}`}>
                          {t.close_reason ?? 'CLOSED'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(t.opened_at)}</td>
                    <td className="min-w-48 px-4 py-3 text-xs">
                      {t.status === 'OPEN' ? <><div>Mark: {t.current_price == null ? 'Waiting' : t.current_price.toLocaleString('en-IN', { maximumFractionDigits: 6 })} {t.currency}</div><div className="mt-1 text-muted-foreground">Candle: {fmt(t.last_bar_at)}</div><div className="text-muted-foreground">Checked: {fmt(t.last_checked_at)}</div>{t.monitor_error && <p role="alert" className="mt-1 text-amber-600">{t.monitor_error}</p>}</> : <span className="text-muted-foreground">Closed {fmt(t.closed_at)}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.status === 'OPEN' && (
                        <button
                          onClick={() => setCloseModal({ id: t.id, symbol: t.symbol })}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-accent transition-colors"
                        >
                          Close manually
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <details className="rounded-2xl border border-border bg-card p-5"><summary className="cursor-pointer font-semibold">Chart and historical research</summary><p className="my-4 text-sm text-muted-foreground">Historical backtests are separate research runs. They do not start paper automation or create paper trade logs.</p>      <div className="w-full">
         <LocalBacktester />
      </div>

      {/* Chart with Auto-Configured Strategy Indicators */}
      <div className="h-[400px] min-h-[300px] max-h-[800px] resize-y rounded-xl border border-border overflow-hidden bg-card" style={{ paddingBottom: '2px' }}>
        {isLoaded ? (
          <StrategyChart
            symbol={activeChart}
            containerId="paper_tradingview_chart"
            scope="paper"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground animate-pulse">
            Loading Chart Engine...
          </div>
        )}
      </div>

      </details>

      {/* Close modal */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl border border-border bg-card p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold mb-4">Close Paper Trade — {closeModal.symbol}</h3>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Close Price</label>
                <input
                  aria-label="Manual close price" type="number" step="any" value={closePrice}
                  onChange={e => setClosePrice(e.target.value)}
                  autoFocus
                  className="bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <p className="text-xs text-muted-foreground">This records a manual simulated fill at your entered price. Automatic stop-loss, target, and session exits are recorded only from market candles.</p>
              <div className="flex gap-2 mt-2">
                <button onClick={handleClose}
                  className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
                  Confirm Close
                </button>
                <button onClick={() => { setCloseModal(null); setClosePrice('') }}
                  className="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
