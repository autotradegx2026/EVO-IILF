import Link from 'next/link'

export function QuickTradeTerminal({ activeChart }: { activeChart: string }) {
  return <div className="rounded-xl border border-border bg-card p-4 text-sm">
    <p>{activeChart}: live execution requires a qualified signal and your confirmation.</p>
    <Link href="/" className="text-primary underline">Review the current signal</Link>
  </div>
}
