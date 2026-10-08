import Link from 'next/link'
import { Activity, ArrowLeft } from 'lucide-react'
import styles from '../home.module.css'
import { publicFonts } from '../fonts'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.page} ${publicFonts} grid min-h-screen font-[family-name:var(--font-body)] lg:grid-cols-[1.1fr_1fr]`}>
      <div className={styles.grid} aria-hidden />
      <div className={styles.glow} aria-hidden />

      <aside className="relative hidden flex-col justify-between border-r border-[var(--line)] p-12 lg:flex">
        <Link href="/" className="flex w-fit items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--long)]" aria-label="AutotradeX home">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--paper)] text-[var(--ink)]"><Activity className="size-[18px]" strokeWidth={2.5} /></span>
          <span className="text-[17px] font-semibold tracking-tight">AutotradeX</span>
        </Link>
        <div>
          <p className="font-[family-name:var(--font-display)] text-[clamp(3rem,5vw,5rem)] leading-[0.95] tracking-[-0.02em]">
            Back to the <span className={`${styles.italic} text-[var(--long)]`}>desk.</span>
          </p>
          <p className="mt-6 max-w-md leading-relaxed text-[var(--muted)]">Signals, risk limits and broker protection are where you left them. Automation keeps its own limits while you are away.</p>
        </div>
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">© 2026 GrindX Technologies Pvt Ltd</p>
      </aside>

      <main className="relative flex flex-col items-center justify-center px-4 py-20 sm:px-6">
        <Link href="/" className="absolute left-4 top-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-[var(--muted)] outline-none transition-colors hover:text-[var(--paper)] focus-visible:ring-2 focus-visible:ring-[var(--long)] sm:left-6">
          <ArrowLeft className="size-4" /> Home
        </Link>
        {children}
      </main>
    </div>
  )
}
