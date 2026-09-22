'use client'

import { useState, useEffect } from 'react'
import { StrategyChart } from '@/components/dashboard/strategy-chart'
import { useSavedSettings } from '@/hooks/use-saved-settings'
import { useActiveChart } from '@/hooks/use-active-chart'
import { ChartSelector } from '@/components/dashboard/chart-selector'
import { Settings2, Activity, Info } from 'lucide-react'

export default function ChartsPage() {
  const [mounted, setMounted] = useState(false)
  const { settings, loading: settingsLoading, error, checkedAt } = useSavedSettings()
  const { activeChart: symbol, setActiveChart: setSymbol, isLoaded } = useActiveChart()
  
  useEffect(() => { setMounted(true) }, [])

  if (!mounted || !isLoaded) {
    return (
      <div className="flex items-center justify-center h-full min-h-[80vh]">
        <div className="text-muted-foreground animate-pulse">Loading Chart Engine...</div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-background xl:h-[calc(100dvh-8rem)] xl:min-h-[36rem] xl:flex-row">
      
      {/* Main Chart Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="p-4 border-b border-border bg-card shrink-0 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Advanced Charts</h1>
            <p className="text-xs text-muted-foreground">Perform technical analysis directly within AutotradeX</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ChartSelector activeChart={symbol} setActiveChart={setSymbol} />
            <span className="px-3 py-1 bg-primary/7 text-primary text-xs rounded-full font-medium">
              Strategy signals
            </span>
          </div>
        </div>
        
        <div className="relative h-[65dvh] min-h-[24rem] w-full flex-1 xl:h-auto">
          <StrategyChart
            symbol={symbol}
            containerId="main_tradingview_chart"
          />
        </div>
      </div>

      {/* Settings Reference Sidebar */}
      <div className="w-full xl:w-72 bg-card overflow-y-auto shrink-0 border-l border-border flex flex-col">
        <div className="p-4 border-b border-border sticky top-0 bg-card z-10 flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Strategy Reference</h2>
        </div>
        
        <div className="p-4 space-y-6">
          <div className="rounded-md bg-blue-500/7 border border-blue-500/30 p-3 flex gap-3">
            <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-500/90 leading-relaxed">
              The signal chart uses saved strategy inputs and completed market candles. Binance analysis runs in AutotradeX; other markets use confirmed candles and signals sent by the exported TradingView strategy. LONG/SHORT markers indicate setups; order fills remain in the execution ledger.
            </p>
          </div>

          {error && <p role="alert" className="text-xs text-amber-600">{error}</p>}
          <p className="text-xs text-muted-foreground">Saved configuration checked: {checkedAt ? new Date(checkedAt).toLocaleString() : settingsLoading ? 'Loading…' : 'Unavailable'}</p>
          {settings ? (
            <>
              {/* EMA Parameters */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Moving Averages
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm p-2 bg-background rounded border border-border">
                    <span className="text-muted-foreground">Fast EMA</span>
                    <span className="font-mono text-primary font-medium">{settings.fast_ema_length}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm p-2 bg-background rounded border border-border">
                    <span className="text-muted-foreground">Trend EMA</span>
                    <span className="font-mono text-primary font-medium">{settings.trend_ema_length}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm p-2 bg-background rounded border border-border">
                    <span className="text-muted-foreground">HTF EMA ({settings.htf_timeframe})</span>
                    <span className="font-mono text-primary font-medium">{settings.htf_ema_length}</span>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Active Filters
                </h3>
                <div className="space-y-2">
                  {settings.vwap_enabled && (
                    <div className="flex justify-between items-center text-sm p-2 bg-background rounded border border-border">
                      <span className="text-muted-foreground">VWAP</span>
                      <span className="text-green-500 font-medium">Enabled</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-sm p-2 bg-background rounded border border-border">
                    <span className="text-muted-foreground">ADX Threshold</span>
                    <span className="font-mono text-primary font-medium">{settings.adx_threshold}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm p-2 bg-background rounded border border-border">
                    <span className="text-muted-foreground">Min Confluence</span>
                    <span className="font-mono text-primary font-medium">{settings.min_confluence_score}/7</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-10">
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-muted-foreground">{settingsLoading ? 'Loading saved reference…' : 'Strategy reference unavailable'}</span>
                <div className="h-4 w-24 bg-muted rounded"></div>
                <div className="h-3 w-32 bg-muted rounded"></div>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

