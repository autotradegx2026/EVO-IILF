import type { Metadata } from 'next'
import Link from 'next/link'
import { Activity, ArrowRight, ArrowUpRight, Power, ShieldAlert, Hash, Clock, Lock, Timer, BookText, Radio, ScanSearch, Scale, ShieldCheck } from 'lucide-react'
import { PipelineDemo } from '@/components/home/pipeline-demo'
import styles from './home.module.css'
import { publicFonts } from './fonts'

export const metadata: Metadata = {
  title: 'AutotradeX | Signal-to-broker trading automation',
  description: 'AutotradeX validates TradingView and native strategy signals through a seven-factor confluence engine and your risk limits before placing protected broker orders.',
}

const TAPE = [
  'HMAC-SHA256 signed alerts',
  'Zod-validated payloads',
  'Seven-factor confluence',
  'Broker-held stop loss',
  'Native OCO on Binance Spot',
  'Durable execution ledger',
  'Daily-loss lock',
  'One-tap kill switch',
  'Paper · testnet · live separation',
  'Pine v5 strategy export',
]

const FACTORS = [
  ['Trend', 'Close and fast EMA 20 above EMA 200, confirmed by the 60-minute EMA 50. Mandatory for direction.'],
  ['VWAP', 'Price on the right side of the daily volume-weighted average price.'],
  ['Delta', 'Smoothed volume-delta proxy leaning with the trade.'],
  ['Volume', 'Participation above 1.5× the 20-bar average.'],
  ['Liquidity sweep', 'Prior 10-bar high or low taken, then rejected by the signal candle.'],
  ['Fair value gap', 'Imbalance left behind by a displacement candle larger than 0.8 ATR.'],
  ['Order block', 'Opposite candle reclaimed with displacement and high volume.'],
] as const

const STEPS = [
  { icon: Radio, title: 'Alert', body: 'A TradingView Pine alert or a native Binance scan produces a closed-candle setup.' },
  { icon: ScanSearch, title: 'Validate', body: 'Signature, schema, duplicate, session, cooldown, trade-cap, daily-loss and position checks run in order.' },
  { icon: Scale, title: 'Size', body: 'Quantity comes from your risk percentage and the true stop distance, rechecked against lot and tick rules.' },
  { icon: ShieldCheck, title: 'Protect', body: 'The entry is placed with protection held at the broker: native OCO on Binance, a broker stop on Angel One.' },
]

const CONTROLS = [
  { icon: Power, title: 'Kill switch', body: 'Stop blocks new entries instantly. It needs no broker connection and leaves protection running.' },
  { icon: ShieldAlert, title: 'Daily-loss lock', body: 'Hit your maximum daily loss and new entries lock until the next session.' },
  { icon: Hash, title: 'Trade cap', body: 'A hard limit on entries per day, enforced on the server, not in the browser.' },
  { icon: Timer, title: 'Cooldown', body: 'At least ten bars between setups, so one move cannot trigger a cascade of entries.' },
  { icon: Clock, title: 'Session window', body: 'Entries only inside your trading hours, with a scheduled square-off before the broker cutoff.' },
  { icon: Lock, title: 'Locked runs', body: 'Broker, symbol and timeframe stay locked while a run is live, across every tab and device.' },
]

const BROKERS = [
  { name: 'Angel One', market: 'India · NSE cash intraday', detail: 'SmartAPI with broker-held stop, monitored target and a static IP egress.' },
  { name: 'Binance Spot', market: 'Crypto · testnet first', detail: 'Long-only spot with native OCO protection and commission-aware accounting.' },
  { name: 'Paper', market: 'Simulation', detail: 'A separate switch and watchlist for forward testing that never touches a broker.' },
]

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--long)]" aria-label="AutotradeX home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--paper)] text-[var(--ink)]"><Activity className="size-[18px]" strokeWidth={2.5} /></span>
      <span className="text-[17px] font-semibold tracking-tight">AutotradeX</span>
    </Link>
  )
}

const kicker = 'font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]'
const h2 = 'font-[family-name:var(--font-display)] text-[clamp(2.4rem,5.5vw,4.5rem)] leading-[0.98] tracking-[-0.01em]'
const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--long)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ink)]'

export default function HomePage() {
  return (
    <div className={`${styles.page} ${publicFonts} min-h-screen font-[family-name:var(--font-body)]`}>
      <div className={styles.grid} aria-hidden />
      <div className={styles.glow} aria-hidden />

      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[rgba(9,10,9,0.72)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Brand />
          <nav aria-label="Home sections" className="hidden items-center gap-8 text-sm text-[var(--muted)] md:flex">
            <a href="#engine" className={`transition-colors hover:text-[var(--paper)] ${focus} rounded`}>Engine</a>
            <a href="#execution" className={`transition-colors hover:text-[var(--paper)] ${focus} rounded`}>Execution</a>
            <a href="#controls" className={`transition-colors hover:text-[var(--paper)] ${focus} rounded`}>Controls</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className={`rounded-full px-4 py-2 text-sm font-medium text-[var(--paper)] transition-colors hover:bg-[rgba(236,230,216,0.08)] ${focus}`}>Log in</Link>
            <Link href="/dashboard" className={`group inline-flex items-center gap-1.5 rounded-full bg-[var(--long)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-transform hover:-translate-y-px ${focus}`}>
              <span className="hidden sm:inline">Open dashboard</span><span className="sm:hidden">Dashboard</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 md:pt-20 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pb-28">
          <div>
            <p className={`${kicker} ${styles.rise} flex items-center gap-2.5`} style={{ ['--d' as string]: 0 }}>
              <span className={`size-1.5 rounded-full bg-[var(--long)] ${styles.pulse}`} />EVO-IILF institutional hybrid framework
            </p>
            <h1 className={`${styles.rise} mt-6 font-[family-name:var(--font-display)] text-[clamp(3.1rem,8.4vw,7rem)] leading-[0.92] tracking-[-0.02em]`} style={{ ['--d' as string]: 1 }}>
              Every trade has to <span className={`${styles.italic} text-[var(--long)]`}>earn</span> its way to the market.
            </h1>
            <p className={`${styles.rise} mt-7 max-w-xl text-[17px] leading-relaxed text-[var(--muted)]`} style={{ ['--d' as string]: 2 }}>
              AutotradeX turns strategy signals into broker orders only after they clear an eight-stage validation pipeline, a seven-factor confluence score and your own risk limits. The stop is held at the broker, not in a browser tab.
            </p>
            <div className={`${styles.rise} mt-10 flex flex-wrap items-center gap-3`} style={{ ['--d' as string]: 3 }}>
              <Link href="/login" className={`group inline-flex items-center gap-2 rounded-full bg-[var(--paper)] px-6 py-3.5 text-[15px] font-semibold text-[var(--ink)] transition-transform hover:-translate-y-0.5 ${focus}`}>
                Log in to your desk <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a href="#engine" className={`inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] px-6 py-3.5 text-[15px] font-medium transition-colors hover:border-[var(--paper)] ${focus}`}>
                See the engine
              </a>
            </div>
            <dl className={`${styles.rise} mt-14 grid max-w-lg grid-cols-3 border-t border-[var(--line)] pt-6`} style={{ ['--d' as string]: 4 }}>
              {[['8', 'validation gates'], ['7', 'confluence factors'], ['3R', 'default target']].map(([value, label]) => (
                <div key={label}>
                  <dt className="sr-only">{label}</dt>
                  <dd className="font-[family-name:var(--font-display)] text-4xl leading-none">{value}</dd>
                  <dd className="mt-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className={styles.rise} style={{ ['--d' as string]: 3 }}>
            <PipelineDemo />
          </div>
        </section>

        {/* Tape */}
        <div className={`${styles.marqueeWrap} border-y border-[var(--line)] bg-[var(--ink-2)] py-4`} aria-label="Platform capabilities">
          <div className="overflow-hidden">
            <ul className={`${styles.marquee} font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.18em] text-[var(--muted)]`}>
              {[...TAPE, ...TAPE].map((item, i) => (
                <li key={i} aria-hidden={i >= TAPE.length} className="flex shrink-0 items-center gap-6 pr-6">
                  <span>{item}</span><span className="text-[var(--long)]">◆</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Engine */}
        <section id="engine" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6 lg:py-36">
          <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className={kicker}>01 · The engine</p>
              <h2 className={`${h2} mt-5`}>Seven confirmations. <span className={`${styles.italic} text-[var(--muted)]`}>One score.</span></h2>
              <p className="mt-6 max-w-md leading-relaxed text-[var(--muted)]">
                Each closed candle is scored on seven independent confirmations. ADX strength, expanding volatility and your session window are hard gates on top, so a high score in a dead market still goes nowhere.
              </p>
              <div className="mt-10 flex items-end gap-5">
                <span className="font-[family-name:var(--font-display)] text-[8rem] leading-[0.8] text-[var(--long)]">5<span className="text-[var(--muted)]">/7</span></span>
                <span className="pb-2 font-[family-name:var(--font-mono)] text-[11px] uppercase leading-relaxed tracking-[0.16em] text-[var(--muted)]">Default minimum<br />to qualify</span>
              </div>
            </div>
            <ol className="border-t border-[var(--line)]">
              {FACTORS.map(([name, rule], i) => (
                <li key={name} className={`${styles.reveal} group grid grid-cols-[3rem_1fr] gap-x-4 border-b border-[var(--line)] py-7 sm:grid-cols-[4rem_12rem_1fr]`}>
                  <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--muted)] transition-colors group-hover:text-[var(--long)]">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-[family-name:var(--font-display)] text-[1.9rem] leading-none">{name}</span>
                  <span className="col-start-2 mt-3 text-[15px] leading-relaxed text-[var(--muted)] sm:col-start-3 sm:mt-0">{rule}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Execution */}
        <section id="execution" className="scroll-mt-20 border-y border-[var(--line)] bg-[var(--ink-2)]">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-36">
            <p className={kicker}>02 · Execution</p>
            <h2 className={`${h2} mt-5 max-w-4xl`}>From alert to order, <span className={`${styles.italic} text-[var(--muted)]`}>without the guesswork.</span></h2>

            <ol className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className={`${styles.reveal} relative bg-[var(--ink-2)] p-7 transition-colors hover:bg-[var(--ink-3)]`}>
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-[var(--long)]" />
                    <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--muted)]">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 className="mt-10 font-[family-name:var(--font-display)] text-3xl">{title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{body}</p>
                </li>
              ))}
            </ol>

            <div className="mt-20 grid gap-10 lg:grid-cols-[1fr_2fr]">
              <div>
                <h3 className="font-[family-name:var(--font-display)] text-4xl leading-tight">Connected where you trade.</h3>
                <p className="mt-4 leading-relaxed text-[var(--muted)]">Credentials are encrypted at rest and entered at runtime. Connecting a broker never starts trading on its own.</p>
              </div>
              <ul className="grid gap-4 sm:grid-cols-3">
                {BROKERS.map(broker => (
                  <li key={broker.name} className={`${styles.reveal} flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--ink)] p-6 transition-colors hover:border-[var(--line-strong)]`}>
                    <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--long)]">{broker.market}</span>
                    <span className="mt-4 text-xl font-semibold">{broker.name}</span>
                    <span className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{broker.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Controls */}
        <section id="controls" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6 lg:py-36">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <p className={kicker}>03 · Controls</p>
              <h2 className={`${h2} mt-5 max-w-3xl`}>You stay the <span className={`${styles.italic} text-[var(--amber)]`}>circuit breaker.</span></h2>
            </div>
            <p className="max-w-sm leading-relaxed text-[var(--muted)]">Automation runs inside limits you set. Every limit is enforced on the server and survives a closed laptop.</p>
          </div>
          <ul className="mt-16 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {CONTROLS.map(({ icon: Icon, title, body }) => (
              <li key={title} className={`${styles.reveal} border-t border-[var(--line-strong)] pt-6`}>
                <Icon className="size-5 text-[var(--amber)]" />
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Ledger */}
        <section className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className={`${styles.reveal} ${styles.sweep} relative overflow-hidden rounded-3xl border border-[var(--line-strong)] p-8 sm:p-14`}>
            <BookText className="size-6 text-[var(--long)]" />
            <p className="mt-8 max-w-4xl font-[family-name:var(--font-display)] text-[clamp(1.9rem,4vw,3.4rem)] leading-[1.08]">
              Every intent, fill and fee goes on the record. Unknown outcomes are <span className={`${styles.italic} text-[var(--long)]`}>reconciled</span>, never blindly retried.
            </p>
            <p className="mt-6 max-w-2xl leading-relaxed text-[var(--muted)]">
              A durable execution ledger feeds your journal, analytics, risk view and alerts, with paper, testnet and live results kept apart and every currency reported on its own.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-4 py-28 text-center sm:px-6 lg:py-40">
          <h2 className="font-[family-name:var(--font-display)] text-[clamp(3rem,9vw,7.5rem)] leading-[0.9] tracking-[-0.02em]">
            Your desk <span className={`${styles.italic} text-[var(--long)]`}>is ready.</span>
          </h2>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className={`group inline-flex items-center gap-2 rounded-full bg-[var(--long)] px-7 py-4 text-[15px] font-semibold text-[var(--ink)] transition-transform hover:-translate-y-0.5 ${focus}`}>
              Log in <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link href="/dashboard" className={`inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] px-7 py-4 text-[15px] font-medium transition-colors hover:border-[var(--paper)] ${focus}`}>
              Open dashboard <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <Brand />
            <p className="mt-5 text-xs leading-relaxed text-[var(--muted)]">
              AutotradeX is software for executing your own strategy. It does not provide investment advice. Simulated and past results do not guarantee future performance, and trading involves the risk of loss.
            </p>
          </div>
          <div className="font-[family-name:var(--font-mono)] text-[11px] uppercase leading-loose tracking-[0.14em] text-[var(--muted)] md:text-right">
            <p>© 2026 GrindX Technologies Pvt Ltd</p>
            <p>Sector V, Kolkata, West Bengal</p>
            <a href="mailto:support@grindx.io" className={`rounded transition-colors hover:text-[var(--paper)] ${focus}`}>support@grindx.io</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
