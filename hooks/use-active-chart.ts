'use client'

import { useState, useEffect, useRef } from 'react'
import { canonicalSymbol } from '@/lib/strategy/signal-state'


const DEFAULT_CHART = 'NSE:RELIANCE'
const STORAGE_KEY = 'evo_active_chart'

export function useActiveChart(namespace: 'live' | 'paper' = 'live') {
  const storageKey = `${STORAGE_KEY}_${namespace}`
  
  const [activeChart, setActiveChartState] = useState<string>(namespace === 'paper' ? 'BINANCE:BTCUSDT' : DEFAULT_CHART)
  const [isLoaded, setIsLoaded] = useState(false)

  const manuallySelected = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    manuallySelected.current = false
    async function initialize() {
      let saved: string | null = null
      try { saved = localStorage.getItem(storageKey) } catch {}
      if (saved) setActiveChartState(saved)
      try {
        const response = await fetch('/api/settings', {cache:'no-store',signal:controller.signal})
        const json = await response.json()
        if (!response.ok || !json.data || controller.signal.aborted || manuallySelected.current) return
        const list: string[] = namespace==='paper' && json.data.paper_auto_scan ? json.data.paper_symbols ?? [] : json.data.screener_symbols ?? []
        if (list.length && (!saved || !list.includes(canonicalSymbol(saved)))) {
          setActiveChartState(list[0])
          try {localStorage.setItem(storageKey,list[0])} catch {}
        }
      } catch {} finally { if(!controller.signal.aborted)setIsLoaded(true) }
    }
    void initialize()
    return ()=>controller.abort()
  }, [storageKey,namespace])

  const setActiveChart = (symbol: string) => {
    manuallySelected.current = true
    setActiveChartState(symbol)
    try { localStorage.setItem(storageKey, symbol) } catch {}
  }

  return { activeChart, setActiveChart, isLoaded }
}
