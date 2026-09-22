import type { PaperObservation } from '@/types/database'

export function PaperAnalysisHistory({rows,count}:{rows:PaperObservation[]|null;count:number|null}) {
  return <details className="rounded-2xl border border-border bg-card p-5">
    <summary className="cursor-pointer font-semibold">Paper analysis history · {count??'Unavailable'} recorded candle checks</summary>
    <p className="my-3 text-xs text-muted-foreground">Actual saved evaluations, starting with this release. Latest 100 records across paper runs. These are market checks, not fills; earlier checks have not been backfilled.</p>
    {rows===null?<p>Analysis history unavailable.</p>:!rows.length?<p className="text-sm text-muted-foreground">The next background scan will record a candle evaluation here.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Candle close','Symbol / timeframe','Score','Decision'].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{rows.map((o,i)=><tr key={`${o.symbol}:${o.bar_close}:${i}`} className="border-t border-border"><td className="p-2">{o.bar_close?new Date(o.bar_close).toLocaleString():'Not recorded'}</td><td className="p-2">{o.symbol} · {o.timeframe}</td><td className="p-2">{o.score??'—'}/7</td><td className="p-2">{o.status} · {o.reasons.join(' · ')}</td></tr>)}</tbody></table></div>}
  </details>
}
