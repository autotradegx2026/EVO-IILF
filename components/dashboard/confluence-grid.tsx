'use client'

import { cn } from '@/lib/utils'
import type { Signal } from '@/types/database'

interface ConfluenceGridProps {
  signal: Signal | null
}

// The 7 confluence factors from the AutotradeX strategy
const FACTORS = [
  { key: 'trend',      label: 'Trend'       },
  { key: 'vwap',       label: 'VWAP'        },
  { key: 'delta',      label: 'Delta'       },
  { key: 'volume',     label: 'Volume'      },
  { key: 'sweep',      label: 'Sweep'       },
  { key: 'fvg',        label: 'FVG'         },
  { key: 'ob',         label: 'Order Block' },
] as const

export function ConfluenceGrid({ signal }: ConfluenceGridProps) {
  // Display only reported confirmations; ADX and volatility are entry gates.
  const activeCount = signal?.confluence_score ?? 0

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Confluence Factors</span>
        {signal && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
            {activeCount}/7
          </span>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-2">
        {FACTORS.map((factor) => {
          const factors = signal?.raw_payload?.factors as Record<string, unknown> | undefined
          const value = factors?.[factor.key] ?? signal?.raw_payload?.[factor.key]
            ?? (factor.key === 'trend' ? factors?.trend_ema ?? signal?.raw_payload?.trend_ema : undefined)
          const active = value === true
          return (
            <div
              key={factor.key}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-muted/30'
              )}
            >
              <span className={cn('text-[10px] font-semibold text-center leading-tight', active ? 'text-primary' : 'text-muted-foreground')}>
                {factor.label}
                <span className="block mt-1">{value === true ? 'Pass' : value === false ? 'Fail' : 'Unknown'}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
