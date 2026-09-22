import { requireAuth } from '@/lib/supabase/auth'
import { ReportQuery } from '@/lib/reporting/model'
import { loadReport } from '@/lib/reporting/service'
export const dynamic='force-dynamic'
export async function GET(request:Request){
 try{const {user}=await requireAuth();const q=ReportQuery.safeParse({...Object.fromEntries(new URL(request.url).searchParams),view:'risk'});if(!q.success)return Response.json({error:'INVALID_FILTERS'},{status:400});const r=await loadReport(user.id,q.data);return Response.json({data:r.risk,environment:r.environment,currency:r.currency,currencies:r.currencies,accounts:r.accounts,asOf:r.asOf},{headers:{'Cache-Control':'private, no-store'}})}
 catch(e){if(e instanceof Response)return e;return Response.json({error:'RISK_UNAVAILABLE'},{status:503})}
}
