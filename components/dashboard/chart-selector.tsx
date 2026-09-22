'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, ChevronDown, Check } from 'lucide-react'

const SUGGESTIONS = [
  { label: 'NIFTY 50', value: 'NSE:NIFTY', group: 'Indian Markets' },
  { label: 'BANKNIFTY', value: 'NSE:BANKNIFTY', group: 'Indian Markets' },
  { label: 'SENSEX', value: 'BSE:SENSEX', group: 'Indian Markets' },
  { label: 'RELIANCE', value: 'NSE:RELIANCE', group: 'Indian Markets' },
  { label: 'HDFCBANK', value: 'NSE:HDFCBANK', group: 'Indian Markets' },
  { label: 'INFY', value: 'NSE:INFY', group: 'Indian Markets' },
  { label: 'EUR/USD', value: 'OANDA:EURUSD', group: 'Forex' },
  { label: 'GBP/USD', value: 'OANDA:GBPUSD', group: 'Forex' },
  { label: 'USD/JPY', value: 'OANDA:USDJPY', group: 'Forex' },
  { label: 'XAU/USD (Gold)', value: 'TVC:GOLD', group: 'Commodities' },
  { label: 'US Oil (WTI)', value: 'TVC:USOIL', group: 'Commodities' },
  { label: 'Bitcoin', value: 'BINANCE:BTCUSDT', group: 'Crypto' },
  { label: 'Ethereum', value: 'BINANCE:ETHUSDT', group: 'Crypto' },
  { label: 'Solana', value: 'BINANCE:SOLUSDT', group: 'Crypto' },
  { label: 'Apple', value: 'NASDAQ:AAPL', group: 'US Stocks' },
  { label: 'Tesla', value: 'NASDAQ:TSLA', group: 'US Stocks' },
  { label: 'Nvidia', value: 'NASDAQ:NVDA', group: 'US Stocks' },
]

interface ChartSelectorProps {
  activeChart: string
  setActiveChart: (symbol: string) => void
}

export function ChartSelector({ activeChart, setActiveChart }: ChartSelectorProps) {
  const [localValue, setLocalValue] = useState(activeChart)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalValue(activeChart)
  }, [activeChart])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
        if (localValue !== activeChart) {
          if (localValue.trim()) setActiveChart(localValue.trim().toUpperCase())
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [localValue, activeChart, setActiveChart])

  const handleSubmit = (val?: string) => {
    const finalVal = val || localValue
    if (finalVal.trim() && finalVal !== activeChart) {
      setActiveChart(finalVal.trim().toUpperCase())
    }
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  const filtered = SUGGESTIONS.filter(
    s => s.label.toLowerCase().includes(localValue.toLowerCase()) || 
         s.value.toLowerCase().includes(localValue.toLowerCase())
  )

  return (
    <div className="relative flex items-center" ref={wrapperRef}>
      <Search className="absolute left-3 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value.toUpperCase())
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search or type symbol..."
        className="bg-background border border-border rounded-full pl-9 pr-4 py-1.5 text-xs font-medium outline-none focus:ring-1 focus:ring-primary text-foreground transition-all w-56 uppercase placeholder:normal-case placeholder:text-muted-foreground/70"
      />
      
      {open && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="max-h-[300px] overflow-y-auto p-1 scrollbar-none">
            {filtered.length > 0 ? (
              filtered.map((item) => (
                <button
                  key={item.value}
                  onClick={() => handleSubmit(item.value)}
                  className={`w-full text-left flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                    activeChart === item.value 
                      ? 'bg-primary/10 text-primary font-semibold' 
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="text-foreground">{item.label}</span>
                    <span className="text-[10px] text-muted-foreground/70">{item.value}</span>
                  </div>
                  {activeChart === item.value && <Check className="w-3.5 h-3.5" />}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-foreground font-medium">Use custom symbol</p>
                <p className="text-[10px] text-muted-foreground mt-1 text-balance">
                  Press Enter to load <strong>{localValue || 'symbol'}</strong> directly from TradingView.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
