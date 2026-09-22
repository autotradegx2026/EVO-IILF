'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Play, Settings2, BarChart2, TrendingUp, TrendingDown, Shield, Filter, ChevronDown, ChevronUp } from 'lucide-react'

import type { BacktestResult } from '@/lib/trading/backtest'

type EngineForm = {
  symbol: string; interval: string; limit: number
  fastEmaLength: number; trendEmaLength: number; htfEmaLength: number; htfTimeframe: string
  adxThreshold: number; volumeMultiplier: number; atrMultiplier: number; minConfluenceScore: number
  vwapEnabled: boolean; deltaEnabled: boolean; fvgEnabled: boolean; obEnabled: boolean
  riskPct: number; rrRatio: number; maxTradesPerDay: number; maxDailyLossPct: number; cooldownBars: number
  sessionStart: string; sessionEnd: string
}

const DEFAULT_FORM: EngineForm = {
  symbol: 'BTCUSDT', interval: '15m', limit: 1000,
  fastEmaLength: 20, trendEmaLength: 200, htfEmaLength: 50, htfTimeframe: '1H',
  adxThreshold: 20, volumeMultiplier: 1.5, atrMultiplier: 1.5, minConfluenceScore: 5,
  vwapEnabled: true, deltaEnabled: true, fvgEnabled: true, obEnabled: true,
  riskPct: 1, rrRatio: 3, maxTradesPerDay: 3, maxDailyLossPct: 3, cooldownBars: 10,
  sessionStart: '09:30', sessionEnd: '15:30'
}

const STORAGE_KEY = 'evo_backtest_engine_v3'

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div 
        onClick={() => onChange(!checked)} 
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}
      >
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </label>
  )
}

export function LocalBacktester() {
  const [isOpen, setIsOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<EngineForm>(DEFAULT_FORM)
  const [showFilters, setShowFilters] = useState(false)

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.form) setForm(parsed.form)
        if (parsed.result) setResult(parsed.result)
        if (parsed.isOpen) setIsOpen(true)
      }
    } catch {}
  }, [])

  // Persist state to localStorage
  const persist = useCallback((f: EngineForm, r: BacktestResult | null, open: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ form: f, result: r, isOpen: open }))
    } catch {}
  }, [])

  const updateForm = (key: keyof EngineForm, value: any) => {
    const next = { ...form, [key]: value }
    setForm(next)
    persist(next, result, isOpen)
  }

  async function handleStart() {
    setIsRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Backtest failed')
      setResult(data)
      persist(form, data, true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsRunning(false)
    }
  }

  function handleClear() {
    setResult(null)
    persist(form, null, isOpen)
  }

  const toggleOpen = () => {
    const next = !isOpen
    setIsOpen(next)
    persist(form, result, next)
  }

  const s = result?.summary
  const a = result?.analysis

  return (
    <div className="flex flex-col gap-4">
      {/* Strategy Engine Card */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-3 cursor-pointer select-none flex flex-row items-center justify-between" onClick={toggleOpen}>
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              Historical strategy backtest
            </CardTitle>
            <CardDescription>Run a one-time simulation over historical candles. Results are saved in this browser; this does not start automatic paper trading.</CardDescription>
          </div>
          <Button variant="ghost" size="sm">{isOpen ? 'Collapse' : 'Expand'}</Button>
        </CardHeader>

        {isOpen && (
          <CardContent className="space-y-5 border-t border-primary/7 pt-4">
            {/* ─── Section: Data Source ─── */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Data Source</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Symbol" value={form.symbol} onChange={v => updateForm('symbol', v)} placeholder="BTCUSDT" />
                <Field label="Interval" value={form.interval} onChange={v => updateForm('interval', v)} placeholder="15m" />
                <Field label="Candles" type="number" value={form.limit} onChange={v => updateForm('limit', Number(v))} />
              </div>
            </div>

            {/* ─── Section: EMA Parameters ─── */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">EMA Parameters</div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Field label="Fast EMA" type="number" value={form.fastEmaLength} onChange={v => updateForm('fastEmaLength', Number(v))} />
                <Field label="Trend EMA" type="number" value={form.trendEmaLength} onChange={v => updateForm('trendEmaLength', Number(v))} />
                <Field label="HTF EMA" type="number" value={form.htfEmaLength} onChange={v => updateForm('htfEmaLength', Number(v))} />
                <Field label="HTF Timeframe" value={form.htfTimeframe} onChange={v => updateForm('htfTimeframe', v)} placeholder="4H" />
              </div>
            </div>

            {/* ─── Section: Signal Filters ─── */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Signal Filters</div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Field label="ADX Threshold" type="number" value={form.adxThreshold} onChange={v => updateForm('adxThreshold', Number(v))} />
                <Field label="Volume Multiplier" type="number" value={form.volumeMultiplier} onChange={v => updateForm('volumeMultiplier', Number(v))} step="0.1" />
                <Field label="ATR Multiplier" type="number" value={form.atrMultiplier} onChange={v => updateForm('atrMultiplier', Number(v))} step="0.1" />
                <Field label="Min Confluence" type="number" value={form.minConfluenceScore} onChange={v => updateForm('minConfluenceScore', Number(v))} />
              </div>
            </div>

            {/* ─── Section: Confluence Factors ─── */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Confluence Factors</div>
              <div className="flex flex-wrap gap-5">
                <Toggle label="VWAP Filter" checked={form.vwapEnabled} onChange={v => updateForm('vwapEnabled', v)} />
                <Toggle label="Delta Filter" checked={form.deltaEnabled} onChange={v => updateForm('deltaEnabled', v)} />
                <Toggle label="Fair Value Gap (FVG)" checked={form.fvgEnabled} onChange={v => updateForm('fvgEnabled', v)} />
                <Toggle label="Order Block (OB)" checked={form.obEnabled} onChange={v => updateForm('obEnabled', v)} />
              </div>
            </div>

            {/* ─── Section: Risk Management ─── */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Risk Management</div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Field label="Risk %" type="number" value={form.riskPct} onChange={v => updateForm('riskPct', Number(v))} step="0.1" />
                <Field label="RR Ratio" type="number" value={form.rrRatio} onChange={v => updateForm('rrRatio', Number(v))} step="0.1" />
                <Field label="Max Trades/Day" type="number" value={form.maxTradesPerDay} onChange={v => updateForm('maxTradesPerDay', Number(v))} />
                <Field label="Max Daily Loss %" type="number" value={form.maxDailyLossPct} onChange={v => updateForm('maxDailyLossPct', Number(v))} step="0.1" />
                <Field label="Cooldown Bars" type="number" value={form.cooldownBars} onChange={v => updateForm('cooldownBars', Number(v))} />
              </div>
            </div>

            {/* ─── Section: Trading Session ─── */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Trading Session (Asia/Kolkata)</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Session Start (Asia/Kolkata)" value={form.sessionStart} onChange={v => updateForm('sessionStart', v)} placeholder="09:30" />
                <Field label="Session End (Asia/Kolkata)" value={form.sessionEnd} onChange={v => updateForm('sessionEnd', v)} placeholder="15:30" />
              </div>
            </div>

            {/* ─── Controls ─── */}
            <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
              <Button onClick={handleStart} disabled={isRunning} className="gap-2 h-9">
                <Play className="w-4 h-4" /> {isRunning ? 'Running backtest…' : result ? 'Run backtest again' : 'Run historical backtest'}
              </Button>
              {result && <Button onClick={handleClear} disabled={isRunning} variant="outline" className="h-9">Clear backtest results</Button>}
              <Link href="/screener" className="self-center text-sm underline">Configure automatic paper trading</Link>
            </div>
          </CardContent>
        )}
      </Card>

      {error && (
        <div className="bg-destructive/7 border border-destructive/20 text-destructive text-sm p-3 rounded-md">
          {error}
        </div>
      )}

      {/* ─── Results Display ─── */}
      {result && s && a && (
        <div className="flex flex-col gap-4">

          <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
            <p>{a.dataSource} · Historical result stored in this browser</p>
            <p className="mt-1">Run started: {result.run ? new Date(result.run.startedAt).toLocaleString() : 'Not recorded for this saved result'} · Finished: {result.run ? new Date(result.run.finishedAt).toLocaleString() : 'Not recorded'}</p>
            {a.market && <p className="mt-1">{a.market.symbol} · {a.market.interval} · {a.market.candles} candles · {new Date(a.market.from).toLocaleString()} to {new Date(a.market.through).toLocaleString()}</p>}
            {a.warnings.map(warning => <p key={warning} className="mt-1">{warning}</p>)}
          </div>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Stat label="Total Trades" value={s.totalTrades} />
            <Stat label="Win Rate" value={s.totalTrades ? `${s.winRate.toFixed(1)}%` : 'No data yet'} color={!s.totalTrades ? undefined : s.winRate > 50 ? 'green' : 'red'} />
            <Stat label="Profit Factor" value={!s.totalTrades ? 'No data yet' : s.profitFactor === null ? 'No losses' : `${s.profitFactor.toFixed(2)}x`} color={!s.totalTrades ? undefined : (s.profitFactor ?? Infinity) > 1.2 ? 'green' : 'red'} />
            <Stat label="Net PnL" value={s.totalTrades ? `${s.netPnL.toFixed(2)} quote units` : 'No data yet'} color={s.netPnL >= 0 ? 'green' : 'red'} />
            <Stat label="Max Drawdown" value={s.totalTrades ? `${s.maxDrawdown.toFixed(1)}%` : 'No data yet'} color={!s.totalTrades ? undefined : s.maxDrawdown < 10 ? 'green' : 'red'} />
            <Stat label="Avg Confluence" value={s.totalTrades ? s.avgConfluence.toFixed(1) : 'No data yet'} color={!s.totalTrades ? undefined : s.avgConfluence >= 5 ? 'green' : 'yellow'} />
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Longs" value={s.totalLongs} sub={<TrendingUp className="w-3 h-3 text-green-400" />} />
            <Stat label="Shorts" value={s.totalShorts} sub={<TrendingDown className="w-3 h-3 text-red-400" />} />
            <Stat label="Best Trade" value={s.totalTrades ? `${s.bestTrade.toFixed(2)} quote units` : 'No data yet'} color="green" />
            <Stat label="Worst Trade" value={s.totalTrades ? `${s.worstTrade.toFixed(2)} quote units` : 'No data yet'} color="red" />
            <Stat label="Signals Filtered" value={`${a.signalsFiltered}/${a.signalsGenerated}`} sub={<Filter className="w-3 h-3 text-muted-foreground" />} />
          </div>

          {/* Filter Analysis */}
          {Object.keys(a.filterReasons).length > 0 && (
            <Card className="border-border">
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowFilters(!showFilters)}>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-400" />
                  Signal Filter Breakdown — {a.signalsFiltered} of {a.signalsGenerated} signals rejected
                  {showFilters ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
                </CardTitle>
              </CardHeader>
              {showFilters && (
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(a.filterReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                      <div key={reason} className="flex justify-between items-center bg-muted/30 rounded px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground">{reason}</span>
                        <span className="font-mono font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Trades Table */}
          <Card className="border-border overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-muted-foreground" />
                Backtest Trade Log ({result.trades.length} trades)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-3 py-2.5 text-left font-medium">Entry Time</th>
                      <th className="px-3 py-2.5 text-left font-medium">Dir</th>
                      <th className="px-3 py-2.5 text-right font-medium">Entry</th>
                      <th className="px-3 py-2.5 text-right font-medium">SL</th>
                      <th className="px-3 py-2.5 text-right font-medium">TP</th>
                      <th className="px-3 py-2.5 text-right font-medium">Exit</th>
                      <th className="px-3 py-2.5 text-right font-medium">PnL (quote units)</th>
                      <th className="px-3 py-2.5 text-center font-medium">Score</th>
                      <th className="px-3 py-2.5 text-left font-medium">Factors</th>
                      <th className="px-3 py-2.5 text-center font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-accent/20">
                        <td className="px-3 py-2 font-mono text-[11px]">{new Date(t.entryTime).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${t.direction === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {t.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{t.entryPrice.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-red-400">{t.sl.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-green-400">{t.tp.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{t.exitPrice.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-mono text-[11px] font-bold ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.confluenceScore >= 5 ? 'bg-green-500/20 text-green-400' : t.confluenceScore >= 3 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                            {t.confluenceScore}/7
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[10px] text-muted-foreground max-w-[180px] truncate" title={t.confluenceFactors.join(', ')}>
                          {t.confluenceFactors.join(', ')}
                        </td>
                        <td className="px-3 py-2 text-center text-[10px] font-bold">
                          {t.reason === 'END_OF_DATA' ? <span>End of data</span> : t.reason === 'TP' ? <span className="text-green-500">✓ TP</span> : <span className="text-red-500">✗ SL</span>}
                        </td>
                      </tr>
                    ))}
                    {result.trades.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                          No trades generated. Try lowering the Min Confluence Score, ADX Threshold, or adjusting EMA lengths.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// ─── Helper Components ───────────────────────────────────────

function Field({ label, value, onChange, type = 'text', placeholder, step }: {
  label: string; value: string | number; onChange: (v: string) => void
  type?: string; placeholder?: string; step?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</Label>
      <Input
        type={type} value={value} step={step} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-xs bg-background"
      />
    </div>
  )
}

function Stat({ label, value, color, sub }: {
  label: string; value: string | number; color?: 'green' | 'red' | 'yellow'; sub?: React.ReactNode
}) {
  const colorClass = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : color === 'yellow' ? 'text-yellow-400' : ''
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">{label} {sub}</div>
      <div className={`text-lg font-bold ${colorClass}`}>{value}</div>
    </div>
  )
}
