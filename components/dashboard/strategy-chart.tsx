'use client'

import { useEffect, useRef, useState } from 'react'
import { StrategyAnalysis } from './strategy-analysis'
import { useSavedSettings } from '@/hooks/use-saved-settings'

type Props = {
  symbol: string
  containerId: string
  height?: string
  scope?: 'paper'|'broker'
}


type WidgetStudy = { id: string; inputs?: Record<string, number> }
type WidgetOptions = {
  container_id: string; symbol: string; interval: string; timezone: string
  theme: string; style: string; locale: string; toolbar_bg: string
  enable_publishing: boolean; hide_side_toolbar: boolean; allow_symbol_change: boolean
  save_image: boolean; details: boolean; autosize: boolean
  studies: WidgetStudy[]; overrides: Record<string, string>
}
type WidgetWindow = Window & { TradingView?: { widget: new (options: WidgetOptions) => unknown } }

function PriceContextChart({ symbol, containerId, height = '100%' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { settings, loading, error } = useSavedSettings()
  const loaded = !loading
  // Hosted chart provides price context and built-in studies, not the Pine strategy.
  useEffect(() => {
    if (!loaded || !settings || !containerRef.current) return

    // Clear previous widget
    const container = containerRef.current
    container.innerHTML = ''

    // Create widget div
    const widgetDiv = document.createElement('div')
    widgetDiv.id = containerId
    widgetDiv.style.width = '100%'
    widgetDiv.style.height = height
    container.appendChild(widgetDiv)

    // These are chart-timeframe EMAs. An HTF EMA requires a separate strategy calculation.
    const studies: WidgetStudy[] = [
      { id: "MAExp@tv-basicstudies", inputs: { length: settings.fast_ema_length } },
      { id: "MAExp@tv-basicstudies", inputs: { length: settings.trend_ema_length } },
    ]
    if (settings.vwap_enabled) {
      studies.push({ id: "VWAP@tv-basicstudies" })
    }
    studies.push({ id: "Volume@tv-basicstudies" })

    // Load TradingView script
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.async = true
    script.onload = () => {
      const tradingView = (window as WidgetWindow).TradingView
      if (tradingView && container.isConnected) {
        new tradingView.widget({
          container_id: containerId,
          symbol: /^(NSE|BSE):/.test(symbol) ? symbol.replace(/-EQ$/, '') : symbol,
          interval: ({ '1m': '1', '5m': '5', '15m': '15', '1h': '60' } as Record<string, string>)[settings.screener_timeframe ?? '15m'] ?? '15',
          timezone: settings.session_timezone ?? 'Asia/Kolkata',
          theme: 'light',
          style: '1',
          locale: 'en',
          toolbar_bg: '#ffffff',
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          save_image: false,
          details: true,
          autosize: true,
          studies: studies,
          overrides: {
            "mainSeriesProperties.candleStyle.upColor": "#22c55e",
            "mainSeriesProperties.candleStyle.downColor": "#ef4444",
            "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
            "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
          },
        })
      }
    }
    document.head.appendChild(script)

    return () => {
      // Cleanup
      try { document.head.removeChild(script) } catch {}
    }
  }, [loaded, symbol, containerId, height, settings, error])

  if (error) return <p role="alert" className="p-4 text-sm text-muted-foreground">{error}</p>

  if (!loaded) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground animate-pulse">
        Loading price chart...
      </div>
    )
  }

  return (
    <div className="flex flex-col w-full h-full">
      <p className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
        Price context · Built-in EMA and VWAP studies. Configure study lengths in the chart; AutotradeX signals come from the strategy engine.
      </p>
      <div ref={containerRef} className="w-full flex-1 min-h-0">
        <div className="w-full h-full flex items-center justify-center text-muted-foreground animate-pulse">
          Initializing price chart...
        </div>
      </div>
    </div>
  )
}

export function StrategyChart({symbol,containerId,height,scope='broker'}:Props) {
  const [context,setContext]=useState(false)
  return <div className="h-full w-full overflow-y-auto p-3"><StrategyAnalysis symbol={symbol} scope={scope}/><details className="mt-3 rounded-xl border border-border bg-card p-3" onToggle={event=>setContext(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">TradingView price context and drawing tools</summary>{context && <div className="mt-3 h-[450px]"><PriceContextChart symbol={symbol} containerId={containerId} height={height}/></div>}</details></div>
}
