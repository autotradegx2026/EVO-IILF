'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Mirrors the webhook validation pipeline; the signal itself is illustrative.
const STAGES = [
  ['Signature', 'HMAC-SHA256'],
  ['Payload', 'Zod schema'],
  ['Duplicate', 'SHA-256 hash'],
  ['Session', '09:30–15:30 IST'],
  ['Cooldown', '10 bars clear'],
  ['Daily trades', 'Within cap'],
  ['Daily loss', 'Not locked'],
  ['Open positions', 'Slot free'],
] as const

const FACTORS = ['Trend', 'VWAP', 'Delta', 'Volume', 'Sweep', 'FVG', 'OB'] as const
const PASSED_FACTORS = new Set([0, 1, 2, 3, 5, 6])
const FACTOR_START = STAGES.length
const READY = FACTOR_START + FACTORS.length
const HOLD = READY + 6

export function PipelineDemo() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(READY)
      return
    }
    const timer = window.setInterval(() => setStep(current => (current >= HOLD ? 0 : current + 1)), 420)
    return () => window.clearInterval(timer)
  }, [])

  const score = FACTORS.filter((_, i) => PASSED_FACTORS.has(i) && step > FACTOR_START + i).length
  const ready = step >= READY

  return (
    <div className="relative rounded-2xl border border-[var(--line-strong)] bg-[rgba(16,18,16,0.9)] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-sm" aria-label="Illustration of a signal passing the AutotradeX validation pipeline" role="img">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
        <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[var(--long)]" />Inbound alert</span>
        <span>NSE:RELIANCE-EQ · 15m</span>
      </div>

      <ol className="px-5 py-3">
        {STAGES.map(([name, detail], i) => {
          const done = step > i
          const active = step === i
          return (
            <li key={name} className={cn('flex items-center gap-3 border-b border-dashed border-[var(--line)] py-[7px] last:border-0 transition-colors duration-300', active && 'bg-[linear-gradient(90deg,rgba(126,227,143,0.08),transparent)]')}>
              <span className="w-5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--muted)]">{String(i + 1).padStart(2, '0')}</span>
              <span className={cn('flex-1 text-sm transition-colors duration-300', done ? 'text-[var(--paper)]' : 'text-[var(--muted)]')}>{name}</span>
              <span className="hidden font-[family-name:var(--font-mono)] text-[11px] text-[var(--muted)] sm:inline">{detail}</span>
              <span className={cn('flex size-5 items-center justify-center rounded-full border transition-all duration-300', done ? 'border-[var(--long)] bg-[var(--long)] text-[var(--ink)]' : active ? 'border-[var(--long)]' : 'border-[var(--line-strong)]')}>
                {done && <Check className="size-3" strokeWidth={3} />}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="border-t border-[var(--line)] px-5 py-4">
        <div className="mb-2.5 flex items-baseline justify-between font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
          <span>Confluence</span>
          <span><span className="text-base text-[var(--paper)] tabular-nums">{score}</span> / 7 · min 5</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {FACTORS.map((factor, i) => {
            const evaluated = step > FACTOR_START + i
            const pass = PASSED_FACTORS.has(i)
            return (
              <div key={factor} className="flex flex-col items-center gap-1.5">
                <span className={cn('h-7 w-full rounded-[4px] border transition-all duration-300', !evaluated ? 'border-[var(--line-strong)]' : pass ? 'border-[var(--long)] bg-[rgba(126,227,143,0.85)]' : 'border-[rgba(255,107,87,0.6)] bg-[repeating-linear-gradient(135deg,rgba(255,107,87,0.25)_0_3px,transparent_3px_6px)]')} />
                <span className="font-[family-name:var(--font-mono)] text-[9px] uppercase tracking-wider text-[var(--muted)]">{factor}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className={cn('flex items-center justify-between rounded-b-2xl border-t px-5 py-4 transition-colors duration-500', ready ? 'border-[rgba(126,227,143,0.4)] bg-[rgba(126,227,143,0.08)]' : 'border-[var(--line)]')}>
        <span className={cn('font-[family-name:var(--font-display)] text-3xl leading-none transition-colors duration-500', ready ? 'text-[var(--long)]' : 'text-[var(--muted)]')}>
          {ready ? 'Long ready' : 'Evaluating…'}
        </span>
        <span className="text-right font-[family-name:var(--font-mono)] text-[10px] uppercase leading-relaxed tracking-[0.12em] text-[var(--muted)]">
          Stop · low − 1.5 ATR<br />Target · 3R
        </span>
      </div>
    </div>
  )
}
