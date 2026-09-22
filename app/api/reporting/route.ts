import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { executionDB } from '@/lib/execution/service'
import { ReportQuery,ledgerCsv,EnvironmentSchema } from '@/lib/reporting/model'
import { loadReport } from '@/lib/reporting/service'
export const dynamic='force-dynamic'
export async function GET(request:Request){
 try{
  const {user}=await requireAuth(),params=new URL(request.url).searchParams
  if([...params.keys()].some(key=>params.getAll(key).length!==1))return Response.json({error:'INVALID_REPORT_FILTERS'},{status:400})
  const parsed=ReportQuery.safeParse(Object.fromEntries(params))
  if(!parsed.success)return Response.json({error:'INVALID_REPORT_FILTERS'},{status:400})
  const {exportRows,...data}=await loadReport(user.id,parsed.data)
  if(parsed.data.format==='csv')return new Response('\ufeff'+ledgerCsv(exportRows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="evo-${data.environment}-${data.currency}.csv"`,'Cache-Control':'private, no-store'}})
  return Response.json({data},{headers:{'Cache-Control':'private, no-store'}})
 }catch(e){
  if(e instanceof Response)return e
  const error=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'REPORT_UNAVAILABLE'
  return Response.json({error},{status:error==='ACCOUNT_NOT_FOUND'?404:['CURRENCY_NOT_AVAILABLE','INVALID_DATE_RANGE'].includes(error)?400:503})
 }
}
export async function PATCH(request:Request){
 try{
  const {user}=await requireAuth()
  const body=z.object({environment:EnvironmentSchema,id:z.string().uuid(),notes:z.string().max(5000)}).strict().safeParse(await request.json())
  if(!body.success)return Response.json({error:'INVALID_ANNOTATION'},{status:400})
  const {environment,id,notes}=body.data,db=executionDB(),table=environment==='paper'?'paper_trades':environment==='legacy'?'trades':'broker_executions'
  let query=db.from(table).update({notes}).eq('id',id).eq('user_id',user.id)
  if(table==='broker_executions')query=query.eq('environment',environment)
  const result=await query.select('id,notes').maybeSingle()
  if(result.error)throw result.error
  if(!result.data)return Response.json({error:'TRADE_NOT_FOUND'},{status:404})
  return Response.json({data:result.data})
 }catch(e){if(e instanceof Response)return e;return Response.json({error:'ANNOTATION_SAVE_FAILED'},{status:400})}
}
