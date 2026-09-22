import { requireAuth } from '@/lib/supabase/auth'
import { ReportQuery } from '@/lib/reporting/model'
import { loadReport } from '@/lib/reporting/service'
export const dynamic='force-dynamic'
export async function GET(request:Request){
 try{const {user}=await requireAuth();const q=ReportQuery.safeParse({...Object.fromEntries(new URL(request.url).searchParams),view:'analytics'});if(!q.success)return Response.json({error:'INVALID_FILTERS'},{status:400});const r=await loadReport(user.id,q.data);return Response.json({data:r.summary.metrics,environment:r.environment,currency:r.currency,accounting:{feeNotes:r.summary.feeNotes,netPnl:r.summary.netPnl}},{headers:{'Cache-Control':'private, no-store'}})}
 catch(e){if(e instanceof Response)return e;return Response.json({error:'PERFORMANCE_UNAVAILABLE'},{status:503})}
}
